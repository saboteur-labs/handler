/**
 * Task-result extraction (spec Reqs 2, 6, 7, 12).
 *
 * Attribution is deterministic, not heuristic: a parent-session entry whose
 * `toolUseResult` carries an `agentType` (the agent name) and `agentId` (the
 * join key to the per-run sub-transcript) is a subagent run. This layer turns
 * such entries into clean `RawRun`s, pulling the summary metrics straight from
 * `toolUseResult` and the run's `cwd` from the entry.
 *
 * It guards on schema presence rather than assuming it (Req 7): entries that
 * aren't subagent Task results are skipped, and a run lacking a completed
 * summary (interrupted, or a future schema change that drops fields) is kept
 * and tagged `incomplete` rather than dropped (Req 6). Nothing here throws on
 * unexpected input.
 */

/** Tool-usage counts from `toolUseResult.toolStats` (e.g. `readCount`). */
export type ToolStats = Readonly<Record<string, number>>;

/** A subagent run extracted from a parent-session Task result. */
export interface RawRun {
  readonly agentType: string;
  readonly agentId: string;
  /** The run's recorded working directory; absent on a malformed entry. */
  readonly cwd: string | undefined;
  /** Parent session id; joins the run to its per-run sub-transcript. */
  readonly sessionId: string | undefined;
  /** ISO 8601 entry timestamp; absent on a malformed entry. */
  readonly timestamp: string | undefined;
  readonly status: string | undefined;
  readonly totalDurationMs: number | undefined;
  readonly totalTokens: number | undefined;
  readonly totalToolUseCount: number | undefined;
  readonly toolStats: ToolStats | undefined;
  /** True when the run has no completed summary (interrupted or drifted). */
  readonly incomplete: boolean;
}

/** Extract every subagent run from a parent session's parsed entries. */
export function extractRuns(entries: readonly unknown[]): RawRun[] {
  const runs: RawRun[] = [];
  for (const entry of entries) {
    const run = extractRun(entry);
    if (run !== null) {
      runs.push(run);
    }
  }
  return runs;
}

function extractRun(entry: unknown): RawRun | null {
  if (!isRecord(entry)) {
    return null;
  }
  const result = entry.toolUseResult;
  if (!isRecord(result)) {
    return null;
  }
  const agentType = result.agentType;
  const agentId = result.agentId;
  if (!isNonEmptyString(agentType) || !isNonEmptyString(agentId)) {
    return null;
  }

  const status = isNonEmptyString(result.status) ? result.status : undefined;
  const totalDurationMs = asFiniteNumber(result.totalDurationMs);
  const totalTokens = asFiniteNumber(result.totalTokens);
  const totalToolUseCount = asFiniteNumber(result.totalToolUseCount);
  const incomplete =
    status !== 'completed' ||
    totalDurationMs === undefined ||
    totalTokens === undefined ||
    totalToolUseCount === undefined;

  return {
    agentType,
    agentId,
    cwd: isNonEmptyString(entry.cwd) ? entry.cwd : undefined,
    sessionId: isNonEmptyString(entry.sessionId) ? entry.sessionId : undefined,
    timestamp: isNonEmptyString(entry.timestamp) ? entry.timestamp : undefined,
    status,
    totalDurationMs,
    totalTokens,
    totalToolUseCount,
    toolStats: asToolStats(result.toolStats),
    incomplete,
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

/** Keep only the numeric entries of a `toolStats` record; else `undefined`. */
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
