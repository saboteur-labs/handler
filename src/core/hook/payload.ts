/**
 * Parser for Claude Code's real snake_case `SubagentStop` hook payload.
 *
 * `parseHookPayload` never throws. It returns `null` for non-objects and for
 * payloads without a non-empty string `agent_id`; every other field is
 * optional. Extra keys (`last_assistant_message`, `background_tasks`, ...) are
 * ignored, and no `status` or totals are required: metrics come from the
 * sub-transcript, not the payload.
 *
 * Shared by the hook handler and the runlog reader.
 */

/**
 * A parsed `SubagentStop` payload.
 */
export interface HookPayload {
  /** From `agent_id`. Always a non-empty string. */
  readonly agentId: string;
  /**
   * From `agent_type`. The empty string means the field was empty, absent, or
   * not a string: this is the skip signal, since such a stop cannot be
   * attributed to a named agent. Callers must skip (and may count) it.
   */
  readonly agentType: string;
  /** From `cwd`; `undefined` when absent, empty, or not a string. */
  readonly cwd: string | undefined;
  /** From `session_id`; `undefined` when absent, empty, or not a string. */
  readonly sessionId: string | undefined;
  /** From `agent_transcript_path`; `undefined` when absent, empty, or not a string. */
  readonly agentTranscriptPath: string | undefined;
}

/** Defensively parse a raw `SubagentStop` payload. Never throws. */
export function parseHookPayload(raw: unknown): HookPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  const agentId = nonEmptyString(raw.agent_id);
  if (agentId === undefined) {
    return null;
  }
  return {
    agentId,
    agentType: nonEmptyString(raw.agent_type) ?? '',
    cwd: nonEmptyString(raw.cwd),
    sessionId: nonEmptyString(raw.session_id),
    agentTranscriptPath: nonEmptyString(raw.agent_transcript_path),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
