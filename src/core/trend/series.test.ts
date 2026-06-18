/**
 * Tests for buildTrendSeries (v1 Feature 1, Task 1).
 */
import { describe, expect, it, vi } from 'vitest';

import type { Run } from '../run';
import type { Score } from '../scoring/rubric';
import type { ScoreStore } from '../store/score-store';
import { buildTrendSeries } from './series';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: 'user::~/.claude/agents::test-agent',
    runId: 'run-001',
    agentName: 'test-agent',
    cwd: '/home/user/project',
    sessionId: 'session-001',
    sidechainPath: undefined,
    timestamp: '2024-01-01T10:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1234,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot: '# test agent',
    tags: [],
    ...overrides,
  };
}

function makeScoreStore(scoreMap: Map<string, Score | null> = new Map()): ScoreStore {
  return {
    get: vi.fn((runId: string) => scoreMap.get(runId) ?? undefined),
    add: vi.fn(),
    list: vi.fn(() => []),
  } as unknown as ScoreStore;
}

function makeScore(overrides: Partial<Score> = {}): Score {
  return {
    band: 'pass',
    composite: 85,
    breakdown: [],
    rubricVersion: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTrendSeries', () => {
  it('returns [] for an empty runs array', () => {
    const store = makeScoreStore();
    expect(buildTrendSeries([], store)).toEqual([]);
  });

  it('orders runs chronologically oldest→newest by timestamp', () => {
    const runs = [
      makeRun({ runId: 'run-c', timestamp: '2024-01-03T10:00:00.000Z' }),
      makeRun({ runId: 'run-a', timestamp: '2024-01-01T10:00:00.000Z' }),
      makeRun({ runId: 'run-b', timestamp: '2024-01-02T10:00:00.000Z' }),
    ];
    const store = makeScoreStore();
    const series = buildTrendSeries(runs, store);
    expect(series.map((r) => r.runId)).toEqual(['run-a', 'run-b', 'run-c']);
  });

  it('sorts runs with missing timestamps last', () => {
    const runs = [
      makeRun({ runId: 'run-no-ts', timestamp: undefined }),
      makeRun({ runId: 'run-early', timestamp: '2024-01-01T10:00:00.000Z' }),
      makeRun({ runId: 'run-late', timestamp: '2024-01-05T10:00:00.000Z' }),
    ];
    const store = makeScoreStore();
    const series = buildTrendSeries(runs, store);
    expect(series.map((r) => r.runId)).toEqual(['run-early', 'run-late', 'run-no-ts']);
  });

  it('sets missingTimestamp: true when timestamp is undefined', () => {
    const runs = [makeRun({ runId: 'run-no-ts', timestamp: undefined })];
    const store = makeScoreStore();
    const series = buildTrendSeries(runs, store);
    expect(series[0]).toMatchObject({
      runId: 'run-no-ts',
      missingTimestamp: true,
      timestamp: undefined,
    });
  });

  it('sets missingTimestamp: false when timestamp is present', () => {
    const runs = [makeRun({ runId: 'run-ts', timestamp: '2024-01-01T10:00:00.000Z' })];
    const store = makeScoreStore();
    const series = buildTrendSeries(runs, store);
    expect(series[0]).toMatchObject({ runId: 'run-ts', missingTimestamp: false });
  });

  it('marks incomplete run with incomplete: true and undefined numeric fields', () => {
    const runs = [
      makeRun({
        runId: 'run-inc',
        tags: ['incomplete'],
        totalDurationMs: 999,
        totalTokens: 100,
        totalToolUseCount: 5,
      }),
    ];
    const store = makeScoreStore();
    const series = buildTrendSeries(runs, store);
    expect(series[0]).toMatchObject({
      runId: 'run-inc',
      incomplete: true,
      durationMs: undefined,
      tokens: undefined,
      toolUseCount: undefined,
    });
  });

  it('marks complete run with incomplete: false and populated numeric fields', () => {
    const runs = [
      makeRun({
        runId: 'run-ok',
        tags: [],
        totalDurationMs: 1500,
        totalTokens: 300,
        totalToolUseCount: 4,
      }),
    ];
    const store = makeScoreStore();
    const series = buildTrendSeries(runs, store);
    expect(series[0]).toMatchObject({
      runId: 'run-ok',
      incomplete: false,
      durationMs: 1500,
      tokens: 300,
      toolUseCount: 4,
    });
  });

  it('sets composite and band to undefined for an unscored run', () => {
    const runs = [makeRun({ runId: 'run-unscored', sidechainPath: undefined })];
    // scoreRun returns null for this run (no sidechain) — but we mock at store level
    // by returning no cached score and having no sidechain to compute from
    const store = makeScoreStore(new Map([['run-unscored', null]]));
    const series = buildTrendSeries(runs, store);
    expect(series[0]).toMatchObject({
      runId: 'run-unscored',
      composite: undefined,
      band: undefined,
      incomplete: false,
    });
  });

  it('sets composite and band from the score for a scored run', () => {
    const runs = [makeRun({ runId: 'run-scored' })];
    const score = makeScore({ band: 'warn', composite: 75 });
    // We need scoreRun to return the score; since scoreRun checks the store's
    // cached value first, returning it from store.get is sufficient.
    const store = makeScoreStore(new Map([['run-scored', score]]));
    const series = buildTrendSeries(runs, store);
    expect(series[0]).toMatchObject({
      runId: 'run-scored',
      composite: 75,
      band: 'warn',
    });
  });

  it('handles a mixed series: timestamped + missing-timestamp + incomplete + scored', () => {
    const score = makeScore({ band: 'pass', composite: 90 });
    const runs = [
      makeRun({ runId: 'run-no-ts', timestamp: undefined }),
      makeRun({ runId: 'run-scored', timestamp: '2024-01-02T00:00:00.000Z' }),
      makeRun({
        runId: 'run-inc',
        timestamp: '2024-01-01T00:00:00.000Z',
        tags: ['incomplete'],
        totalDurationMs: 500,
        totalTokens: 50,
        totalToolUseCount: 2,
      }),
    ];
    const store = makeScoreStore(new Map([['run-scored', score]]));
    const series = buildTrendSeries(runs, store);

    // Order: run-inc (Jan 1), run-scored (Jan 2), run-no-ts (last)
    expect(series.map((r) => r.runId)).toEqual(['run-inc', 'run-scored', 'run-no-ts']);

    const incRow = series.find((r) => r.runId === 'run-inc');
    expect(incRow).toMatchObject({ incomplete: true, durationMs: undefined });

    const scoredRow = series.find((r) => r.runId === 'run-scored');
    expect(scoredRow).toMatchObject({ composite: 90, band: 'pass', incomplete: false });

    const noTsRow = series.find((r) => r.runId === 'run-no-ts');
    expect(noTsRow).toMatchObject({ missingTimestamp: true, timestamp: undefined });
  });
});
