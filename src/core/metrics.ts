/**
 * Per-agent metric aggregation (spec Req 11).
 *
 * Folds an agent's runs into the figures the CLI shows: invocation count,
 * duration, tool usage, token total, and last-used date. Cost is reported as
 * token totals only — no derived dollar figure (a deferred v1 concern).
 *
 * Incomplete runs (no completed summary) are counted as invocations but kept
 * out of the duration/token/tool totals, since their summary numbers are
 * absent or unreliable; `lastUsed`, by contrast, considers every run.
 */
import type { Run, ToolStats } from './run';

export interface AgentMetrics {
  /** All runs, complete or not. */
  readonly invocationCount: number;
  readonly completedCount: number;
  readonly incompleteCount: number;
  /** Summed over completed runs. */
  readonly totalDurationMs: number;
  /** Mean duration over completed runs, or `undefined` when there are none. */
  readonly averageDurationMs: number | undefined;
  readonly totalTokens: number;
  readonly totalToolUseCount: number;
  /** Per-tool counts summed across completed runs. */
  readonly toolStats: ToolStats;
  /** Latest run timestamp (ISO 8601), or `undefined` when none is recorded. */
  readonly lastUsed: string | undefined;
}

/** Aggregate an agent's runs into display metrics. */
export function aggregateMetrics(runs: readonly Run[]): AgentMetrics {
  const completed = runs.filter((run) => !run.tags.includes('incomplete'));
  const toolStats: Record<string, number> = {};
  let totalDurationMs = 0;
  let totalTokens = 0;
  let totalToolUseCount = 0;

  for (const run of completed) {
    totalDurationMs += run.totalDurationMs ?? 0;
    totalTokens += run.totalTokens ?? 0;
    totalToolUseCount += run.totalToolUseCount ?? 0;
    for (const [tool, count] of Object.entries(run.toolStats ?? {})) {
      toolStats[tool] = (toolStats[tool] ?? 0) + count;
    }
  }

  return {
    invocationCount: runs.length,
    completedCount: completed.length,
    incompleteCount: runs.length - completed.length,
    totalDurationMs,
    averageDurationMs: completed.length > 0 ? totalDurationMs / completed.length : undefined,
    totalTokens,
    totalToolUseCount,
    toolStats,
    lastUsed: latestTimestamp(runs),
  };
}

function latestTimestamp(runs: readonly Run[]): string | undefined {
  let latest: string | undefined;
  for (const { timestamp } of runs) {
    if (timestamp !== undefined && (latest === undefined || timestamp > latest)) {
      latest = timestamp;
    }
  }
  return latest;
}
