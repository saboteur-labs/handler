import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Run } from '../run';
import { ScoreStore } from '../store/score-store';
import { TierBStore } from '../store/tier-b-store';
import {
  DEFAULT_MIN_RUNS,
  DEFAULT_OUTLIER_FACTOR,
  getMinRuns,
  getOutlierFactor,
  tierBForRun,
  TIER_B_VERSION,
} from './tier-b';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpPath(): string {
  return join(tmpdir(), `handler-test-${randomBytes(6).toString('hex')}.json`);
}

function makeRun(overrides: Partial<Run> & { runId: string; timestamp: string }): Run {
  return {
    identityKey: 'user::~/.claude/agents::test-agent',
    agentName: 'test-agent',
    cwd: '/tmp/project',
    sessionId: 'session-1',
    sidechainPath: undefined,
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot: null,
    tags: [],
    ...overrides,
  };
}

/**
 * Build an array of `count` prior runs, all with timestamps before `targetTimestamp`.
 */
function makePriorRuns(count: number, targetTimestamp: string): Run[] {
  const base = new Date(targetTimestamp).getTime() - 1;
  return Array.from({ length: count }, (_, i) =>
    makeRun({
      runId: `prior-run-${i}`,
      timestamp: new Date(base - i * 1000).toISOString(),
      totalTokens: 400 + i * 10,
      totalDurationMs: 900 + i * 50,
    }),
  );
}

describe('TIER_B_VERSION', () => {
  it('is a number', () => {
    expect(typeof TIER_B_VERSION).toBe('number');
  });
});

describe('DEFAULT_OUTLIER_FACTOR', () => {
  it('is 2', () => {
    expect(DEFAULT_OUTLIER_FACTOR).toBe(2);
  });
});

describe('DEFAULT_MIN_RUNS', () => {
  it('is 5', () => {
    expect(DEFAULT_MIN_RUNS).toBe(5);
  });
});

describe('getOutlierFactor', () => {
  afterEach(() => {
    delete process.env['HANDLER_TIERB_FACTOR'];
  });

  it('returns the default when env var is absent', () => {
    expect(getOutlierFactor()).toBe(DEFAULT_OUTLIER_FACTOR);
  });

  it('returns the parsed float when env var is set to a valid value', () => {
    process.env['HANDLER_TIERB_FACTOR'] = '3.5';
    expect(getOutlierFactor()).toBe(3.5);
  });

  it('falls back to default when env var is non-numeric', () => {
    process.env['HANDLER_TIERB_FACTOR'] = 'abc';
    expect(getOutlierFactor()).toBe(DEFAULT_OUTLIER_FACTOR);
  });

  it('falls back to default when env var is zero', () => {
    process.env['HANDLER_TIERB_FACTOR'] = '0';
    expect(getOutlierFactor()).toBe(DEFAULT_OUTLIER_FACTOR);
  });

  it('falls back to default when env var is negative', () => {
    process.env['HANDLER_TIERB_FACTOR'] = '-1';
    expect(getOutlierFactor()).toBe(DEFAULT_OUTLIER_FACTOR);
  });
});

describe('getMinRuns', () => {
  afterEach(() => {
    delete process.env['HANDLER_TIERB_MIN_RUNS'];
  });

  it('returns the default when env var is absent', () => {
    expect(getMinRuns()).toBe(DEFAULT_MIN_RUNS);
  });

  it('returns the parsed integer when env var is set to a valid value', () => {
    process.env['HANDLER_TIERB_MIN_RUNS'] = '10';
    expect(getMinRuns()).toBe(10);
  });

  it('falls back to default when env var is non-numeric', () => {
    process.env['HANDLER_TIERB_MIN_RUNS'] = 'abc';
    expect(getMinRuns()).toBe(DEFAULT_MIN_RUNS);
  });

  it('falls back to default when env var is zero', () => {
    process.env['HANDLER_TIERB_MIN_RUNS'] = '0';
    expect(getMinRuns()).toBe(DEFAULT_MIN_RUNS);
  });

  it('falls back to default when env var is negative', () => {
    process.env['HANDLER_TIERB_MIN_RUNS'] = '-3';
    expect(getMinRuns()).toBe(DEFAULT_MIN_RUNS);
  });
});

