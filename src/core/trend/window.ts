import type { TrendRow } from './series';

/**
 * Drops runs whose timestamp is before the given ISO date (inclusive of the date).
 * "Before" means the run's timestamp string is lexicographically less than `sinceDate`.
 * Missing-timestamp runs are EXCLUDED (they have no timestamp to compare).
 *
 * @param series - the series to filter
 * @param sinceDate - ISO date string 'YYYY-MM-DD' (inclusive lower bound)
 */
export function filterSince(series: readonly TrendRow[], sinceDate: string): TrendRow[] {
  return series.filter(
    (row) => !row.missingTimestamp && row.timestamp !== undefined && row.timestamp >= sinceDate,
  );
}

/**
 * Keeps the N most-recent runs by timestamp.
 * - Ordering: timestamped runs come before missing-timestamp runs (same as buildTrendSeries ordering)
 * - Missing-timestamp runs ARE retained if they fall within the most-recent N after ordering
 * - N <= 0: returns []
 * - N >= series.length: returns the full series (same order)
 *
 * @param series - the series to filter (expected oldest→newest, missing-timestamp last)
 * @param n - number of most-recent runs to keep
 */
export function filterLast(series: readonly TrendRow[], n: number): TrendRow[] {
  if (n <= 0) {
    return [];
  }
  return series.slice(-n);
}
