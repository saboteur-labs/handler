/**
 * SubagentStop hook handler (V1 Feature 5, Task 3).
 *
 * `handleSubagentStop` is the single entry point for real-time run capture
 * from Claude Code's `SubagentStop` hook. It parses the raw payload, resolves
 * agent identity, assembles a `Run`, and upserts it into the store. All errors
 * are caught — the function never throws.
 */

import { assembleRun } from '../run';
import type { AgentSource } from '../sources/source';
import type { RunStore } from '../store/run-store';
import { parseHookPayload } from './payload';

/** Outcome of a single hook invocation. */
export type HandleResult = 'captured' | 'skipped' | 'malformed';

/**
 * Handle a single `SubagentStop` hook invocation.
 *
 * - `'malformed'` — payload failed to parse; store is not touched.
 * - `'skipped'`   — agent is a builtin/plugin or unresolvable to any source;
 *                   store is not touched.
 * - `'captured'`  — run assembled and upserted into the store (includes orphan
 *                   and incomplete runs, which are kept-and-tagged per spec Req 7).
 *
 * Never throws.
 */
export function handleSubagentStop(
  payload: unknown,
  sources: readonly AgentSource[],
  store: RunStore,
): HandleResult {
  try {
    const parsed = parseHookPayload(payload);
    if (parsed === null) {
      return 'malformed';
    }

    // Pass an empty string for transcriptPath: with hook payloads the sidechain
    // file may not exist yet. assembleRun / readRunTelemetry tolerate a missing
    // file via the existsSync guard.
    const run = assembleRun(parsed, sources, '');
    if (run === null) {
      return 'skipped';
    }

    // "Transcript always wins": if a transcript-authoritative record already
    // exists for this run, do not overwrite it with the hook stub.
    const existing = store.forRun(run.identityKey, run.runId);
    if (existing?.source !== 'transcript') {
      store.upsert({ ...run, source: 'hook' });
    }
    return 'captured';
  } catch {
    return 'malformed';
  }
}