// ---------------------------------------------------------------------------
// tierBForRun
// ---------------------------------------------------------------------------

describe('tierBForRun', () => {
  const TARGET_TIMESTAMP = '2024-06-01T12:00:00.000Z';

  it('cache path: returns cached result without recomputing', () => {
    const store = new TierBStore(tmpPath());
    const run = makeRun({ runId: 'run-cached', timestamp: TARGET_TIMESTAMP });

    const cachedResult = { status: 'insufficient-history' as const, tierBVersion: TIER_B_VERSION };
    store.add({ runId: run.runId, result: cachedResult });

    const result = tierBForRun(run, [run], store);

    expect(result).toEqual(cachedResult);
  });

  it('insufficient history: returns correct result when fewer than min-runs prior runs exist', () => {
    const store = new TierBStore(tmpPath());
    const run = makeRun({ runId: 'run-insufficient', timestamp: TARGET_TIMESTAMP });
    // Only 2 prior runs, well below DEFAULT_MIN_RUNS (5)
    const priorRuns = makePriorRuns(2, TARGET_TIMESTAMP);
    const allRuns = [...priorRuns, run];

    const result = tierBForRun(run, allRuns, store);

    expect(result.status).toBe('insufficient-history');
    expect(result.tierBVersion).toBe(TIER_B_VERSION);
    expect(result.flags).toBeUndefined();
    expect(result.contract).toBeUndefined();
  });

  it('insufficient history: persists result to store', () => {
    const store = new TierBStore(tmpPath());
    const run = makeRun({ runId: 'run-persist-insufficient', timestamp: TARGET_TIMESTAMP });
    const priorRuns = makePriorRuns(1, TARGET_TIMESTAMP);
    const allRuns = [...priorRuns, run];

    tierBForRun(run, allRuns, store);

    const persisted = store.get(run.runId, TIER_B_VERSION);
    expect(persisted).toBeDefined();
    expect(persisted?.status).toBe('insufficient-history');
    expect(persisted?.tierBVersion).toBe(TIER_B_VERSION);
  });

  it('applicable: returns result with status, flags (3), and contract when sufficient prior runs exist', () => {
    const store = new TierBStore(tmpPath());
    const run = makeRun({ runId: 'run-applicable', timestamp: TARGET_TIMESTAMP });
    const priorRuns = makePriorRuns(DEFAULT_MIN_RUNS, TARGET_TIMESTAMP);
    const allRuns = [...priorRuns, run];

    const result = tierBForRun(run, allRuns, store);

    expect(result.status).toBe('applicable');
    expect(result.tierBVersion).toBe(TIER_B_VERSION);
    expect(Array.isArray(result.flags)).toBe(true);
    expect(result.flags).toHaveLength(3);
    expect(result.contract).toBeDefined();
  });

  it('applicable: persists result to store', () => {
    const store = new TierBStore(tmpPath());
    const run = makeRun({ runId: 'run-persist-applicable', timestamp: TARGET_TIMESTAMP });
    const priorRuns = makePriorRuns(DEFAULT_MIN_RUNS, TARGET_TIMESTAMP);
    const allRuns = [...priorRuns, run];

    tierBForRun(run, allRuns, store);

    const persisted = store.get(run.runId, TIER_B_VERSION);
    expect(persisted).toBeDefined();
    expect(persisted?.status).toBe('applicable');
  });

  it('non-interference: does not modify a separate ScoreStore', () => {
    const tierBStore = new TierBStore(tmpPath());
    const scoreStore = new ScoreStore(tmpPath());
    const run = makeRun({ runId: 'run-no-interference', timestamp: TARGET_TIMESTAMP });
    const priorRuns = makePriorRuns(DEFAULT_MIN_RUNS, TARGET_TIMESTAMP);
    const allRuns = [...priorRuns, run];

    tierBForRun(run, allRuns, tierBStore);

    expect(scoreStore.list()).toHaveLength(0);
  });
});
