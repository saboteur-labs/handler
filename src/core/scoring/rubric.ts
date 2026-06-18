/**
 * Scoring rubric (spec Reqs 1, 3, 12).
 *
 * Folds the deterministic Tier A + utilization checks into a per-run `Score`
 * with three layers: a per-check `breakdown` (each pass/warn/fail/na with a
 * human detail), an overall `band`, and a 0–100 `composite`. The composite
 * uses fixed, documented deduction weights — it is reproducible, never tuned
 * per run — and the band is the worst check severity. Bump `RUBRIC_VERSION`
 * whenever weights or checks change; scores are annotated with it so history
 * survives rubric changes (Req 12).
 */
import type { ActivityChecks } from './checks-activity';
import type { BoundaryChecks } from './checks-boundary';
import type { ScopeChecks } from './checks-scope';

/** Rubric identity. Increment on any change to checks or weights. */
export const RUBRIC_VERSION = 1;

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na';
export type ScoreBand = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface Score {
  readonly band: ScoreBand;
  /** 0–100, from fixed deduction weights. */
  readonly composite: number;
  readonly breakdown: readonly CheckResult[];
  readonly rubricVersion: number;
}

export interface RubricInputs {
  readonly activity: ActivityChecks;
  readonly scope: ScopeChecks;
  readonly boundary: BoundaryChecks;
}

/** Points deducted from 100 when a check is warn or fail. Fixed and documented. */
const DEDUCTIONS: Record<string, number> = {
  'tool-scope': 25,
  'path-boundary': 25,
  terminal: 20,
  denials: 10,
  'tool-errors': 10,
  thrash: 10,
  'tool-utilization': 5,
  'undeclared-scope': 5,
};

/** Apply the rubric to a run's check results. */
export function applyRubric(inputs: RubricInputs): Score {
  const breakdown = buildBreakdown(inputs);
  return {
    band: bandFor(breakdown),
    composite: compositeFor(breakdown),
    breakdown,
    rubricVersion: RUBRIC_VERSION,
  };
}

function buildBreakdown({ activity, scope, boundary }: RubricInputs): CheckResult[] {
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return [
    {
      id: 'terminal',
      label: 'Terminal status',
      status: activity.terminalSuccess ? 'pass' : 'fail',
      detail: activity.terminalSuccess ? 'completed' : 'did not reach a successful terminal status',
    },
    {
      id: 'tool-scope',
      label: 'Tool-scope adherence',
      status: !scope.applicable ? 'na' : scope.unauthorizedTools.length > 0 ? 'fail' : 'pass',
      detail: !scope.applicable
        ? 'n/a — no tools scope declared'
        : scope.unauthorizedTools.length > 0
          ? `used ungranted: ${scope.unauthorizedTools.join(', ')}`
          : 'all used tools are granted',
    },
    {
      id: 'tool-utilization',
      label: 'Tool utilization',
      status: !scope.applicable ? 'na' : scope.unusedTools.length > 0 ? 'warn' : 'pass',
      detail: !scope.applicable
        ? 'n/a — no tools scope declared'
        : scope.unusedTools.length > 0
          ? `granted but unused: ${scope.unusedTools.join(', ')}`
          : 'all granted tools were used',
    },
    {
      id: 'undeclared-scope',
      label: 'Declared scope',
      status: scope.undeclaredScope ? 'warn' : 'pass',
      detail: scope.undeclaredScope ? 'definition declares no tools scope' : 'tools scope declared',
    },
    {
      id: 'denials',
      label: 'Permission denials',
      status: activity.denials > 0 ? 'warn' : 'pass',
      detail: count(activity.denials, 'permission denial'),
    },
    {
      id: 'tool-errors',
      label: 'Tool errors',
      status: activity.toolErrors > 0 ? 'warn' : 'pass',
      detail: count(activity.toolErrors, 'tool error'),
    },
    {
      id: 'thrash',
      label: 'Thrash',
      status: activity.thrashEvents > 0 ? 'warn' : 'pass',
      detail: count(activity.thrashEvents, 'thrash event'),
    },
    {
      id: 'path-boundary',
      label: 'Path/scope boundary',
      status: boundary.violations.length > 0 ? 'fail' : 'pass',
      detail:
        boundary.violations.length > 0
          ? `${count(boundary.violations.length, 'out-of-scope write')}: ${boundary.violations
              .map((v) => v.path)
              .join(', ')}`
          : 'all writes within scope',
    },
  ];
}

/** The band is the worst check severity: any fail → fail, else any warn → warn. */
function bandFor(breakdown: readonly CheckResult[]): ScoreBand {
  if (breakdown.some((c) => c.status === 'fail')) {
    return 'fail';
  }
  if (breakdown.some((c) => c.status === 'warn')) {
    return 'warn';
  }
  return 'pass';
}

function compositeFor(breakdown: readonly CheckResult[]): number {
  const deducted = breakdown.reduce((total, check) => {
    const penalize = check.status === 'warn' || check.status === 'fail';
    return penalize ? total + (DEDUCTIONS[check.id] ?? 0) : total;
  }, 0);
  return Math.max(0, 100 - deducted);
}
