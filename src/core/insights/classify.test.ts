/**
 * Tests for the roster classifier (V1 Feature 4, Tasks 2 & 3).
 *
 * Covers: unused (recency window), unused (tool-utilization), failing (Tier A
 * failure), failing (composite below threshold), multi-category, healthy,
 * zero-run no-history bucket, expensive (Tier B outlier flags), Tier-B-absent
 * omission, outlier-factor boundary, and low-confidence labeling.
 */

import { describe, expect, it } from 'vitest';

import type { Run } from '../run';
import type { Score } from '../scoring/rubric';
import type { TierBAnnotation } from '../store/tier-b-store';
import { classifyRoster } from './classify';
import type { ClassifierInput, ClassifierOptions } from './classify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: '["user","/home/.claude/agents","test-agent"]',
    runId: 'run-1',
    agentName: 'test-agent',
    cwd: '/home/project',
    sessionId: 'session-1',
    sidechainPath: undefined,
    timestamp: new Date('2025-01-15T12:00:00Z').toISOString(),
    status: 'success',
    totalDurationMs: 5000,
    totalTokens: 1000,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot: null,
    tags: [],
    ...overrides,
  };
}

function makePassScore(overrides: Partial<Score> = {}): Score {
  return {
    band: 'pass',
    composite: 80,
    rubricVersion: 1,
    breakdown: [
      { id: 'terminal', label: 'Terminal status', status: 'pass', detail: 'completed' },
      { id: 'tool-scope', label: 'Tool-scope adherence', status: 'na', detail: 'n/a' },
      {
        id: 'tool-utilization',
        label: 'Tool utilization',
        status: 'na',
        detail: 'n/a — no tools scope declared',
      },
      { id: 'undeclared-scope', label: 'Declared scope', status: 'pass', detail: 'ok' },
      { id: 'denials', label: 'Permission denials', status: 'pass', detail: '0 denials' },
      { id: 'tool-errors', label: 'Tool errors', status: 'pass', detail: '0 errors' },
      { id: 'thrash', label: 'Thrash', status: 'pass', detail: '0 thrash events' },
      {
        id: 'path-boundary',
        label: 'Path/scope boundary',
        status: 'pass',
        detail: 'all writes within scope',
      },
    ],
    ...overrides,
  };
}

function makeFailScore(overrides: Partial<Score> = {}): Score {
  return {
    band: 'fail',
    composite: 45,
    rubricVersion: 1,
    breakdown: [
      { id: 'terminal', label: 'Terminal status', status: 'fail', detail: 'did not complete' },
      { id: 'tool-scope', label: 'Tool-scope adherence', status: 'na', detail: 'n/a' },
      {
        id: 'tool-utilization',
        label: 'Tool utilization',
        status: 'na',
        detail: 'n/a — no tools scope declared',
      },
      { id: 'undeclared-scope', label: 'Declared scope', status: 'pass', detail: 'ok' },
      { id: 'denials', label: 'Permission denials', status: 'pass', detail: '0 denials' },
      { id: 'tool-errors', label: 'Tool errors', status: 'pass', detail: '0 errors' },
      { id: 'thrash', label: 'Thrash', status: 'pass', detail: '0 thrash events' },
      {
        id: 'path-boundary',
        label: 'Path/scope boundary',
        status: 'pass',
        detail: 'all writes within scope',
      },
    ],
    ...overrides,
  };
}

/** Returns a timestamp within the recency window (recent). */
function recentTimestamp(): string {
  return new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
}

/** Returns a timestamp outside the recency window (stale). */
function staleTimestamp(recencyDays: number = 30): string {
  return new Date(Date.now() - (recencyDays + 5) * 24 * 60 * 60 * 1000).toISOString();
}

const OPTIONS: ClassifierOptions = {
  recencyDays: 30,
  failScoreThreshold: 50,
  nowMs: Date.now(),
};

// ---------------------------------------------------------------------------
// Zero-run: no-history bucket
// ---------------------------------------------------------------------------

