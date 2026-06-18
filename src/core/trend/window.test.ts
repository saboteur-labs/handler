import { describe, expect, it } from 'vitest';
import type { TrendRow } from './series';
import { filterLast, filterSince } from './window';

function makeRow(overrides: Partial<TrendRow> & { runId: string }): TrendRow {
  return {
    timestamp: undefined,
    composite: undefined,
    band: undefined,
    durationMs: undefined,
    tokens: undefined,
    toolUseCount: undefined,
    incomplete: false,
    missingTimestamp: true,
    ...overrides,
  };
}

function timestampedRow(runId: string, timestamp: string): TrendRow {
  return makeRow({ runId, timestamp, missingTimestamp: false });
}

function missingTimestampRow(runId: string): TrendRow {
  return makeRow({ runId });
}

describe('filterSince', () => {
  it('empty series returns []', () => {
    expect(filterSince([], '2024-01-01')).toEqual([]);
  });

  it('all runs before sinceDate returns []', () => {
    const series = [
      timestampedRow('r1', '2023-12-01T00:00:00Z'),
      timestampedRow('r2', '2023-12-31T23:59:59Z'),
    ];
    expect(filterSince(series, '2024-01-01')).toEqual([]);
  });

  it('all runs after sinceDate returns full series', () => {
    const series = [
      timestampedRow('r1', '2024-02-01T00:00:00Z'),
      timestampedRow('r2', '2024-03-15T12:00:00Z'),
    ];
    expect(filterSince(series, '2024-01-01')).toEqual(series);
  });

  it('mixed: only runs on or after sinceDate are kept', () => {
    const series = [
      timestampedRow('r1', '2023-12-31T23:59:59Z'),
      timestampedRow('r2', '2024-01-01T00:00:00Z'),
      timestampedRow('r3', '2024-06-15T10:00:00Z'),
    ];
    const result = filterSince(series, '2024-01-01');
    expect(result.map((r) => r.runId)).toEqual(['r2', 'r3']);
  });

  it('boundary: run with timestamp exactly on sinceDate is included', () => {
    const row = timestampedRow('r1', '2024-01-15T00:00:00Z');
    expect(filterSince([row], '2024-01-15')).toEqual([row]);
  });

  it('missing-timestamp run is excluded even when sinceDate would let everything through', () => {
    const ts = timestampedRow('r1', '2024-05-01T00:00:00Z');
    const missing = missingTimestampRow('r2');
    const result = filterSince([ts, missing], '2000-01-01');
    expect(result.map((r) => r.runId)).toEqual(['r1']);
  });
});

describe('filterLast', () => {
  it('empty series returns []', () => {
    expect(filterLast([], 3)).toEqual([]);
  });

  it('N = 0 returns []', () => {
    const series = [timestampedRow('r1', '2024-01-01T00:00:00Z')];
    expect(filterLast(series, 0)).toEqual([]);
  });

  it('N >= series.length returns full series', () => {
    const series = [
      timestampedRow('r1', '2024-01-01T00:00:00Z'),
      timestampedRow('r2', '2024-01-02T00:00:00Z'),
    ];
    expect(filterLast(series, 5)).toEqual(series);
    expect(filterLast(series, 2)).toEqual(series);
  });

  it('N = 1 returns last run only', () => {
    const series = [
      timestampedRow('r1', '2024-01-01T00:00:00Z'),
      timestampedRow('r2', '2024-01-02T00:00:00Z'),
      timestampedRow('r3', '2024-01-03T00:00:00Z'),
    ];
    expect(filterLast(series, 1).map((r) => r.runId)).toEqual(['r3']);
  });

  it('N = 2 returns last 2 runs', () => {
    const series = [
      timestampedRow('r1', '2024-01-01T00:00:00Z'),
      timestampedRow('r2', '2024-01-02T00:00:00Z'),
      timestampedRow('r3', '2024-01-03T00:00:00Z'),
    ];
    expect(filterLast(series, 2).map((r) => r.runId)).toEqual(['r2', 'r3']);
  });

  it('missing-timestamp runs are retained if within last N (they sort last)', () => {
    const series = [
      timestampedRow('r1', '2024-01-01T00:00:00Z'),
      timestampedRow('r2', '2024-01-02T00:00:00Z'),
      missingTimestampRow('r3'),
    ];
    // Series is already ordered: timestamped oldest→newest, then missing last.
    // Last 2 should be r2 and r3.
    expect(filterLast(series, 2).map((r) => r.runId)).toEqual(['r2', 'r3']);
  });

  it('negative N returns []', () => {
    const series = [timestampedRow('r1', '2024-01-01T00:00:00Z')];
    expect(filterLast(series, -1)).toEqual([]);
  });
});

describe('filterSince + filterLast composition', () => {
  it('apply filterSince then filterLast: first filters by date, then keeps last N of filtered result', () => {
    const series = [
      timestampedRow('r1', '2023-11-01T00:00:00Z'),
      timestampedRow('r2', '2024-01-10T00:00:00Z'),
      timestampedRow('r3', '2024-02-20T00:00:00Z'),
      timestampedRow('r4', '2024-03-30T00:00:00Z'),
      missingTimestampRow('r5'),
    ];

    // filterSince('2024-01-01') excludes r1 and r5 (missing), keeping r2, r3, r4
    const afterSince = filterSince(series, '2024-01-01');
    expect(afterSince.map((r) => r.runId)).toEqual(['r2', 'r3', 'r4']);

    // filterLast(afterSince, 2) keeps the last 2: r3, r4
    const result = filterLast(afterSince, 2);
    expect(result.map((r) => r.runId)).toEqual(['r3', 'r4']);
  });
});
