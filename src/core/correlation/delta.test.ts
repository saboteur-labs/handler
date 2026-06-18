import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Run, RunTelemetrySummary } from '../run';
import { RUBRIC_VERSION, type Score } from '../scoring/rubric';
import { ScoreStore } from '../store/score-store';
import { definitionChangeDeltas, MIN_RUNS_FOR_CONFIDENCE } from './delta';

function telemetry(toolErrors: number): RunTelemetrySummary {
  return {
    turns: [],
    stopReason: undefined,
    filesEdited: [],
    todoWrites: 0,
    toolErrors: Array.from({ length: toolErrors }, () => ({ exitCode: 1, message: 'boom' })),
    retryLoops: 0,
    latency: undefined,
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: 'user::/u::reviewer',
    runId: 'agent-1',
    agentName: 'reviewer',
    cwd: '/repo',
    sessionId: 'sess-1',
    sidechainPath: undefined,
    timestamp: '2026-06-18T10:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot: 'v1 body',
    tags: [],
    telemetry: telemetry(0),
    ...overrides,
  };
}

function score(composite: number, terminalPass: boolean): Score {
  return {
    band: 'pass',
    composite,
    breakdown: [
      {
        id: 'terminal',
        label: 'Terminal status',
        status: terminalPass ? 'pass' : 'fail',
        detail: '',
      },
    ],
    rubricVersion: RUBRIC_VERSION,
  };
}

describe('definitionChangeDeltas', () => {
  let dir: string;
  let store: ScoreStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-delta-'));
    store = new ScoreStore(join(dir, 'scores.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('computes before/after aggregates and deltas across a definition change', () => {
    const runs = [
      run({
        runId: 'a1',
        definitionSnapshot: 'v1',
        timestamp: '2026-06-18T10:00:00.000Z',
        totalTokens: 100,
        telemetry: telemetry(2),
      }),
      run({
        runId: 'a2',
        definitionSnapshot: 'v1',
        timestamp: '2026-06-18T10:01:00.000Z',
        totalTokens: 100,
        telemetry: telemetry(0),
      }),
      run({
        runId: 'b1',
        definitionSnapshot: 'v2',
        timestamp: '2026-06-18T10:02:00.000Z',
        totalTokens: 80,
        telemetry: telemetry(0),
      }),
      run({
        runId: 'b2',
        definitionSnapshot: 'v2',
        timestamp: '2026-06-18T10:03:00.000Z',
        totalTokens: 80,
        telemetry: telemetry(0),
      }),
    ];
    store.add({ runId: 'a1', score: score(60, false) });
    store.add({ runId: 'a2', score: score(80, true) });
    store.add({ runId: 'b1', score: score(90, true) });
    store.add({ runId: 'b2', score: score(100, true) });

    const [delta, ...rest] = definitionChangeDeltas(runs, store);
    expect(rest).toHaveLength(0);
    // before mean composite (60+80)/2=70; after (90+100)/2=95 -> +25
    expect(delta?.compositeDelta).toBe(25);
    // before terminal pass rate 1/2=0.5; after 2/2=1 -> +0.5
    expect(delta?.terminalSuccessRateDelta).toBe(0.5);
    // tool errors before 2, after 0 -> -2
    expect(delta?.toolErrorCountDelta).toBe(-2);
    // tokens before 200, after 160 -> -40
    expect(delta?.tokenTotalDelta).toBe(-40);
    expect(delta?.lowConfidence).toBe(false);
  });

  it('flags low confidence when a side has fewer than the minimum scored runs', () => {
    const runs = [
      run({ runId: 'a1', definitionSnapshot: 'v1', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'b1', definitionSnapshot: 'v2', timestamp: '2026-06-18T10:01:00.000Z' }),
    ];
    store.add({ runId: 'a1', score: score(70, true) });
    store.add({ runId: 'b1', score: score(90, true) });

    const [delta] = definitionChangeDeltas(runs, store);
    expect(MIN_RUNS_FOR_CONFIDENCE).toBeGreaterThan(1);
    expect(delta?.lowConfidence).toBe(true);
  });

  it('leaves composite delta undefined when a side has no scored runs', () => {
    const runs = [
      run({ runId: 'a1', definitionSnapshot: 'v1', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'b1', definitionSnapshot: 'v2', timestamp: '2026-06-18T10:01:00.000Z' }),
    ];
    store.add({ runId: 'a1', score: score(70, true) });
    // b1 has no score and no sidechain -> unscored

    const [delta] = definitionChangeDeltas(runs, store);
    expect(delta?.compositeDelta).toBeUndefined();
    expect(delta?.tokenTotalDelta).toBe(0);
  });

  it('emits no delta across an orphan (unknown) boundary', () => {
    const runs = [
      run({ runId: 'a1', definitionSnapshot: 'v1', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'o', definitionSnapshot: null, timestamp: '2026-06-18T10:01:00.000Z' }),
      run({ runId: 'a2', definitionSnapshot: 'v1', timestamp: '2026-06-18T10:02:00.000Z' }),
    ];
    expect(definitionChangeDeltas(runs, store)).toHaveLength(0);
  });

  it('returns no deltas when the definition never changed', () => {
    const runs = [
      run({ runId: 'a1', definitionSnapshot: 'v1', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'a2', definitionSnapshot: 'v1', timestamp: '2026-06-18T10:01:00.000Z' }),
    ];
    expect(definitionChangeDeltas(runs, store)).toHaveLength(0);
  });
});