describe('no-history bucket', () => {
  it('places an agent with zero runs in noHistory, not in agents', () => {
    const input: ClassifierInput = {
      agents: [{ identityKey: '["user","/home/.claude/agents","test-agent"]', name: 'test-agent' }],
      runsByIdentityKey: new Map(),
      scoresByRunId: new Map(),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.noHistory).toHaveLength(1);
    expect(result.noHistory[0]?.identityKey).toBe('["user","/home/.claude/agents","test-agent"]');
    expect(result.noHistory[0]?.categories).toEqual([]);
    expect(result.agents).toHaveLength(0);
  });

  it('zero-run agents are never labeled unused or failing', () => {
    const input: ClassifierInput = {
      agents: [
        { identityKey: '["user","/home/.claude/agents","norun-agent"]', name: 'norun-agent' },
      ],
      runsByIdentityKey: new Map(),
      scoresByRunId: new Map(),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.noHistory[0]?.categories).not.toContain('unused');
    expect(result.noHistory[0]?.categories).not.toContain('failing');
  });
});

// ---------------------------------------------------------------------------
// Healthy agent
// ---------------------------------------------------------------------------

describe('healthy agent', () => {
  it('returns an agent with recent runs and passing scores in agents with empty categories', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore({ composite: 80 });

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.categories).toEqual([]);
    expect(result.noHistory).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unused: no runs within recency window
// ---------------------------------------------------------------------------

describe('unused — no runs within recency window', () => {
  it('marks an agent unused when its only run is outside the recency window', () => {
    const run = makeRun({ runId: 'run-1', timestamp: staleTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).toContain('unused');
  });

  it('does NOT mark an agent unused when it has at least one run within the recency window', () => {
    const recentRun = makeRun({ runId: 'run-recent', timestamp: recentTimestamp() });
    const staleRun = makeRun({ runId: 'run-stale', timestamp: staleTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: recentRun.identityKey, name: recentRun.agentName }],
      runsByIdentityKey: new Map([[recentRun.identityKey, [recentRun, staleRun]]]),
      scoresByRunId: new Map([
        [recentRun.runId, score],
        [staleRun.runId, score],
      ]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).not.toContain('unused');
  });

  it('marks an agent unused when all runs have undefined timestamps (treated as outside window)', () => {
    const run = makeRun({ runId: 'run-1', timestamp: undefined });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).toContain('unused');
  });
});

// ---------------------------------------------------------------------------
// Unused: tool-utilization — granted-but-unused tools across ALL runs
// ---------------------------------------------------------------------------

describe('unused — tool-utilization granted-but-unused across all runs', () => {
  function makeUtilizationWarnScore(): Score {
    return makePassScore({
      band: 'warn',
      composite: 75,
      breakdown: [
        { id: 'terminal', label: 'Terminal status', status: 'pass', detail: 'completed' },
        { id: 'tool-scope', label: 'Tool-scope adherence', status: 'pass', detail: 'ok' },
        {
          id: 'tool-utilization',
          label: 'Tool utilization',
          status: 'warn',
          detail: 'granted but unused: Bash',
        },
        { id: 'undeclared-scope', label: 'Declared scope', status: 'pass', detail: 'ok' },
        { id: 'denials', label: 'Permission denials', status: 'pass', detail: '0 denials' },
        { id: 'tool-errors', label: 'Tool errors', status: 'pass', detail: '0 errors' },
        { id: 'thrash', label: 'Thrash', status: 'pass', detail: '0 thrash events' },
        {
          id: 'path-boundary',
          label: 'Path/scope boundary',
          status: 'pass',
          detail: 'all writes within scope',
        },
      ],
    });
  }

  it('marks an agent unused when tool-utilization warns across ALL stored runs', () => {
    const run1 = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const run2 = makeRun({ runId: 'run-2', timestamp: recentTimestamp() });
    const warnScore = makeUtilizationWarnScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run1.identityKey, name: run1.agentName }],
      runsByIdentityKey: new Map([[run1.identityKey, [run1, run2]]]),
      scoresByRunId: new Map([
        [run1.runId, warnScore],
        [run2.runId, warnScore],
      ]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).toContain('unused');
  });

  it('does NOT mark an agent unused via tool-utilization when at least one run passes utilization', () => {
    const run1 = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const run2 = makeRun({ runId: 'run-2', timestamp: recentTimestamp() });
    const warnScore = makeUtilizationWarnScore();
    const passScore = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run1.identityKey, name: run1.agentName }],
      runsByIdentityKey: new Map([[run1.identityKey, [run1, run2]]]),
      scoresByRunId: new Map([
        [run1.runId, warnScore],
        [run2.runId, passScore],
      ]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).not.toContain('unused');
  });

  it('ignores tool-utilization when no scores are available', () => {
    const run1 = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });

    const input: ClassifierInput = {
      agents: [{ identityKey: run1.identityKey, name: run1.agentName }],
      runsByIdentityKey: new Map([[run1.identityKey, [run1]]]),
      scoresByRunId: new Map(), // no scores
    };

    const result = classifyRoster(input, OPTIONS);

    // Without scores, cannot determine tool-utilization, so should not mark unused by this rule
    expect(result.agents[0]?.categories).not.toContain('unused');
  });
});

