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
import { existsSync } from 'node:fs';

import { assembleCapturedRun } from './capture-run';
import { assembleRun, type Run } from './run';
import type { AgentSource } from './sources/source';
import { canOverwrite } from './store/precedence';
import { RunStore } from './store/run-store';
import { discoverMetaRuns, discoverSidechains, discoverTranscripts } from './transcripts/discover';
import { extractRuns } from './transcripts/extract';
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

/**
 * Merge a meta-discovered run into the legacy run for the same agent (FR-15).
 * A complete legacy result supplies everything and meta adds only the lineage
 * fields it lacks. An incomplete one keeps what it has and meta fills the gaps;
 * the legacy definition snapshot always stays.
 */
function mergeLegacyWithMeta(legacy: Run, meta: Run): Run {
  const lineage = {
    parentAgentId: legacy.parentAgentId ?? meta.parentAgentId,
    spawnDepth: legacy.spawnDepth ?? meta.spawnDepth,
  };
  if (isLegacyComplete(legacy)) {
    return { ...legacy, ...lineage };
  }
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

  function collectNotifications(entries: readonly unknown[]): void {
    for (const [agentId, status] of latestStatusByAgentId(entries)) {
      notificationStatus.set(agentId, status);
    }
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
      ...(healed && { sidechainPath: run.sidechainPath, telemetry: run.telemetry }),
    };
    if (JSON.stringify(updated) !== JSON.stringify(existing)) {
      store.upsert(updated);
    }
  }

  for (const transcript of discoverTranscripts(options.projectsRoot)) {
    const entries = readJsonl(transcript);
    collectNotifications(entries);
    for (const raw of extractRuns(entries)) {
      if (seenAgentIds.has(raw.agentId)) continue;
      seenAgentIds.add(raw.agentId);
      const run = assembleRun(raw, options.sources, transcript);
      legacyRuns.set(raw.agentId, run);
      if (run !== null) {
        persist(run);
      }
    }
  }

  for (const sidechainPath of discoverSidechains(options.projectsRoot)) {
    const parentAgentId = parseSidechainParentAgentId(sidechainPath);
    const entries = readJsonl(sidechainPath);
    collectNotifications(entries);
    for (const raw of extractRuns(entries)) {
      if (seenAgentIds.has(raw.agentId)) continue;
      seenAgentIds.add(raw.agentId);
      const run = assembleRun(raw, options.sources, sidechainPath, parentAgentId);
      legacyRuns.set(raw.agentId, run);
      if (run !== null) {
        persist(run);
      }
    }
  }

  for (const candidate of discoverMetaRuns(options.projectsRoot)) {
    try {
      const metaRun = assembleCapturedRun(
        {
          agentId: candidate.agentId,
          agentType: candidate.meta.agentType,
          sidechainPath: candidate.sidechainPath,
          status: notificationStatus.get(candidate.agentId),
          meta: candidate.meta,
        },
        options.sources,
      );
      if (metaRun === null) continue;
      const legacy = legacyRuns.get(candidate.agentId);
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

  return store.list();
}
