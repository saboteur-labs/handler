/**
 * Tests for computeOutlierFlags (resource-cost outlier flags).
 * Spec: Task 4 of V1 Feature 2 (Tier B reference-relative scoring).
 */

import { describe, expect, it } from 'vitest';

import type { Run, RunTelemetrySummary } from '../run';
import type { TierBReference } from './tier-b-reference';
import { computeOutlierFlags } from './tier-b-outliers';

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

const BASE_REFERENCE: TierBReference = {
  medianTokens: 100,
  medianDurationMs: 2000,
  medianTurns: 5,
  priorRunCount: 10,
};

describe('computeOutlierFlags', () => {
  it('returns exactly 3 flags — one per dimension', () => {
    const run = makeRun({ totalTokens: 50, totalDurationMs: 1000, telemetry: makeTelemetry(3) });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    expect(flags).toHaveLength(3);
    const dimensions = flags.map((f) => f.dimension);
    expect(dimensions).toContain('tokens');
    expect(dimensions).toContain('duration');
    expect(dimensions).toContain('turns');
  });

  // Tokens tests
  it('tokens at boundary (value === median * factor) → within', () => {
    // DEFAULT factor = 2; median = 100; boundary = 200
    const run = makeRun({ totalTokens: 200 });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const tokenFlag = flags.find((f) => f.dimension === 'tokens');
    expect(tokenFlag?.status).toBe('within');
    expect(tokenFlag?.value).toBe(200);
    expect(tokenFlag?.median).toBe(100);
  });

  it('tokens just above boundary (value = median * factor + 1) → outlier', () => {
    // DEFAULT factor = 2; median = 100; boundary = 200; outlier at 201
    const run = makeRun({ totalTokens: 201 });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const tokenFlag = flags.find((f) => f.dimension === 'tokens');
    expect(tokenFlag?.status).toBe('outlier');
    expect(tokenFlag?.value).toBe(201);
    expect(tokenFlag?.median).toBe(100);
  });

  it('tokens below boundary → within', () => {
    const run = makeRun({ totalTokens: 50 });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const tokenFlag = flags.find((f) => f.dimension === 'tokens');
    expect(tokenFlag?.status).toBe('within');
    expect(tokenFlag?.value).toBe(50);
    expect(tokenFlag?.median).toBe(100);
  });

  it('tokens not-measurable when run.totalTokens === undefined', () => {
    const run = makeRun({ totalTokens: undefined });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const tokenFlag = flags.find((f) => f.dimension === 'tokens');
    expect(tokenFlag?.status).toBe('not-measurable');
    expect(tokenFlag?.value).toBeUndefined();
    expect(tokenFlag?.median).toBeUndefined();
  });

  // Duration tests
  it('duration outlier when value > median * factor', () => {
    // factor = 2; medianDurationMs = 2000; outlier threshold = 4000
    const run = makeRun({ totalDurationMs: 4001 });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const durationFlag = flags.find((f) => f.dimension === 'duration');
    expect(durationFlag?.status).toBe('outlier');
    expect(durationFlag?.value).toBe(4001);
    expect(durationFlag?.median).toBe(2000);
  });

  it('duration within when value <= median * factor', () => {
    const run = makeRun({ totalDurationMs: 3999 });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const durationFlag = flags.find((f) => f.dimension === 'duration');
    expect(durationFlag?.status).toBe('within');
    expect(durationFlag?.value).toBe(3999);
    expect(durationFlag?.median).toBe(2000);
  });

  it('duration not-measurable when run.totalDurationMs === undefined', () => {
    const run = makeRun({ totalDurationMs: undefined });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const durationFlag = flags.find((f) => f.dimension === 'duration');
    expect(durationFlag?.status).toBe('not-measurable');
    expect(durationFlag?.value).toBeUndefined();
    expect(durationFlag?.median).toBeUndefined();
  });

  // Turns tests
  it('turns outlier when telemetry present and turns.length > median * factor', () => {
    // factor = 2; medianTurns = 5; outlier threshold = 10; outlier at 11
    const run = makeRun({ telemetry: makeTelemetry(11) });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const turnsFlag = flags.find((f) => f.dimension === 'turns');
    expect(turnsFlag?.status).toBe('outlier');
    expect(turnsFlag?.value).toBe(11);
    expect(turnsFlag?.median).toBe(5);
  });

  it('turns within when telemetry present and turns.length <= median * factor', () => {
    const run = makeRun({ telemetry: makeTelemetry(9) });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const turnsFlag = flags.find((f) => f.dimension === 'turns');
    expect(turnsFlag?.status).toBe('within');
    expect(turnsFlag?.value).toBe(9);
    expect(turnsFlag?.median).toBe(5);
  });

  it('turns not-measurable when run.telemetry === undefined', () => {
    const run = makeRun({ telemetry: undefined });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    const turnsFlag = flags.find((f) => f.dimension === 'turns');
    expect(turnsFlag?.status).toBe('not-measurable');
    expect(turnsFlag?.value).toBeUndefined();
    expect(turnsFlag?.median).toBeUndefined();
  });

  // Custom factor override
  it('custom factor override (factor=3) is used correctly', () => {
    // factor = 3; medianTokens = 100; outlier threshold = 300; 301 is outlier
    const run = makeRun({ totalTokens: 301 });
    const flags = computeOutlierFlags(run, BASE_REFERENCE, 3);
    const tokenFlag = flags.find((f) => f.dimension === 'tokens');
    expect(tokenFlag?.status).toBe('outlier');
    expect(tokenFlag?.factor).toBe(3);
  });

  it('custom factor (factor=3): value at boundary (value === median * factor) → within', () => {
    // factor = 3; medianTokens = 100; boundary = 300
    const run = makeRun({ totalTokens: 300 });
    const flags = computeOutlierFlags(run, BASE_REFERENCE, 3);
    const tokenFlag = flags.find((f) => f.dimension === 'tokens');
    expect(tokenFlag?.status).toBe('within');
    expect(tokenFlag?.factor).toBe(3);
  });

  it('not-measurable flags have no value or median fields', () => {
    const run = makeRun({
      totalTokens: undefined,
      totalDurationMs: undefined,
      telemetry: undefined,
    });
    const flags = computeOutlierFlags(run, BASE_REFERENCE);
    for (const flag of flags) {
      expect(flag.status).toBe('not-measurable');
      expect('value' in flag).toBe(false);
      expect('median' in flag).toBe(false);
    }
  });
});