// ---------------------------------------------------------------------------
// Failing: Tier A failure in any run
// ---------------------------------------------------------------------------

describe('failing — any run has a Tier A failure', () => {
  it('marks an agent failing when any run has a fail-band score', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makeFailScore({ composite: 60 }); // composite above threshold, but band is fail

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).toContain('failing');
  });

  it('marks an agent failing when any run has a breakdown check with status fail', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore({
      band: 'fail',
      composite: 55,
      breakdown: [
        {
          id: 'path-boundary',
          label: 'Path/scope boundary',
          status: 'fail',
          detail: '1 out-of-scope write',
        },
      ],
    });

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).toContain('failing');
  });

  it('does NOT mark healthy when all runs have passing scores', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore({ composite: 90, band: 'pass' });

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).not.toContain('failing');
  });
});

// ---------------------------------------------------------------------------
// Failing: most-recent composite score below threshold
// ---------------------------------------------------------------------------

describe('failing — most-recent composite score below threshold', () => {
  it('marks an agent failing when the most-recent run composite is below the threshold', () => {
    const olderRun = makeRun({
      runId: 'run-old',
      timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const newerRun = makeRun({
      runId: 'run-new',
      timestamp: recentTimestamp(),
    });
    const goodScore = makePassScore({ composite: 80, band: 'pass' });
    const lowScore = makePassScore({
      composite: 40,
      band: 'warn',
    }); // below 50 threshold, no fail checks

    const input: ClassifierInput = {
      agents: [{ identityKey: olderRun.identityKey, name: olderRun.agentName }],
      runsByIdentityKey: new Map([[olderRun.identityKey, [olderRun, newerRun]]]),
      scoresByRunId: new Map([
        [olderRun.runId, goodScore],
        [newerRun.runId, lowScore],
      ]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).toContain('failing');
  });

  it('does NOT mark failing when the most-recent composite meets the threshold exactly', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore({ composite: 50, band: 'warn' }); // exactly at threshold

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).not.toContain('failing');
  });

  it('uses the most-recent run by timestamp ordering', () => {
    // newerRun (most recent) has a passing score, olderRun has a failing score
    const olderRun = makeRun({
      runId: 'run-old',
      timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const newerRun = makeRun({
      runId: 'run-new',
      timestamp: recentTimestamp(),
    });
    const lowScore = makePassScore({ composite: 30, band: 'warn' });
    const goodScore = makePassScore({ composite: 80, band: 'pass' });

    const input: ClassifierInput = {
      agents: [{ identityKey: olderRun.identityKey, name: olderRun.agentName }],
      runsByIdentityKey: new Map([[olderRun.identityKey, [olderRun, newerRun]]]),
      scoresByRunId: new Map([
        [olderRun.runId, lowScore],
        [newerRun.runId, goodScore],
      ]),
    };

    const result = classifyRoster(input, OPTIONS);

    // Most-recent run has a good composite score, so should not be failing due to this rule
    expect(result.agents[0]?.categories).not.toContain('failing');
  });
});

// ---------------------------------------------------------------------------
// Multi-category: both unused and failing
// ---------------------------------------------------------------------------

describe('multi-category — agent can be both unused and failing', () => {
  it('applies both unused and failing labels when both conditions are met', () => {
    const run = makeRun({
      runId: 'run-1',
      timestamp: staleTimestamp(), // outside recency window → unused
    });
    const score = makeFailScore({ composite: 30 }); // Tier A failure → failing

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).toContain('unused');
    expect(result.agents[0]?.categories).toContain('failing');
  });
});

// ---------------------------------------------------------------------------
// Low-confidence stub
// ---------------------------------------------------------------------------

describe('lowConfidence stub', () => {
  it('is always false (Task 3 will populate this)', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.lowConfidence).toBe(false);
  });

  it('is false for no-history agents too', () => {
    const input: ClassifierInput = {
      agents: [{ identityKey: '["user","/home/.claude/agents","ghost"]', name: 'ghost' }],
      runsByIdentityKey: new Map(),
      scoresByRunId: new Map(),
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.noHistory[0]?.lowConfidence).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple agents: correct separation
// ---------------------------------------------------------------------------

describe('multiple agents', () => {
  it('classifies each agent independently and places them in the correct output bucket', () => {
    const agentAKey = '["user","/home/.claude/agents","agent-a"]';
    const agentBKey = '["user","/home/.claude/agents","agent-b"]';
    const agentCKey = '["user","/home/.claude/agents","agent-c"]';

    const runA = makeRun({
      identityKey: agentAKey,
      agentName: 'agent-a',
      runId: 'run-a',
      timestamp: recentTimestamp(),
    });
    const runB = makeRun({
      identityKey: agentBKey,
      agentName: 'agent-b',
      runId: 'run-b',
      timestamp: staleTimestamp(),
    });
    // agent-c has no runs

    const goodScore = makePassScore({ composite: 80 });
    const okScore = makePassScore({ composite: 70 });

    const input: ClassifierInput = {
      agents: [
        { identityKey: agentAKey, name: 'agent-a' },
        { identityKey: agentBKey, name: 'agent-b' },
        { identityKey: agentCKey, name: 'agent-c' },
      ],
      runsByIdentityKey: new Map([
        [agentAKey, [runA]],
        [agentBKey, [runB]],
      ]),
      scoresByRunId: new Map([
        [runA.runId, goodScore],
        [runB.runId, okScore],
      ]),
    };

    const result = classifyRoster(input, OPTIONS);

    // agent-a: healthy (recent, passing)
    const agentA = result.agents.find((a) => a.identityKey === agentAKey);
    expect(agentA).toBeDefined();
    expect(agentA?.categories).toEqual([]);

    // agent-b: unused (stale)
    const agentB = result.agents.find((a) => a.identityKey === agentBKey);
    expect(agentB).toBeDefined();
    expect(agentB?.categories).toContain('unused');

    // agent-c: no history
    const agentC = result.noHistory.find((a) => a.identityKey === agentCKey);
    expect(agentC).toBeDefined();
    expect(result.agents.find((a) => a.identityKey === agentCKey)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Options defaulting
// ---------------------------------------------------------------------------

describe('options defaulting', () => {
  it('uses configured defaults when no options are provided', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    // Should not throw when options is omitted
    expect(() => classifyRoster(input)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Expensive: Tier B outlier flags
// ---------------------------------------------------------------------------

function makeTierBAnnotation(
  runId: string,
  outlierDimension?: 'tokens' | 'duration' | 'turns',
  factor: number = 2,
): TierBAnnotation {
  const baseFlags = [
    { dimension: 'tokens' as const, status: 'within' as const, value: 100, median: 100, factor },
    {
      dimension: 'duration' as const,
      status: 'within' as const,
      value: 5000,
      median: 5000,
      factor,
    },
    { dimension: 'turns' as const, status: 'within' as const, value: 3, median: 3, factor },
  ];

  const flags = baseFlags.map((f) =>
    f.dimension === outlierDimension
      ? { ...f, status: 'outlier' as const, value: f.median * factor + 1 }
      : f,
  );

  return {
    runId,
    result: {
      status: 'applicable',
      tierBVersion: 1,
      flags,
      contract: { status: 'not-applicable' },
    },
  };
}

describe('expensive — Tier B outlier flags', () => {
  it('marks an agent expensive when a Tier B outlier flag is present (tokens)', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();
    const tierBAnnotation = makeTierBAnnotation('run-1', 'tokens');

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [tierBAnnotation]]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 1 });

    expect(result.agents[0]?.categories).toContain('expensive');
  });

  it('marks an agent expensive when a duration outlier flag fires', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();
    const tierBAnnotation = makeTierBAnnotation('run-1', 'duration');

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [tierBAnnotation]]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 1 });

    expect(result.agents[0]?.categories).toContain('expensive');
  });

  it('marks an agent expensive when a turns outlier flag fires', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();
    const tierBAnnotation = makeTierBAnnotation('run-1', 'turns');

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [tierBAnnotation]]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 1 });

    expect(result.agents[0]?.categories).toContain('expensive');
  });

  it('does NOT mark an agent expensive when no outlier flags are present', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();
    const tierBAnnotation = makeTierBAnnotation('run-1', undefined); // all 'within'

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [tierBAnnotation]]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 1 });

    expect(result.agents[0]?.categories).not.toContain('expensive');
  });
});

