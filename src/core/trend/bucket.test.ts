import { describe, expect, it } from 'vitest';
import type { TrendRow } from './series';
import { bucket } from './bucket';

function makeRow(overrides: Partial<TrendRow> = {}): TrendRow {
  return {
    runId: 'run-1',
    timestamp: '2024-01-15T10:00:00.000Z',
    composite: 80,
    band: 'pass',
    durationMs: 1000,
    tokens: 500,
    toolUseCount: 5,
    incomplete: false,
    missingTimestamp: false,
    ...overrides,
  };
}

describe('bucket', () => {
  it('returns empty array for an empty series', () => {
    expect(bucket([], 'day')).toEqual([]);
  });

  it('day: 3 runs on the same day produce one bucket with count=3', () => {
    const rows: TrendRow[] = [
      makeRow({ runId: 'r1', timestamp: '2024-01-15T08:00:00.000Z' }),
      makeRow({ runId: 'r2', timestamp: '2024-01-15T12:00:00.000Z' }),
      makeRow({ runId: 'r3', timestamp: '2024-01-15T20:00:00.000Z' }),
    ];
    const result = bucket(rows, 'day');
    expect(result).toHaveLength(1);
    expect(result[0]!.bucket).toBe('2024-01-15');
    expect(result[0]!.count).toBe(3);
  });

  it('day: runs on different days produce separate buckets ordered oldest→newest', () => {
    const rows: TrendRow[] = [
      makeRow({ runId: 'r1', timestamp: '2024-01-17T10:00:00.000Z' }),
      makeRow({ runId: 'r2', timestamp: '2024-01-15T10:00:00.000Z' }),
      makeRow({ runId: 'r3', timestamp: '2024-01-16T10:00:00.000Z' }),
    ];
    const result = bucket(rows, 'day');
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.bucket)).toEqual(['2024-01-15', '2024-01-16', '2024-01-17']);
  });

  it('week: runs in different weeks produce separate buckets with YYYY-Www keys', () => {
    const rows: TrendRow[] = [
      // 2024-01-08 is Monday of week 2
      makeRow({ runId: 'r1', timestamp: '2024-01-08T10:00:00.000Z' }),
      // 2024-01-15 is Monday of week 3
      makeRow({ runId: 'r2', timestamp: '2024-01-15T10:00:00.000Z' }),
    ];
    const result = bucket(rows, 'week');
    expect(result).toHaveLength(2);
    expect(result[0]!.bucket).toBe('2024-W02');
    expect(result[1]!.bucket).toBe('2024-W03');
  });

  it('week: 2024-01-01 (Monday) is in 2024-W01', () => {
    const rows: TrendRow[] = [makeRow({ runId: 'r1', timestamp: '2024-01-01T10:00:00.000Z' })];
    const result = bucket(rows, 'week');
    expect(result).toHaveLength(1);
    expect(result[0]!.bucket).toBe('2024-W01');
  });

  it('incomplete runs count in `count` but NOT in medians', () => {
    const rows: TrendRow[] = [
      makeRow({
        runId: 'r1',
        composite: 70,
        durationMs: 2000,
        tokens: 400,
        incomplete: false,
      }),
      makeRow({
        runId: 'r2',
        composite: undefined,
        durationMs: undefined,
        tokens: undefined,
        incomplete: true,
      }),
    ];
    const result = bucket(rows, 'day');
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(2);
    expect(result[0]!.medianComposite).toBe(70);
    expect(result[0]!.medianTokens).toBe(400);
    expect(result[0]!.medianDurationMs).toBe(2000);
  });

  it('missing-timestamp runs are excluded from all buckets', () => {
    const rows: TrendRow[] = [
      makeRow({ runId: 'r1', timestamp: '2024-01-15T10:00:00.000Z' }),
      makeRow({ runId: 'r2', timestamp: undefined, missingTimestamp: true }),
    ];
    const result = bucket(rows, 'day');
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(1);
  });

  it('unscored runs (composite=undefined) excluded from medianComposite but counted in count', () => {
    const rows: TrendRow[] = [
      makeRow({ runId: 'r1', composite: 60, incomplete: false }),
      makeRow({ runId: 'r2', composite: undefined, band: undefined, incomplete: false }),
    ];
    const result = bucket(rows, 'day');
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(2);
    expect(result[0]!.medianComposite).toBe(60);
  });

  it("single run per bucket → median equals that run's value", () => {
    const rows: TrendRow[] = [
      makeRow({ runId: 'r1', composite: 75, durationMs: 3000, tokens: 300 }),
    ];
    const result = bucket(rows, 'day');
    expect(result[0]!.medianComposite).toBe(75);
    expect(result[0]!.medianDurationMs).toBe(3000);
    expect(result[0]!.medianTokens).toBe(300);
  });

  it('all runs in a bucket are incomplete → medians are undefined', () => {
    const rows: TrendRow[] = [
      makeRow({
        runId: 'r1',
        composite: undefined,
        durationMs: undefined,
        tokens: undefined,
        incomplete: true,
      }),
      makeRow({
        runId: 'r2',
        composite: undefined,
        durationMs: undefined,
        tokens: undefined,
        incomplete: true,
      }),
    ];
    const result = bucket(rows, 'day');
    expect(result[0]!.count).toBe(2);
    expect(result[0]!.medianComposite).toBeUndefined();
    expect(result[0]!.medianDurationMs).toBeUndefined();
    expect(result[0]!.medianTokens).toBeUndefined();
  });

  it('even count median: 4 complete runs verify exact average of middle two composites', () => {
    const rows: TrendRow[] = [
      makeRow({ runId: 'r1', composite: 10, timestamp: '2024-01-15T01:00:00.000Z' }),
      makeRow({ runId: 'r2', composite: 20, timestamp: '2024-01-15T02:00:00.000Z' }),
      makeRow({ runId: 'r3', composite: 30, timestamp: '2024-01-15T03:00:00.000Z' }),
      makeRow({ runId: 'r4', composite: 40, timestamp: '2024-01-15T04:00:00.000Z' }),
    ];
    const result = bucket(rows, 'day');
    expect(result[0]!.count).toBe(4);
    // sorted: [10, 20, 30, 40] → middle two: 20 and 30 → average = 25
    expect(result[0]!.medianComposite).toBe(25);
  });
});
