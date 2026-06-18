/**
 * Small numeric formatters shared across CLI commands.
 *
 * Delta values carry a sign; absolute values do not. Both render `undefined`
 * (an unscored side, or a missing delta) as `n/a` so the CLI never prints a
 * misleading 0.
 */

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
