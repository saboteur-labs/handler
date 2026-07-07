/**
 * Severity ordering and threshold logic for static-assessment findings
 * (feature-static-assessment FR-22, FR-23).
 *
 * This is domain logic, not presentation: the ordering of the `Severity` type
 * and the "meets or exceeds a threshold" rule that drives the `--fail-on`
 * CI-gate decision both live here so any consumer of core (the CLI today, a
 * GUI tomorrow) shares one definition rather than re-deriving it. Colorizing a
 * severity label is presentation and stays in the CLI.
 */
import type { Severity } from './check';

/**
 * Priority rank of a severity — lower is more severe (`error` < `warn` <
 * `info`). "Meets or exceeds a threshold" therefore means rank at or below the
 * threshold's rank.
 */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 0,
  warn: 1,
  info: 2,
};

/** Comparator ordering more-severe first (`error`, then `warn`, then `info`). */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

/**
 * True when `severity` meets or exceeds `threshold` in priority — equal or
 * more severe. E.g. `('warn', 'warn')` and `('error', 'warn')` are both true,
 * but `('info', 'warn')` is false.
 */
export function meetsOrExceedsSeverity(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[threshold];
}
