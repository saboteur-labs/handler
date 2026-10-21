/**
 * Lazy ingestion orchestrator (spec Reqs 1, 8).
 *
 * Ties the ingestion pipeline together: discover parent transcripts, parse
 * each, extract Task results, attribute and snapshot them, and persist the
 * attributed runs. Called on read (e.g. by `list`/`show`) so output reflects
 * the current transcripts without a separate ingest step. Idempotent — the
 * store dedupes on `(identityKey, runId)`, so repeated calls add nothing.
 *
 * This layer is pure wiring: every decision (what counts as a run, how it is
 * attributed, what is dropped) lives in the modules it composes.
 */
import { existsSync, statSync } from 'node:fs';

import { assembleCapturedRun, transcriptFactsFromEntries } from './capture-run';
import { identityKey } from './identity';
import { assembleRun, resolveRunIdentity, sidechainPathFor, type Run } from './run';
import type { AgentSource } from './sources/source';
import { IngestCache, ingestCachePathFor, type CachedFile } from './store/ingest-cache';
import { canOverwrite } from './store/precedence';
import { RunStore } from './store/run-store';
import { discoverMetaRuns, discoverSidechains, discoverTranscripts } from './transcripts/discover';
import { extractRuns, type RawRun } from './transcripts/extract';
import { readJsonl } from './transcripts/jsonl';
import { latestStatusByAgentId } from './transcripts/notifications';
import { parseSidechainParentAgentId } from './transcripts/sidechain';

export interface IngestOptions {
  /** Registered agent sources to attribute against (e.g. `registry.list()`). */
  readonly sources: readonly AgentSource[];
  /** Transcripts root; defaults to `~/.claude/projects`. */
  readonly projectsRoot?: string;
  /** Run-store location; defaults to `~/.handler/runs.json`. */
  readonly storePath?: string;
}

/** A legacy run has every summary field the `toolUseResult` normally carries. */
function isLegacyComplete(run: Run): boolean {
  return (
    run.status !== undefined &&
    run.totalDurationMs !== undefined &&
    run.totalTokens !== undefined &&
    run.totalToolUseCount !== undefined
  );
}

interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
}

