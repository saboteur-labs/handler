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
import { assembleRun, type Run } from './run';
import type { AgentSource } from './sources/source';
import { RunStore } from './store/run-store';
import { discoverSidechains, discoverTranscripts } from './transcripts/discover';
import { extractRuns } from './transcripts/extract';
import { readJsonl } from './transcripts/jsonl';
import { parseSidechainParentAgentId } from './transcripts/sidechain';

export interface IngestOptions {
  /** Registered agent sources to attribute against (e.g. `registry.list()`). */
  readonly sources: readonly AgentSource[];
  /** Transcripts root; defaults to `~/.claude/projects`. */
  readonly projectsRoot?: string;
  /** Run-store location; defaults to `~/.handler/runs.json`. */
  readonly storePath?: string;
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
 */
export function ingest(options: IngestOptions): Run[] {
  const store = new RunStore(options.storePath);
  // In-process dedup: tracks agentIds seen within this single ingest call.
  // Prevents calling assembleRun or store.upsert more than once for the same
  // agentId when it appears in both a top-level transcript and a sidechain.
  // The store's (identityKey, runId) upsert no-op remains as a cross-call guard.
  const seenAgentIds = new Set<string>();

  for (const transcript of discoverTranscripts(options.projectsRoot)) {
    for (const raw of extractRuns(readJsonl(transcript))) {
      if (seenAgentIds.has(raw.agentId)) continue;
      seenAgentIds.add(raw.agentId);
      const run = assembleRun(raw, options.sources, transcript);
      if (run !== null) {
        // Transcript is authoritative, but the first transcript snapshot of a
        // run wins: enrich a real-time `hook` stub, yet never overwrite an
        // existing transcript record — re-ingesting after a definition edit
        // must preserve each run's original definition snapshot so history
        // survives renames/edits (mirrors the old `add` dedup-no-op).
        const existing = store.forRun(run.identityKey, run.runId);
        if (existing === undefined || existing.source === 'hook') {
          store.upsert({ ...run, source: 'transcript' });
        }
      }
    }
  }

  for (const sidechainPath of discoverSidechains(options.projectsRoot)) {
    const parentAgentId = parseSidechainParentAgentId(sidechainPath);
    for (const raw of extractRuns(readJsonl(sidechainPath))) {
      if (seenAgentIds.has(raw.agentId)) continue;
      seenAgentIds.add(raw.agentId);
      const run = assembleRun(raw, options.sources, sidechainPath, parentAgentId);
      if (run !== null) {
        const existing = store.forRun(run.identityKey, run.runId);
        if (existing === undefined || existing.source === 'hook') {
          store.upsert({ ...run, source: 'transcript' });
        }
      }
    }
  }

  return store.list();
}
