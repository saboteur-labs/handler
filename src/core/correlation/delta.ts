/**
 * Definition-change deltas (feature-6 Req 5).
 *
 * For each point where an agent's definition changed between two *known*
 * versions, aggregates the runs on each side and reports the before/after
 * delta. The headline is the Feature 3 behavioral composite; its terminal-status
 * and tool-error figures are reported as composite components (not independent
 * signals). Token total is a cost lens.
 *
 * Trustworthiness, not metric count, is the design goal:
 * - Aggregate by definition version (all runs on a side), never a single-run
 *   pair, so one noisy run does not define the delta.
 * - Composites come from `scoreRun`, which (re)scores under the current
 *   `RUBRIC_VERSION`, so a before/after composite comparison is always
 *   same-rubric and a rubric change is never mistaken for a definition effect.
 * - A side with fewer than `MIN_RUNS_FOR_CONFIDENCE` scored runs is flagged
 *   `lowConfidence`.
 * - Change points across an orphan (unknown) version are skipped — a delta is
 *   only attributable when both sides are real, captured definitions.
 */
import type { Run } from '../run';
import { scoreRun } from '../scoring/score';
import type { ScoreStore } from '../store/score-store';
import { segmentByDefinition, type DefinitionVersion } from './versions';

/** Minimum scored runs per side before a delta is treated as reliable. */
export const MIN_RUNS_FOR_CONFIDENCE = 2;

export interface SideAggregate {
  /** Runs in the version. */
  readonly runCount: number;
  /** Runs that produced a Score (have a locatable/cached score). */
  readonly scoredRunCount: number;
  /** Mean behavioral composite over scored runs, or `undefined` when none scored. */
  readonly meanComposite: number | undefined;
  /** Fraction of scored runs that reached a successful terminal status. */
  readonly terminalSuccessRate: number | undefined;
  /** Total tool errors across the side's runs (a composite component). */
  readonly toolErrorCount: number;
  /** Total tokens across the side's runs. */
  readonly tokenTotal: number;
}

export interface DefinitionChangeDelta {
  readonly before: DefinitionVersion;
  readonly after: DefinitionVersion;
  readonly beforeAggregate: SideAggregate;
  readonly afterAggregate: SideAggregate;
  /** after − before mean composite, or `undefined` when either side is unscored. */
  readonly compositeDelta: number | undefined;
  readonly terminalSuccessRateDelta: number | undefined;
  readonly toolErrorCountDelta: number;
  readonly tokenTotalDelta: number;
  /** True when either side has fewer than `MIN_RUNS_FOR_CONFIDENCE` scored runs. */
  readonly lowConfidence: boolean;
}

/**
 * Compute a before/after delta for each known→known definition change in one
 * agent identity's runs. `scoreStore` caches/recomputes scores under the
 * current rubric.
 */
export function definitionChangeDeltas(
  runs: readonly Run[],
  scoreStore: ScoreStore,
): DefinitionChangeDelta[] {
  const { changePoints } = segmentByDefinition(runs);
  const deltas: DefinitionChangeDelta[] = [];

  for (const { before, after } of changePoints) {
    if (before.snapshotHash === null || after.snapshotHash === null) {
      continue; // unknown boundary — a delta is not attributable to an edit
    }
    const beforeAggregate = aggregate(before, scoreStore);
    const afterAggregate = aggregate(after, scoreStore);
    deltas.push({
      before,
      after,
      beforeAggregate,
      afterAggregate,
      compositeDelta: diff(beforeAggregate.meanComposite, afterAggregate.meanComposite),
      terminalSuccessRateDelta: diff(
        beforeAggregate.terminalSuccessRate,
        afterAggregate.terminalSuccessRate,
      ),
      toolErrorCountDelta: afterAggregate.toolErrorCount - beforeAggregate.toolErrorCount,
      tokenTotalDelta: afterAggregate.tokenTotal - beforeAggregate.tokenTotal,
      lowConfidence:
        beforeAggregate.scoredRunCount < MIN_RUNS_FOR_CONFIDENCE ||
        afterAggregate.scoredRunCount < MIN_RUNS_FOR_CONFIDENCE,
    });
  }

  return deltas;
}

/** Aggregate one definition version's runs into a comparable summary. */
function aggregate(version: DefinitionVersion, scoreStore: ScoreStore): SideAggregate {
  let scoredRunCount = 0;
  let compositeSum = 0;
  let terminalPassCount = 0;
  let toolErrorCount = 0;
  let tokenTotal = 0;

  for (const run of version.runs) {
    tokenTotal += run.totalTokens ?? 0;
    toolErrorCount += run.telemetry?.toolErrors.length ?? 0;
    const score = scoreRun(run, scoreStore);
    if (score !== null) {
      scoredRunCount += 1;
      compositeSum += score.composite;
      if (score.breakdown.find((c) => c.id === 'terminal')?.status === 'pass') {
        terminalPassCount += 1;
      }
    }
  }

  return {
    runCount: version.runs.length,
    scoredRunCount,
    meanComposite: scoredRunCount > 0 ? compositeSum / scoredRunCount : undefined,
    terminalSuccessRate: scoredRunCount > 0 ? terminalPassCount / scoredRunCount : undefined,
    toolErrorCount,
    tokenTotal,
  };
}

/** after − before, or `undefined` when either operand is absent. */
function diff(before: number | undefined, after: number | undefined): number | undefined {
  return before === undefined || after === undefined ? undefined : after - before;
}