// ---------------------------------------------------------------------------
// Tier-B-absent omission: no Tier B data → expensive is absent
// ---------------------------------------------------------------------------

describe('Tier-B-absent omission', () => {
  it('omits the expensive category when no Tier B annotations are provided', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      // No tierBAnnotationsByIdentityKey provided
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).not.toContain('expensive');
    // Categories should never contain a "not-expensive" or similar negation
    expect(result.agents[0]?.categories).not.toContain('not-expensive');
  });

  it('omits expensive when tierBAnnotationsByIdentityKey is empty for the agent', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map(), // empty map, no entry for this agent
    };

    const result = classifyRoster(input, OPTIONS);

    expect(result.agents[0]?.categories).not.toContain('expensive');
  });

  it('omits expensive when all Tier B annotations have status insufficient-history', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();
    const insufficientAnnotation: TierBAnnotation = {
      runId: 'run-1',
      result: {
        status: 'insufficient-history',
        tierBVersion: 1,
      },
    };

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [insufficientAnnotation]]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 1 });

    expect(result.agents[0]?.categories).not.toContain('expensive');
  });
});

// ---------------------------------------------------------------------------
// Outlier-factor boundary
// ---------------------------------------------------------------------------

describe('outlier-factor boundary', () => {
  it('does NOT mark expensive when a flag is exactly at the outlier factor boundary', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();

    // value === median * factor (exactly at boundary → 'within', not 'outlier')
    const atBoundaryAnnotation: TierBAnnotation = {
      runId: 'run-1',
      result: {
        status: 'applicable',
        tierBVersion: 1,
        flags: [
          { dimension: 'tokens', status: 'within', value: 200, median: 100, factor: 2 }, // exactly 2x
          { dimension: 'duration', status: 'within', value: 5000, median: 5000, factor: 2 },
          { dimension: 'turns', status: 'within', value: 3, median: 3, factor: 2 },
        ],
        contract: { status: 'not-applicable' },
      },
    };

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [atBoundaryAnnotation]]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 1 });

    expect(result.agents[0]?.categories).not.toContain('expensive');
  });

  it('marks expensive when a flag strictly exceeds the outlier factor boundary', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();

    // value > median * factor (strictly above boundary → 'outlier')
    const aboveBoundaryAnnotation: TierBAnnotation = {
      runId: 'run-1',
      result: {
        status: 'applicable',
        tierBVersion: 1,
        flags: [
          { dimension: 'tokens', status: 'outlier', value: 201, median: 100, factor: 2 }, // strictly above 2x
          { dimension: 'duration', status: 'within', value: 5000, median: 5000, factor: 2 },
          { dimension: 'turns', status: 'within', value: 3, median: 3, factor: 2 },
        ],
        contract: { status: 'not-applicable' },
      },
    };

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [aboveBoundaryAnnotation]]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 1 });

    expect(result.agents[0]?.categories).toContain('expensive');
  });
});

