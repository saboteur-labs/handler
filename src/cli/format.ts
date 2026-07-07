/**
 * Small numeric formatters shared across CLI commands, plus finding-severity
 * formatting helpers used by `assess`.
 *
 * Delta values carry a sign; absolute values do not. Both render `undefined`
 * (an unscored side, or a missing delta) as `n/a` so the CLI never prints a
 * misleading 0.
 */
import chalk from 'chalk';

import type { Finding, Severity } from '../core/index';
import { compareSeverity } from '../core/index';

/** Signed number to one decimal, or `n/a` when undefined. */
export function signed(value: number | undefined): string {
  if (value === undefined) {
    return 'n/a';
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

/** Signed percentage-point delta from a 0–1 rate delta, or `n/a`. */
export function signedPercent(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${signed(value * 100)}%`;
}

/** Absolute number to one decimal, or `n/a` when undefined. */
export function decimal(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${Math.round(value * 10) / 10}`;
}

/** Absolute 0–1 rate as a whole percentage, or `n/a` when undefined. */
export function percent(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${Math.round(value * 100)}%`;
}

/**
 * Sort comparator ordering `error` findings first, then `warn`, then `info`.
 * Defers to core's `compareSeverity` (the severity ordering is domain logic);
 * this is the `Finding`-level adapter used to order `assess` output.
 */
export function compareBySeverity(a: Finding, b: Finding): number {
  return compareSeverity(a.severity, b.severity);
}

/**
 * Colorize a severity label: `error` red, `warn` yellow, `info` cyan. Used
 * consistently for every finding line `assess` prints.
 */
export function severityLabel(severity: Severity): string {
  switch (severity) {
    case 'error':
      return chalk.red(severity);
    case 'warn':
      return chalk.yellow(severity);
    case 'info':
      return chalk.cyan(severity);
  }
}

/**
 * Format a single finding as a two-part line: `[severity] check  message`,
 * with an indented dim `suggestion: ...` line when present. When
 * `suppressed` is true, the whole line (including the suggestion) is dimmed
 * and marked `(suppressed)`.
 */
export function formatFinding(finding: Finding, suppressed = false): string[] {
  const marker = suppressed ? ' (suppressed)' : '';
  const head =
    `  [${severityLabel(finding.severity)}] ${finding.check}  ${finding.message}` + marker;
  const lines = [suppressed ? chalk.dim(head) : head];
  if (finding.suggestion !== undefined) {
    const suggestion = `    suggestion: ${finding.suggestion}`;
    lines.push(chalk.dim(suggestion));
  }
  return lines;
}
