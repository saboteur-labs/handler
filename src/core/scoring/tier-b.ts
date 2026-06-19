/**
 * Tier B (reference-relative) scoring types, tunable config defaults, and orchestrator.
 *
 * Tier B compares a run's resource usage (tokens, duration, turns) against a
 * reference distribution built from prior runs of the same agent, flagging
 * outliers beyond a configurable factor of the median. A contract-output check
 * validates structured-output adherence when a contract is declared. Both the
 * outlier factor and the minimum history threshold are overridable via env vars.
 *
 * `tierBForRun` is the lazy-cache orchestrator: it returns a cached result when
 * available, otherwise computes reference + outliers + contract and persists.
 */

/** Status of a Tier B result. */
export type TierBStatus = 'applicable' | 'insufficient-history';

/** A single resource-dimension flag. */
export interface TierBFlag {
  dimension: 'tokens' | 'duration' | 'turns';
  status: 'outlier' | 'within' | 'not-measurable';
  /** The run's actual metric (undefined when not-measurable). */
  value?: number;
  /** The reference median (undefined when not-measurable). */
  median?: number;
  /** The outlier factor used. */
  factor: number;
}

/** Contract check result. */
export interface TierBContractResult {
  status: 'pass' | 'fail' | 'not-applicable';
  /** Present when a contract was detected. */
  contractType?: 'json' | 'sections';
  detail?: string;
}

/** The full Tier B result for one run. */
export interface TierBResult {
  status: TierBStatus;
  tierBVersion: number;
  /** Present when status === 'applicable'. */
  flags?: readonly TierBFlag[];
  /** Present when status === 'applicable'. */
  contract?: TierBContractResult;
}

/** Tier B annotation version. Increment when Tier B checks or semantics change. */
export const TIER_B_VERSION = 1;

/** Default outlier factor: a run is flagged when its metric exceeds 2× the reference median. */
export const DEFAULT_OUTLIER_FACTOR = 2;

/** Default minimum prior runs required before Tier B can produce a reference. */
export const DEFAULT_MIN_RUNS = 5;

/**
 * Returns the configured outlier factor.
 *
 * Reads `HANDLER_TIERB_FACTOR`. Falls back to `DEFAULT_OUTLIER_FACTOR` when
 * the env var is absent, non-numeric, zero, or negative.
 */
export function getOutlierFactor(): number {
  const raw = process.env['HANDLER_TIERB_FACTOR'];
  if (raw === undefined) {
    return DEFAULT_OUTLIER_FACTOR;
  }
  const parsed = parseFloat(raw);
  if (!isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OUTLIER_FACTOR;
  }
  return parsed;
}

/**
 * Returns the configured minimum-runs threshold.
 *
 * Reads `HANDLER_TIERB_MIN_RUNS`. Falls back to `DEFAULT_MIN_RUNS` when the
 * env var is absent, non-numeric, zero, or negative.
 */
export function getMinRuns(): number {
  const raw = process.env['HANDLER_TIERB_MIN_RUNS'];
  if (raw === undefined) {
    return DEFAULT_MIN_RUNS;
  }
  const parsed = parseInt(raw, 10);
  if (!isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MIN_RUNS;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Lazy-cache orchestrator — imported inline to avoid circular dependencies.
// These imports must never pull in score.ts or rubric.ts.
// ---------------------------------------------------------------------------

import type { Run } from '../run';
import type { TierBStore } from '../store/tier-b-store';
import { computeReference } from './tier-b-reference';
import { computeOutlierFlags } from './tier-b-outliers';
import { checkContract } from './tier-b-contract';

/**
 * Score `run` using Tier B (reference-relative) checks, caching the result in
 * `store` keyed by `TIER_B_VERSION`. Returns the cached annotation when the run
 * was already scored under the current version; otherwise computes reference,
 * outlier flags, and contract adherence, persists, and returns the result.
 *
 * NEVER touches a ScoreStore. Completely separate from Tier A.
 */
export function tierBForRun(run: Run, agentRuns: readonly Run[], store: TierBStore): TierBResult {
  const cached = store.get(run.runId, TIER_B_VERSION);
  if (cached !== undefined) {
    return cached;
  }

  const referenceResult = computeReference(run, agentRuns);

  if (referenceResult.status === 'insufficient-history') {
    const result: TierBResult = { status: 'insufficient-history', tierBVersion: TIER_B_VERSION };
    store.add({ runId: run.runId, result });
    return result;
  }

  const flags = computeOutlierFlags(run, referenceResult.reference);
  const contract = checkContract(run);
  const result: TierBResult = {
    status: 'applicable',
    tierBVersion: TIER_B_VERSION,
    flags,
    contract,
  };
  store.add({ runId: run.runId, result });
  return result;
}
