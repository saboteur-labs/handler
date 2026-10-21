/**
 * SubagentStop hook handler (subagent-run-capture FR-7, FR-16, FR-18, FR-19, FR-22).
 *
 * `handleSubagentStop` is the single entry point for real-time run capture
 * from Claude Code's `SubagentStop` hook. It parses the real snake_case
 * payload, assembles the run from `agent_transcript_path` via the shared
 * capture assembler, and upserts it respecting source precedence. All errors
 * are caught: the function never throws.
 */

import { assembleCapturedRun } from '../capture-run';
import type { AgentSource } from '../sources/source';
import { canOverwrite } from '../store/precedence';
import type { RunStore } from '../store/run-store';
import { parseHookPayload } from './payload';

/** Outcome of a single hook invocation. */
export type HandleResult = 'captured' | 'skipped' | 'malformed';

/**
 * Handle a single `SubagentStop` hook invocation.
 *
 * - `'malformed'` - payload failed to parse (or an unexpected error occurred);
 *                   store is not touched.
 * - `'skipped'`   - empty/absent `agent_type`, a builtin/plugin agent, or an
 *                   agent unresolvable to any source; store is not touched.
 * - `'captured'`  - run assembled and, unless a `transcript` record already
 *                   exists, upserted. A missing or incomplete sub-transcript is
 *                   kept and tagged `incomplete` with metrics unset.
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
    if (parsed.agentType === '') {
      return 'skipped';
    }

    const run = assembleCapturedRun(
      {
        agentId: parsed.agentId,
        agentType: parsed.agentType,
        sidechainPath: parsed.agentTranscriptPath ?? '',
        fallback: { cwd: parsed.cwd, sessionId: parsed.sessionId },
      },
      sources,
    );
    if (run === null) {
      return 'skipped';
    }

    // Precedence transcript > hook > runlog: never replace a higher-ranked record.
    const existing = store.forRun(run.identityKey, run.runId);
    if (canOverwrite(existing?.source, 'hook')) {
      store.upsert({ ...run, source: 'hook' });
    }
    return 'captured';
  } catch {
    return 'malformed';
  }
}
