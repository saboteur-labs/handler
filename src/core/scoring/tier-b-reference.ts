/**
 * Per-agent rolling-median reference computation for Tier B scoring.
 *
 * Builds a self-relative reference (median tokens, duration, turn count) from
 * the runs of a given agent that are strictly prior to a target run. Requires a
 * minimum number of prior runs (configurable via `getMinRuns()`) before a
 * reference can be produced; returns `insufficient-history` otherwise.
 */

import type { Run } from '../run';
import { median } from '../trend/median';
import { getMinRuns } from './tier-b';

/** The computed median reference for a single agent, derived from prior runs. */
export interface TierBReference {
  /** Median token usage across strictly-prior runs that have token data. */
  medianTokens: number;
  /** Median duration (ms) across strictly-prior runs that have duration data. */
  medianDurationMs: number;
  /** Median turn count across strictly-prior runs that have telemetry. */
  medianTurns: number;
  /** Total number of strictly-prior runs used (regardless of per-metric completeness). */
  priorRunCount: number;
}

/** Result of computing a Tier B reference for a run. */
export type TierBReferenceResult =
  | { status: 'ok'; reference: TierBReference }
  | { status: 'insufficient-history'; priorRunCount: number };

/**
 * Computes the rolling-median reference for a target run from the agent's run history.
 *
 * Selects strictly-prior runs (timestamp < targetRun.timestamp, and not the
 * target run itself by runId), checks the min-runs gate, then computes per-dimension
 * medians excluding runs that lack the relevant metric.
 *
 * @param targetRun - The run to compute the reference for.
 * @param agentRuns - All runs for this agent (including the target run).
 * @param minRuns - Minimum prior runs required. Defaults to `getMinRuns()`.
 */
export function computeReference(
  targetRun: Run,
  agentRuns: readonly Run[],
  minRuns: number = getMinRuns(),
): TierBReferenceResult {
  const priorRuns = agentRuns.filter(
    (run) =>
      run.runId !== targetRun.runId &&
      run.timestamp !== undefined &&
      targetRun.timestamp !== undefined &&
      run.timestamp < targetRun.timestamp,
  );

  const priorRunCount = priorRuns.length;

  if (priorRunCount < minRuns) {
    return { status: 'insufficient-history', priorRunCount };
  }

  const tokenValues = priorRuns
    .filter((run) => run.totalTokens !== undefined)
    .map((run) => run.totalTokens as number);

  const durationValues = priorRuns
    .filter((run) => run.totalDurationMs !== undefined)
    .map((run) => run.totalDurationMs as number);

  const turnValues = priorRuns
    .filter((run) => run.telemetry?.turns !== undefined)
    .map((run) => run.telemetry?.turns.length ?? 0);

  const medianTokens = median(tokenValues) ?? 0;
  const medianDurationMs = median(durationValues) ?? 0;
  const medianTurns = median(turnValues) ?? 0;

  return {
    status: 'ok',
    reference: {
      medianTokens,
      medianDurationMs,
      medianTurns,
      priorRunCount,
    },
  };
}
