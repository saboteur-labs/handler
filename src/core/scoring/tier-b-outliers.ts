/**
 * Resource-cost outlier flags for Tier B (reference-relative) scoring.
 *
 * Given a run's metrics, a reference distribution, and an outlier factor,
 * emits one `TierBFlag` per dimension (tokens, duration, turns). A metric is
 * flagged as `outlier` when it strictly exceeds `median * factor`; at or below
 * the boundary it is `within`. When a metric is absent it is `not-measurable`.
 */

import type { Run } from '../run';
import { getOutlierFactor, type TierBFlag } from './tier-b';
import type { TierBReference } from './tier-b-reference';

/**
 * Computes one `TierBFlag` per resource dimension for the given run.
 *
 * @param run - The run to evaluate.
 * @param reference - The rolling-median reference built from prior runs.
 * @param factor - Outlier multiplier. Defaults to `getOutlierFactor()`.
 * @returns A readonly array of exactly 3 flags (tokens, duration, turns).
 */
export function computeOutlierFlags(
  run: Run,
  reference: TierBReference,
  factor: number = getOutlierFactor(),
): readonly TierBFlag[] {
  return [
    buildFlag('tokens', run.totalTokens, reference.medianTokens, factor),
    buildFlag('duration', run.totalDurationMs, reference.medianDurationMs, factor),
    buildFlag('turns', run.telemetry?.turns.length, reference.medianTurns, factor),
  ];
}

/** Construct a single `TierBFlag` for one dimension. */
function buildFlag(
  dimension: TierBFlag['dimension'],
  value: number | undefined,
  median: number,
  factor: number,
): TierBFlag {
  if (value === undefined) {
    return { dimension, status: 'not-measurable', factor };
  }
  const status: TierBFlag['status'] = value > median * factor ? 'outlier' : 'within';
  return { dimension, status, value, median, factor };
}
