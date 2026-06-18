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
import { discoverTranscripts } from './transcripts/discover';
import { extractRuns } from './transcripts/extract';
import { readJsonl } from './transcripts/jsonl';

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
 */
export function ingest(options: IngestOptions): Run[] {
  const store = new RunStore(options.storePath);
  for (const transcript of discoverTranscripts(options.projectsRoot)) {
    for (const raw of extractRuns(readJsonl(transcript))) {
      const run = assembleRun(raw, options.sources);
      if (run !== null) {
        store.add(run);
      }
    }
  }
  return store.list();
}
