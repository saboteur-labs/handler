/**
 * Returns the median of an array of numbers.
 * Returns `undefined` for an empty array.
 * Exact for both odd and even counts (even: average of the two middle values).
 * Sorts a copy; does not mutate input.
 */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}
