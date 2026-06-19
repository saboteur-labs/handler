/**
 * Hook payload parser for Claude Code's `SubagentStop` hook.
 *
 * `parseHookPayload` defensively parses the raw JSON object Claude Code passes
 * to the hook. It never throws. It returns `null` for any malformed or missing
 * input, and a typed `HookPayload` only when all required fields are present
 * with the correct types. Optional fields default to `undefined` when absent or
 * of the wrong type.
 *
 * `HookPayload` is structurally compatible with `RawRun` so `assembleRun` can
 * accept it directly without a conversion step.
 */

import type { ToolStats } from '../transcripts/extract';

/**
 * A parsed, typed payload from a Claude Code `SubagentStop` hook invocation.
 * Structurally compatible with `RawRun` so it can be passed to `assembleRun`
 * without conversion.
 *
 * Required fields (`cwd`, `sessionId`) are narrowed to `string` (rather than
 * `string | undefined` in `RawRun`) because the parser enforces their presence.
 * `incomplete` defaults to `false` when absent from the payload, keeping
 * structural compatibility with `RawRun` which requires `boolean`.
 */
export interface HookPayload {
  /** Required: the run id. */
  readonly agentId: string;
  /** Required: the agent name. */
  readonly agentType: string;
  /** Required: the working directory at the time of the run. */
  readonly cwd: string;
  /** Required: the parent session id. */
  readonly sessionId: string;
  /** Required: run outcome. */
  readonly status: string;
  readonly totalDurationMs: number | undefined;
  readonly totalTokens: number | undefined;
  readonly totalToolUseCount: number | undefined;
  readonly toolStats: ToolStats | undefined;
  readonly timestamp: string | undefined;
  /** Defaults to `false` when absent from the hook payload. */
  readonly incomplete: boolean;
}

/**
 * Defensively parse a raw `SubagentStop` hook payload.
 *
 * Returns `null` for any malformed or missing input. Returns a typed
 * `HookPayload` when all required fields are present with the correct types.
 * Optional fields absent from the input are `undefined` on the returned object.
 * Never throws.
 */
export function parseHookPayload(raw: unknown): HookPayload | null {
  if (!isRecord(raw)) {
    return null;
  }

  const agentId = raw.agentId;
  const agentType = raw.agentType;
  const cwd = raw.cwd;
  const sessionId = raw.sessionId;
  const status = raw.status;

  if (
    !isNonEmptyString(agentId) ||
    !isNonEmptyString(agentType) ||
    !isNonEmptyString(cwd) ||
    !isNonEmptyString(sessionId) ||
    !isNonEmptyString(status)
  ) {
    return null;
  }

  return {
    agentId,
    agentType,
    cwd,
    sessionId,
    status,
    totalDurationMs: asFiniteNumber(raw.totalDurationMs),
    totalTokens: asFiniteNumber(raw.totalTokens),
    totalToolUseCount: asFiniteNumber(raw.totalToolUseCount),
    toolStats: asToolStats(raw.toolStats),
    timestamp: isNonEmptyString(raw.timestamp) ? raw.timestamp : undefined,
    incomplete: typeof raw.incomplete === 'boolean' ? raw.incomplete : false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asToolStats(value: unknown): ToolStats | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stats: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = asFiniteNumber(raw);
    if (n !== undefined) {
      stats[key] = n;
    }
  }
  return stats;
}