// ---------------------------------------------------------------------------
// Low-confidence: min-run boundary labeling
// ---------------------------------------------------------------------------

describe('low-confidence — min-run boundary labeling', () => {
  it('labels unused as lowConfidence when run count is below minRuns', () => {
    // 1 run < minRuns=3, stale → unused but low confidence
    const run = makeRun({ runId: 'run-1', timestamp: staleTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 3 });

    expect(result.agents[0]?.categories).toContain('unused');
    expect(result.agents[0]?.lowConfidence).toBe(true);
  });

  it('does NOT label lowConfidence when run count equals or exceeds minRuns', () => {
    const run1 = makeRun({ runId: 'run-1', timestamp: staleTimestamp() });
    const run2 = makeRun({ runId: 'run-2', timestamp: staleTimestamp() });
    const run3 = makeRun({ runId: 'run-3', timestamp: staleTimestamp() });
    const score = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run1.identityKey, name: run1.agentName }],
      runsByIdentityKey: new Map([[run1.identityKey, [run1, run2, run3]]]),
      scoresByRunId: new Map([
        [run1.runId, score],
        [run2.runId, score],
        [run3.runId, score],
      ]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 3 });

    expect(result.agents[0]?.lowConfidence).toBe(false);
  });

  it('labels expensive as lowConfidence when run count is below minRuns', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makePassScore();
    const tierBAnnotation = makeTierBAnnotation('run-1', 'tokens');

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
      tierBAnnotationsByIdentityKey: new Map([[run.identityKey, [tierBAnnotation]]]),
    };

    // 1 run < minRuns=3
    const result = classifyRoster(input, { ...OPTIONS, minRuns: 3 });

    expect(result.agents[0]?.categories).toContain('expensive');
    expect(result.agents[0]?.lowConfidence).toBe(true);
  });

  it('never labels failing as lowConfidence even when run count is below minRuns', () => {
    const run = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const score = makeFailScore({ composite: 30 });

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    // 1 run < minRuns=5 — but failing is definitive, never low-confidence
    const result = classifyRoster(input, { ...OPTIONS, minRuns: 5 });

    expect(result.agents[0]?.categories).toContain('failing');
    expect(result.agents[0]?.lowConfidence).toBe(false);
  });

  it('allows an agent to be both low-confidence AND failing — failing is definitive, unused is low-confidence', () => {
    const run = makeRun({ runId: 'run-1', timestamp: staleTimestamp() });
    const score = makeFailScore({ composite: 30 });

    const input: ClassifierInput = {
      agents: [{ identityKey: run.identityKey, name: run.agentName }],
      runsByIdentityKey: new Map([[run.identityKey, [run]]]),
      scoresByRunId: new Map([[run.runId, score]]),
    };

    // 1 run < minRuns=5; agent is stale (unused) AND failing
    // lowConfidence applies only to unused/expensive, not failing
    // The agent overall gets lowConfidence: true because unused is uncertain
    // but failing remains definitive
    const result = classifyRoster(input, { ...OPTIONS, minRuns: 5 });

    expect(result.agents[0]?.categories).toContain('unused');
    expect(result.agents[0]?.categories).toContain('failing');
    // lowConfidence is true because unused is uncertain (thin history),
    // even though failing itself is definitive
    expect(result.agents[0]?.lowConfidence).toBe(true);
  });

  it('lowConfidence is false when only failing is triggered (no unused/expensive)', () => {
    // Enough runs to be above minRuns threshold, but failing
    const run1 = makeRun({ runId: 'run-1', timestamp: recentTimestamp() });
    const run2 = makeRun({ runId: 'run-2', timestamp: recentTimestamp() });
    const run3 = makeRun({ runId: 'run-3', timestamp: recentTimestamp() });
    const failScore = makeFailScore({ composite: 30 });
    const passScore = makePassScore();

    const input: ClassifierInput = {
      agents: [{ identityKey: run1.identityKey, name: run1.agentName }],
      runsByIdentityKey: new Map([[run1.identityKey, [run1, run2, run3]]]),
      scoresByRunId: new Map([
        [run1.runId, failScore],
        [run2.runId, passScore],
        [run3.runId, passScore],
      ]),
    };

    const result = classifyRoster(input, { ...OPTIONS, minRuns: 3 });

    expect(result.agents[0]?.categories).toContain('failing');
    expect(result.agents[0]?.categories).not.toContain('unused');
    expect(result.agents[0]?.lowConfidence).toBe(false);
  });
});
