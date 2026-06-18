/**
 * Per-run trend series builder (v1 Feature 1, Task 1).
 *
 * Folds an agent's attributed runs and their scores into a chronological
 * `TrendRow[]` ordered oldest→newest. Runs with a missing timestamp sort last.
 * Incomplete runs appear in the series with their numeric fields set to
 * `undefined`. Unscored runs carry `undefined` for `composite` and `band`.
 *
 * This is a pure read-only function — it mutates nothing.
 */
import type { Run } from '../run';
import type { Score, ScoreBand } from '../scoring/rubric';
import { scoreRun } from '../scoring/score';
import type { ScoreStore } from '../store/score-store';

export interface TrendRow {
  runId: string;
  /** ISO 8601 timestamp, or `undefined` for a run with no recorded timestamp. */
  timestamp: string | undefined;
  /** 0–100 composite score, or `undefined` when the run is unscored. */
  composite: number | undefined;
  /** Score band, or `undefined` when the run is unscored. */
  band: ScoreBand | undefined;
  /** Run duration in milliseconds, or `undefined` for an incomplete run. */
  durationMs: number | undefined;
  /** Total tokens, or `undefined` for an incomplete run. */
  tokens: number | undefined;
  /** Total tool-use count, or `undefined` for an incomplete run. */
  toolUseCount: number | undefined;
  /** `true` when the run has the `'incomplete'` tag. */
  incomplete: boolean;
  /** `true` when the run has no recorded timestamp. */
  missingTimestamp: boolean;
}

/**
 * Order runs chronologically (oldest → newest); runs with no timestamp sort
 * last. Uses ascending ISO 8601 string comparison, which is equivalent to
 * chronological order for well-formed timestamps.
 */
function byTimestamp(a: Run, b: Run): number {
  if (a.timestamp === b.timestamp) {
    return 0;
  }
  if (a.timestamp === undefined) {
    return 1;
  }
  if (b.timestamp === undefined) {
    return -1;
  }
  return a.timestamp < b.timestamp ? -1 : 1;
}

/**
 * Build a chronological per-run trend series for an agent's runs.
 *
 * @param runs - The agent's attributed runs (any order).
 * @param scoreStore - Score store used to retrieve or compute per-run scores.
 * @returns `TrendRow[]` ordered oldest→newest, missing-timestamp runs last.
 */
export function buildTrendSeries(runs: readonly Run[], scoreStore: ScoreStore): TrendRow[] {
  if (runs.length === 0) {
    return [];
  }

  const sorted = [...runs].sort(byTimestamp);

  return sorted.map((run): TrendRow => {
    const incomplete = run.tags.includes('incomplete');
    const score: Score | null = scoreRun(run, scoreStore);

    return {
      runId: run.runId,
      timestamp: run.timestamp,
      composite: score !== null ? score.composite : undefined,
      band: score !== null ? score.band : undefined,
      durationMs: incomplete ? undefined : run.totalDurationMs,
      tokens: incomplete ? undefined : run.totalTokens,
      toolUseCount: incomplete ? undefined : run.totalToolUseCount,
      incomplete,
      missingTimestamp: run.timestamp === undefined,
    };
  });
}
