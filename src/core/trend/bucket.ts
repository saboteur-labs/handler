import { median } from './median';
import type { TrendRow } from './series';

export type BucketGranularity = 'day' | 'week';

export interface BucketRow {
  /** 'YYYY-MM-DD' for day buckets, 'YYYY-Www' (ISO week) for week buckets */
  bucket: string;
  count: number;
  medianComposite: number | undefined;
  medianTokens: number | undefined;
  medianDurationMs: number | undefined;
}

/**
 * Derives the ISO week string ('YYYY-Www') for a given date string.
 *
 * ISO week rules:
 * - Week starts on Monday (Mon=1 … Sun=7)
 * - Week 1 is the week containing the first Thursday of the year
 * - The ISO year may differ from the calendar year for dates near Jan 1 / Dec 31
 */
function isoWeek(dateStr: string): string {
  const date = new Date(dateStr);

  // Day of week: convert JS (0=Sun) → ISO (1=Mon … 7=Sun)
  const dow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();

  // Find the Thursday of the current week
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + (4 - dow));

  const isoYear = thursday.getUTCFullYear();

  // Jan 4 of the ISO year is always in week 1
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  // Monday of week 1
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));

  const weekNumber =
    Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

  const ww = String(weekNumber).padStart(2, '0');
  return `${isoYear}-W${ww}`;
}

function bucketKey(timestamp: string, granularity: BucketGranularity): string {
  if (granularity === 'day') {
    return timestamp.slice(0, 10);
  }
  return isoWeek(timestamp);
}

/** Groups a TrendRow series into day or week buckets. */
export function bucket(series: readonly TrendRow[], granularity: BucketGranularity): BucketRow[] {
  const grouped = new Map<string, TrendRow[]>();

  for (const row of series) {
    if (row.missingTimestamp || row.timestamp === undefined) {
      continue;
    }
    const key = bucketKey(row.timestamp, granularity);
    const existing = grouped.get(key);
    if (existing !== undefined) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  const sortedKeys = [...grouped.keys()].sort();

  return sortedKeys.map((key): BucketRow => {
    const rows = grouped.get(key)!;

    const completeRows = rows.filter((r) => !r.incomplete);

    const compositeValues = completeRows
      .map((r) => r.composite)
      .filter((v): v is number => v !== undefined);

    const tokenValues = completeRows
      .map((r) => r.tokens)
      .filter((v): v is number => v !== undefined);

    const durationValues = completeRows
      .map((r) => r.durationMs)
      .filter((v): v is number => v !== undefined);

    return {
      bucket: key,
      count: rows.length,
      medianComposite: median(compositeValues),
      medianTokens: median(tokenValues),
      medianDurationMs: median(durationValues),
    };
  });
}
