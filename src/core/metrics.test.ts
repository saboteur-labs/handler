import { describe, expect, it } from 'vitest';

import { aggregateMetrics } from './metrics';
import type { Run } from './run';

function run(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: '["repo","/r","reviewer"]',
    runId: 'agent-1',
    agentName: 'reviewer',
    timestamp: '2026-06-17T10:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: { readCount: 2, bashCount: 1 },
    definitionSnapshot: 'body',
    tags: [],
    ...overrides,
  };
}

describe('aggregateMetrics', () => {
  it('returns a zeroed result for no runs', () => {
    expect(aggregateMetrics([])).toEqual({
      invocationCount: 0,
      completedCount: 0,
      incompleteCount: 0,
      totalDurationMs: 0,
      averageDurationMs: undefined,
      totalTokens: 0,
      totalToolUseCount: 0,
      toolStats: {},
      lastUsed: undefined,
    });
  });

  it('aggregates duration, tokens, tool counts, and tool stats across runs', () => {
    const metrics = aggregateMetrics([
      run({ runId: 'a', totalDurationMs: 1000, totalTokens: 500, totalToolUseCount: 3 }),
      run({
        runId: 'b',
        totalDurationMs: 3000,
        totalTokens: 700,
        totalToolUseCount: 5,
        toolStats: { readCount: 4, searchCount: 2 },
      }),
    ]);
    expect(metrics.invocationCount).toBe(2);
    expect(metrics.totalDurationMs).toBe(4000);
    expect(metrics.averageDurationMs).toBe(2000);
    expect(metrics.totalTokens).toBe(1200);
    expect(metrics.totalToolUseCount).toBe(8);
    expect(metrics.toolStats).toEqual({ readCount: 6, bashCount: 1, searchCount: 2 });
  });

  it('counts incomplete runs but excludes them from totals and the average', () => {
    const metrics = aggregateMetrics([
      run({ runId: 'a', totalDurationMs: 1000, totalTokens: 500 }),
      run({
        runId: 'b',
        tags: ['incomplete'],
        status: undefined,
        totalDurationMs: undefined,
        totalTokens: undefined,
        totalToolUseCount: undefined,
        toolStats: undefined,
      }),
    ]);
    expect(metrics.invocationCount).toBe(2);
    expect(metrics.completedCount).toBe(1);
    expect(metrics.incompleteCount).toBe(1);
    expect(metrics.totalDurationMs).toBe(1000);
    expect(metrics.averageDurationMs).toBe(1000);
    expect(metrics.totalTokens).toBe(500);
  });

  it('reports the latest timestamp as lastUsed, ignoring missing ones', () => {
    const metrics = aggregateMetrics([
      run({ runId: 'a', timestamp: '2026-06-15T10:00:00.000Z' }),
      run({ runId: 'b', timestamp: '2026-06-17T09:00:00.000Z' }),
      run({ runId: 'c', timestamp: undefined }),
    ]);
    expect(metrics.lastUsed).toBe('2026-06-17T09:00:00.000Z');
  });
});
