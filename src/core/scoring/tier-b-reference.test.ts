/**
 * Tests for computeReference (per-agent rolling-median reference).
 * Spec: Task 3 of V1 Feature 2 (Tier B reference-relative scoring).
 */

import { describe, expect, it } from 'vitest';

import type { RunTelemetrySummary } from '../run';
import type { Run } from '../run';
import { computeReference } from './tier-b-reference';

function makeTelemetry(turnCount: number): RunTelemetrySummary {
  return {
    turns: new Array(turnCount).fill({
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      timestamp: undefined,
      model: undefined,
    }),
    stopReason: undefined,
    filesEdited: [],
    todoWrites: 0,
    toolErrors: [],
    retryLoops: 0,
    latency: undefined,
  };
}

function makeRun(overrides: Partial<Run>): Run {
  return {
    identityKey: 'user::~/.claude/agents::test-agent',
    runId: 'run-default',
    agentName: 'test-agent',
    cwd: '/some/project',
    sessionId: 'session-default',
    sidechainPath: undefined,
    timestamp: '2024-01-10T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 200,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot: '# agent',
    tags: [],
    ...overrides,
  };
}

const TARGET_TS = '2024-01-10T12:00:00.000Z';

const targetRun = makeRun({
  runId: 'target-run',
  timestamp: TARGET_TS,
  totalTokens: 500,
  totalDurationMs: 5000,
  telemetry: makeTelemetry(3),
});