function statOf(path: string): FileStat | undefined {
  try {
    const st = statSync(path);
    return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

function withStat(run: Run, st: FileStat | undefined): Run {
  return st === undefined ? run : { ...run, sidechainSize: st.size, sidechainMtimeMs: st.mtimeMs };
}

/**
 * True when `existing` was assembled from this very sub-transcript as it still
 * is on disk (FR-36). Only a `transcript`-source record qualifies: a hook or
 * runlog record must be re-assembled so it can upgrade to transcript.
 */
function isUnchanged(
  existing: Run | undefined,
  sidechainPath: string | undefined,
  st: FileStat | undefined,
): existing is Run {
  return (
    existing !== undefined &&
    existing.source === 'transcript' &&
    sidechainPath !== undefined &&
    st !== undefined &&
    existing.sidechainPath === sidechainPath &&
    existing.sidechainSize === st.size &&
    existing.sidechainMtimeMs === st.mtimeMs
  );
}

/** The raw summary carries every field a complete legacy run needs. */
function isRawComplete(raw: RawRun): boolean {
  return (
    raw.status !== undefined &&
    raw.totalDurationMs !== undefined &&
    raw.totalTokens !== undefined &&
    raw.totalToolUseCount !== undefined
  );
}

/**
 * Merge a meta-discovered run into the legacy run for the same agent (FR-15).
 * A complete legacy result supplies everything and meta adds only the lineage
 * fields it lacks. An incomplete one keeps what it has and meta fills the gaps;
 * the legacy definition snapshot always stays.
 */
function mergeCompleteLegacy(legacy: Run, meta: Pick<Run, 'parentAgentId' | 'spawnDepth'>): Run {
  return {
    ...legacy,
    parentAgentId: legacy.parentAgentId ?? meta.parentAgentId,
    spawnDepth: legacy.spawnDepth ?? meta.spawnDepth,
  };
}

function mergeLegacyWithMeta(legacy: Run, meta: Run): Run {
  if (isLegacyComplete(legacy)) {
    return mergeCompleteLegacy(legacy, meta);
  }
  const lineage = {
    parentAgentId: legacy.parentAgentId ?? meta.parentAgentId,
    spawnDepth: legacy.spawnDepth ?? meta.spawnDepth,
  };
  const legacyLocatorOk = legacy.sidechainPath !== undefined && existsSync(legacy.sidechainPath);
  return {
    ...legacy,
    ...lineage,
    cwd: legacy.cwd ?? meta.cwd,
    sessionId: legacy.sessionId ?? meta.sessionId,
    timestamp: legacy.timestamp ?? meta.timestamp,
    status: legacy.status ?? meta.status,
    totalDurationMs: legacy.totalDurationMs ?? meta.totalDurationMs,
    totalTokens: legacy.totalTokens ?? meta.totalTokens,
    totalToolUseCount: legacy.totalToolUseCount ?? meta.totalToolUseCount,
    toolStats: legacy.toolStats ?? meta.toolStats,
    sidechainPath: legacyLocatorOk ? legacy.sidechainPath : meta.sidechainPath,
    telemetry: legacyLocatorOk ? (legacy.telemetry ?? meta.telemetry) : meta.telemetry,
    tags: meta.tags.includes('incomplete')
      ? legacy.tags
      : legacy.tags.filter((t) => t !== 'incomplete'),
  };
}

/**
 * Ingest all user-authored subagent runs from the transcripts under
 * `projectsRoot`, persist them, and return the full stored run set.
 *
 * In addition to top-level parent transcripts, this also processes sidechain
 * files (per-run sub-transcripts) to capture nested subagent runs — runs
 * spawned by another subagent. The `parentAgentId` is extracted from the
 * sidechain filename and recorded on each nested run, preserving the nesting
 * relationship. Attribution uses the identical `resolveRunIdentity` logic as
 * top-level runs; built-in agents and unregistered sources are dropped as
 * normal; interrupted nested runs are kept-and-tagged with `'incomplete'`.
 *
 * After those legacy passes, a meta pass discovers runs from each
 * `agent-<id>.meta.json` and its sibling sub-transcript (metrics computed from
 * the sub-transcript only), with status taken from the latest parent-session
 * `<task-notification>` for that agentId. It runs last and checks
 * `seenAgentIds`, so a run seen by both paths is stored once.
 */
export function ingest(options: IngestOptions): Run[] {
  const store = new RunStore(options.storePath);
  return store.batch(() => ingestInto(store, options));
}

function ingestInto(store: RunStore, options: IngestOptions): Run[] {
  // Regenerable per-file extraction cache, beside the run store (FR-36).
  const cache = new IngestCache(ingestCachePathFor(options.storePath));
  const discoveredPaths = new Set<string>();
  // In-process dedup: tracks agentIds seen within this single ingest call.
  // Prevents calling assembleRun or store.upsert more than once for the same
  // agentId when it appears in both a top-level transcript and a sidechain.
  // The store's (identityKey, runId) upsert no-op remains as a cross-call guard.
  const seenAgentIds = new Set<string>();
  // Legacy-assembled run per agentId (`null` when the legacy pass dropped it),
  // so the meta pass can merge into it.
  const legacyRuns = new Map<string, Run | null>();
  // Latest notification status per agentId, gathered from the same entries the
  // legacy pass already parses so no file is read twice.
  const notificationStatus = new Map<string, string>();

  /**
   * What ingest extracts from one transcript file: reused from the cache while
   * the file's size and mtime are unchanged, otherwise parsed once and cached.
   * Sidechain files also record their first cwd/sessionId/timestamp facts.
   */
  function extraction(path: string, sidechain: boolean): CachedFile {
    discoveredPaths.add(path);
    const st = statOf(path);
    if (st !== undefined) {
      const hit = cache.get(path, st.size, st.mtimeMs);
      if (hit !== undefined && (!sidechain || hit.facts !== undefined)) return hit;
    }
    const entries = readJsonl(path);
    const fresh: CachedFile = {
      size: st?.size ?? -1,
      mtimeMs: st?.mtimeMs ?? -1,
      statuses: [...latestStatusByAgentId(entries)],
      runs: extractRuns(entries),
      ...(sidechain && { facts: transcriptFactsFromEntries(entries) }),
    };
    if (st !== undefined) cache.set(path, fresh);
    return fresh;
  }

  function collectNotifications(file: CachedFile): void {
    for (const [agentId, status] of file.statuses) {
      notificationStatus.set(agentId, status);
    }
  }

  /**
   * `assembleRun` for a legacy run, skipping the sub-transcript read when the
   * stored transcript record already reflects the unchanged file. Limited to
   * complete summaries so an incomplete legacy run keeps its telemetry for the
   * meta merge.
   */
  function assembleLegacy(raw: RawRun, transcriptPath: string, parentAgentId?: string): Run | null {
    const identity = resolveRunIdentity(raw, options.sources);
    if (identity === null) return null;
    const sidechainPath = sidechainPathFor(raw, transcriptPath, parentAgentId);
    const st = sidechainPath === undefined ? undefined : statOf(sidechainPath);
    const skip =
      isRawComplete(raw) &&
      isUnchanged(store.forRun(identityKey(identity), raw.agentId), sidechainPath, st);
    const run = assembleRun(raw, options.sources, transcriptPath, parentAgentId, {
      skipTelemetry: skip,
    });
    return run === null ? null : withStat(run, st);
  }

  /**
   * Persist a freshly-assembled run. Transcript is authoritative: it replaces a
   * lower-precedence `hook` or `runlog` record (decided by `canOverwrite`). It
   * never replaces an existing transcript record — re-ingesting after a
   * definition edit must preserve each run's original definition snapshot so
   * history survives renames/edits/deletes (mirrors the old `add` dedup-no-op).
   *
   * Two narrow exceptions touch an existing transcript record, and neither
   * touches `definitionSnapshot`:
   * - the run's mutable facts (status, metrics, lineage) are refreshed from any
   *   value the fresh assembly actually carries, never erased by a missing one;
   * - a *stale sub-transcript locator*: when the stored record points at a
   *   sidechain that no longer resolves but the fresh assembly now locates a
   *   real one, heal just the locator and its derived telemetry. This
   *   self-corrects records persisted with a bad path (e.g. nested runs written
   *   before the sibling-locator fix).
   */
  function persist(run: Run): void {
    const existing = store.forRun(run.identityKey, run.runId);
    const lowerPrecedence =
      existing !== undefined &&
      existing.source !== undefined &&
      existing.source !== 'transcript' &&
      canOverwrite(existing.source, 'transcript');
    if (existing === undefined || lowerPrecedence) {
      store.upsert({ ...run, source: 'transcript' });
      return;
    }
    const locatorStale =
      existing.sidechainPath === undefined || !existsSync(existing.sidechainPath);
    const healed = locatorStale && run.sidechainPath !== undefined && existsSync(run.sidechainPath);
    const tags = run.tags.includes('incomplete')
      ? existing.tags
      : existing.tags.filter((t) => t !== 'incomplete');
    const updated: Run = {
      ...existing,
      status: run.status ?? existing.status,
      totalDurationMs: run.totalDurationMs ?? existing.totalDurationMs,
      totalTokens: run.totalTokens ?? existing.totalTokens,
      totalToolUseCount: run.totalToolUseCount ?? existing.totalToolUseCount,
      toolStats: run.toolStats ?? existing.toolStats,
      parentAgentId: run.parentAgentId ?? existing.parentAgentId,
      spawnDepth: run.spawnDepth ?? existing.spawnDepth,
      tags,
      telemetry: run.telemetry ?? existing.telemetry,
      ...((healed || run.sidechainPath === existing.sidechainPath) && {
        sidechainSize: run.sidechainSize ?? existing.sidechainSize,
        sidechainMtimeMs: run.sidechainMtimeMs ?? existing.sidechainMtimeMs,
      }),
      ...(healed && { sidechainPath: run.sidechainPath, telemetry: run.telemetry }),
    };
    if (JSON.stringify(updated) !== JSON.stringify(existing)) {
      store.upsert(updated);
    }
  }

  for (const transcript of discoverTranscripts(options.projectsRoot)) {
    const file = extraction(transcript, false);
    collectNotifications(file);
    for (const raw of file.runs) {
      if (seenAgentIds.has(raw.agentId)) continue;
      seenAgentIds.add(raw.agentId);
      const run = assembleLegacy(raw, transcript);
      legacyRuns.set(raw.agentId, run);
      if (run !== null) {
        persist(run);
      }
    }
  }

  for (const sidechainPath of discoverSidechains(options.projectsRoot)) {
    const parentAgentId = parseSidechainParentAgentId(sidechainPath);
    const file = extraction(sidechainPath, true);
    collectNotifications(file);
    for (const raw of file.runs) {
      if (seenAgentIds.has(raw.agentId)) continue;
      seenAgentIds.add(raw.agentId);
      const run = assembleLegacy(raw, sidechainPath, parentAgentId);
      legacyRuns.set(raw.agentId, run);
      if (run !== null) {
        persist(run);
      }
    }
  }

  for (const candidate of discoverMetaRuns(options.projectsRoot)) {
    try {
      const st = statOf(candidate.sidechainPath);
      const status = notificationStatus.get(candidate.agentId);
      const legacy = legacyRuns.get(candidate.agentId);

      // Fast path: attribute from the cached sub-transcript facts, and skip the
      // sub-transcript read when nothing about the run can have changed (FR-36).
      const cached = st && cache.get(candidate.sidechainPath, st.size, st.mtimeMs);
      if (cached && cached.facts !== undefined) {
        const identity = resolveRunIdentity(
          { agentType: candidate.meta.agentType, cwd: cached.facts.cwd },
          options.sources,
        );
        if (identity === null) continue;
        const key = identityKey(identity);
        const sameLegacy = legacy != null && legacy.identityKey === key;
        if (sameLegacy && isLegacyComplete(legacy)) {
          persist(mergeCompleteLegacy(legacy, candidate.meta));
          continue;
        }
        const existing = sameLegacy ? undefined : store.forRun(key, candidate.agentId);
        if (isUnchanged(existing, candidate.sidechainPath, st)) {
          seenAgentIds.add(candidate.agentId);
          persist({
            ...existing,
            status: status ?? existing.status,
            parentAgentId: candidate.meta.parentAgentId ?? existing.parentAgentId,
            spawnDepth: candidate.meta.spawnDepth ?? existing.spawnDepth,
          });
          continue;
        }
      }

      const assembled = assembleCapturedRun(
        {
          agentId: candidate.agentId,
          agentType: candidate.meta.agentType,
          sidechainPath: candidate.sidechainPath,
          status,
          meta: candidate.meta,
        },
        options.sources,
      );
      if (assembled === null) continue;
      const metaRun = withStat(assembled, st);
      if (seenAgentIds.has(candidate.agentId)) {
        // Seen by a legacy path: merge when both attribute to the same identity.
        // A different identity is a different `(identityKey, runId)` key (FR-16),
        // so the meta run is stored on its own.
        persist(
          legacy != null && legacy.identityKey === metaRun.identityKey
            ? mergeLegacyWithMeta(legacy, metaRun)
            : metaRun,
        );
        continue;
      }
      seenAgentIds.add(candidate.agentId);
      persist(metaRun);
    } catch {
      // A single unreadable run must never abort ingestion or drop the others.
    }
  }

  cache.prune(discoveredPaths);
  cache.save();

  return store.list();
}