describe('computeReference', () => {
  it('returns insufficient-history when there are fewer than min-runs strictly-prior runs (2 prior, default 5)', () => {
    const priorRuns = [
      makeRun({ runId: 'r1', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 100 }),
      makeRun({ runId: 'r2', timestamp: '2024-01-09T01:00:00.000Z', totalTokens: 200 }),
    ];
    const result = computeReference(targetRun, [targetRun, ...priorRuns]);
    expect(result.status).toBe('insufficient-history');
    if (result.status === 'insufficient-history') {
      expect(result.priorRunCount).toBe(2);
    }
  });

  it('returns insufficient-history at exactly min-runs - 1 prior runs', () => {
    const priorRuns = Array.from({ length: 4 }, (_, i) =>
      makeRun({
        runId: `r${i}`,
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 100 * (i + 1),
      }),
    );
    const result = computeReference(targetRun, [targetRun, ...priorRuns]);
    expect(result.status).toBe('insufficient-history');
    if (result.status === 'insufficient-history') {
      expect(result.priorRunCount).toBe(4);
    }
  });

  it('returns ok at exactly min-runs prior runs', () => {
    const priorRuns = Array.from({ length: 5 }, (_, i) =>
      makeRun({
        runId: `r${i}`,
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 100,
        totalDurationMs: 1000,
        telemetry: makeTelemetry(1),
      }),
    );
    const result = computeReference(targetRun, [targetRun, ...priorRuns]);
    expect(result.status).toBe('ok');
  });

  it('excludes runs with timestamp >= targetRun.timestamp (strictly prior only)', () => {
    const priorRuns = Array.from({ length: 5 }, (_, i) =>
      makeRun({ runId: `prior${i}`, timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 100 }),
    );
    const futureRun = makeRun({ runId: 'future', timestamp: '2024-01-11T00:00:00.000Z' });
    const sameTimeRun = makeRun({ runId: 'same', timestamp: TARGET_TS });

    const result = computeReference(targetRun, [targetRun, ...priorRuns, futureRun, sameTimeRun]);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.reference.priorRunCount).toBe(5);
    }
  });

  it('excludes the target run itself (same runId)', () => {
    // 4 prior runs + target run in the list — should be insufficient
    const priorRuns = Array.from({ length: 4 }, (_, i) =>
      makeRun({ runId: `r${i}`, timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 100 }),
    );
    const result = computeReference(targetRun, [targetRun, ...priorRuns]);
    expect(result.status).toBe('insufficient-history');
    if (result.status === 'insufficient-history') {
      expect(result.priorRunCount).toBe(4);
    }
  });

  it('priorRunCount reflects the number of strictly-prior runs used', () => {
    const priorRuns = Array.from({ length: 7 }, (_, i) =>
      makeRun({
        runId: `r${i}`,
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 100,
        totalDurationMs: 1000,
        telemetry: makeTelemetry(1),
      }),
    );
    const result = computeReference(targetRun, [targetRun, ...priorRuns]);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.reference.priorRunCount).toBe(7);
    }
  });

  it('computes medianTokens correctly with odd count ([100, 200, 300] → 200)', () => {
    const priorRuns = [
      makeRun({ runId: 'r1', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 300 }),
      makeRun({ runId: 'r2', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 100 }),
      makeRun({ runId: 'r3', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 200 }),
      makeRun({ runId: 'r4', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 150 }),
      makeRun({ runId: 'r5', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 250 }),
    ];
    // override to exactly 3 runs with known token values using minRuns=3
    const threeRuns = priorRuns.slice(0, 3);
    const result = computeReference(targetRun, [targetRun, ...threeRuns], 3);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.reference.medianTokens).toBe(200);
    }
  });

  it('computes medianTokens correctly with even count ([100, 200] → 150)', () => {
    const priorRuns = [
      makeRun({ runId: 'r1', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 100 }),
      makeRun({ runId: 'r2', timestamp: '2024-01-09T00:00:00.000Z', totalTokens: 200 }),
    ];
    const result = computeReference(targetRun, [targetRun, ...priorRuns], 2);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.reference.medianTokens).toBe(150);
    }
  });

  it('computes medianDurationMs correctly', () => {
    const priorRuns = [
      makeRun({ runId: 'r1', timestamp: '2024-01-09T00:00:00.000Z', totalDurationMs: 1000 }),
      makeRun({ runId: 'r2', timestamp: '2024-01-09T00:00:00.000Z', totalDurationMs: 3000 }),
      makeRun({ runId: 'r3', timestamp: '2024-01-09T00:00:00.000Z', totalDurationMs: 2000 }),
    ];
    const result = computeReference(targetRun, [targetRun, ...priorRuns], 3);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.reference.medianDurationMs).toBe(2000);
    }
  });

  it('computes medianTurns correctly', () => {
    const priorRuns = [
      makeRun({
        runId: 'r1',
        timestamp: '2024-01-09T00:00:00.000Z',
        telemetry: makeTelemetry(4),
      }),
      makeRun({
        runId: 'r2',
        timestamp: '2024-01-09T00:00:00.000Z',
        telemetry: makeTelemetry(2),
      }),
      makeRun({
        runId: 'r3',
        timestamp: '2024-01-09T00:00:00.000Z',
        telemetry: makeTelemetry(6),
      }),
    ];
    const result = computeReference(targetRun, [targetRun, ...priorRuns], 3);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.reference.medianTurns).toBe(4);
    }
  });

  it('excludes runs missing totalTokens from tokens median but not from priorRunCount or other dimensions', () => {
    const priorRuns = [
      makeRun({
        runId: 'r1',
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: undefined,
        totalDurationMs: 1000,
        telemetry: makeTelemetry(1),
      }),
      makeRun({
        runId: 'r2',
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 300,
        totalDurationMs: 2000,
        telemetry: makeTelemetry(2),
      }),
      makeRun({
        runId: 'r3',
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 100,
        totalDurationMs: 3000,
        telemetry: makeTelemetry(3),
      }),
    ];
    const result = computeReference(targetRun, [targetRun, ...priorRuns], 3);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      // priorRunCount = 3 (all 3 prior runs)
      expect(result.reference.priorRunCount).toBe(3);
      // tokens median from only r2 and r3: median([100, 300]) = 200
      expect(result.reference.medianTokens).toBe(200);
      // duration from all 3: median([1000, 2000, 3000]) = 2000
      expect(result.reference.medianDurationMs).toBe(2000);
    }
  });

  it('excludes runs missing telemetry from turns median but not from priorRunCount', () => {
    const priorRuns = [
      makeRun({
        runId: 'r1',
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 100,
        totalDurationMs: 1000,
        telemetry: undefined, // no telemetry
      }),
      makeRun({
        runId: 'r2',
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 200,
        totalDurationMs: 2000,
        telemetry: makeTelemetry(2),
      }),
      makeRun({
        runId: 'r3',
        timestamp: '2024-01-09T00:00:00.000Z',
        totalTokens: 300,
        totalDurationMs: 3000,
        telemetry: makeTelemetry(4),
      }),
    ];
    const result = computeReference(targetRun, [targetRun, ...priorRuns], 3);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.reference.priorRunCount).toBe(3);
      // turns median from r2 and r3 only: median([2, 4]) = 3
      expect(result.reference.medianTurns).toBe(3);
      // tokens from all 3: median([100, 200, 300]) = 200
      expect(result.reference.medianTokens).toBe(200);
    }
  });
});
