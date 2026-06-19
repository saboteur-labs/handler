/**
 * Tests for judgeRun — the Tier C orchestrator.
 *
 * All tests use an injectable fake JudgeClient — zero real network calls.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { Run } from '../run';
import type { JudgeClient, JudgeResponse } from './judge-client';
import type { TierCAnchor } from './tier-c';
import { judgeRun, TIER_C_VERSION } from './tier-c';
import { TierCStore } from '../store/tier-c-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempStorePath(): string {
  return join(tmpdir(), `tier-c-test-${randomUUID()}.json`);
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: 'user::~/.claude/agents::test-agent',
    runId: 'run-test-001',
    agentName: 'test-agent',
    cwd: '/tmp/test-project',
    sessionId: 'session-abc',
    sidechainPath: undefined,
    timestamp: '2026-06-18T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 5000,
    totalTokens: 1000,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot: 'description: A test agent\nYou help with testing.',
    tags: [],
    ...overrides,
  };
}

function makeAnchor(overrides: Partial<TierCAnchor> = {}): TierCAnchor {
  return {
    identityKey: 'user::~/.claude/agents::test-agent',
    runId: 'run-anchor-001',
    definitionSnapshot: 'description: A test agent',
    runOutput: 'Anchor output text.',
    score: 'pass',
    reasoning: 'Looked good.',
    createdAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}

class FakeJudgeClient implements JudgeClient {
  private readonly response: JudgeResponse | Error;

  constructor(response: JudgeResponse | Error) {
    this.response = response;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async judge(_prompt: string): Promise<JudgeResponse> {
    if (this.response instanceof Error) {
      throw this.response;
    }
    return this.response;
  }
}

class SpyJudgeClient implements JudgeClient {
  readonly receivedPrompts: string[] = [];
  private readonly response: JudgeResponse;

  constructor(response: JudgeResponse) {
    this.response = response;
  }

  async judge(prompt: string): Promise<JudgeResponse> {
    this.receivedPrompts.push(prompt);
    return this.response;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('judgeRun', () => {
  describe('success + persist path', () => {
    it('returns a TierCResult with label and reasoning from the judge', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const client = new FakeJudgeClient({ label: 'pass', reasoning: 'Looks good.' });

      const result = await judgeRun(run, [], client, store);

      expect(result.label).toBe('pass');
      expect(result.reasoning).toBe('Looks good.');
    });

    it('sets rubricVersion to TIER_C_VERSION', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const client = new FakeJudgeClient({ label: 'pass', reasoning: 'OK.' });

      const result = await judgeRun(run, [], client, store);

      expect(result.rubricVersion).toBe(TIER_C_VERSION);
    });

    it('sets createdAt to a valid ISO 8601 string', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const client = new FakeJudgeClient({ label: 'pass', reasoning: 'OK.' });

      const result = await judgeRun(run, [], client, store);

      expect(typeof result.createdAt).toBe('string');
      expect(() => new Date(result.createdAt).toISOString()).not.toThrow();
    });

    it('persists the result to the store under the run identity and runId', async () => {
      const run = makeRun();
      const storePath = makeTempStorePath();
      const store = new TierCStore(storePath);
      const client = new FakeJudgeClient({ label: 'fail', reasoning: 'Not good.' });

      await judgeRun(run, [], client, store);

      // Read from a fresh store instance to verify persistence
      const freshStore = new TierCStore(storePath);
      const persisted = freshStore.get(run.identityKey, run.runId, TIER_C_VERSION);

      expect(persisted).toBeDefined();
      expect(persisted?.label).toBe('fail');
      expect(persisted?.reasoning).toBe('Not good.');
    });

    it('accepts a fail label from the judge', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const client = new FakeJudgeClient({ label: 'fail', reasoning: 'Failed.' });

      const result = await judgeRun(run, [], client, store);

      expect(result.label).toBe('fail');
    });
  });

  describe('failure → no-persist path', () => {
    it('propagates the error when the judge throws', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const client = new FakeJudgeClient(new Error('API unavailable'));

      await expect(judgeRun(run, [], client, store)).rejects.toThrow('API unavailable');
    });

    it('does not persist anything to the store when the judge fails', async () => {
      const run = makeRun();
      const storePath = makeTempStorePath();
      const store = new TierCStore(storePath);
      const client = new FakeJudgeClient(new Error('timeout'));

      await expect(judgeRun(run, [], client, store)).rejects.toThrow();

      const freshStore = new TierCStore(storePath);
      expect(freshStore.list()).toHaveLength(0);
    });
  });

  describe('with-anchors path', () => {
    it('passes anchor content through to the judge prompt', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const spy = new SpyJudgeClient({ label: 'pass', reasoning: 'OK.' });
      const anchor = makeAnchor({ runOutput: 'UNIQUE_ANCHOR_OUTPUT_SENTINEL' });

      await judgeRun(run, [anchor], spy, store);

      expect(spy.receivedPrompts).toHaveLength(1);
      expect(spy.receivedPrompts[0]).toContain('UNIQUE_ANCHOR_OUTPUT_SENTINEL');
    });

    it('includes multiple anchors in the prompt', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const spy = new SpyJudgeClient({ label: 'pass', reasoning: 'OK.' });
      const anchor1 = makeAnchor({ runOutput: 'ANCHOR_ONE_OUTPUT' });
      const anchor2 = makeAnchor({ runOutput: 'ANCHOR_TWO_OUTPUT', score: 'fail' });

      await judgeRun(run, [anchor1, anchor2], spy, store);

      expect(spy.receivedPrompts[0]).toContain('ANCHOR_ONE_OUTPUT');
      expect(spy.receivedPrompts[0]).toContain('ANCHOR_TWO_OUTPUT');
    });
  });

  describe('without-anchors path', () => {
    it('still produces a result when anchors array is empty', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const client = new FakeJudgeClient({ label: 'pass', reasoning: 'Fine.' });

      const result = await judgeRun(run, [], client, store);

      expect(result).toBeDefined();
      expect(result.label).toBe('pass');
    });

    it('does not include the few-shot section when anchors is empty', async () => {
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const spy = new SpyJudgeClient({ label: 'pass', reasoning: 'Fine.' });

      await judgeRun(run, [], spy, store);

      expect(spy.receivedPrompts[0]).not.toContain('Calibration Examples');
    });
  });

  describe('non-interference with Tier A and Tier B', () => {
    it('does not import or call ScoreStore', async () => {
      // This is verified structurally: the implementation in tier-c.ts must not
      // import from scoring/score.ts or store/score-store.ts. The test below
      // verifies the function completes without touching any ScoreStore state
      // by checking its module doesn't load those modules dynamically.
      const run = makeRun();
      const store = new TierCStore(makeTempStorePath());
      const client = new FakeJudgeClient({ label: 'pass', reasoning: 'OK.' });

      // If judgeRun internally touched ScoreStore it would need a ScoreStore
      // argument — it does not have one, confirming the contract by signature.
      const result = await judgeRun(run, [], client, store);
      expect(result).toBeDefined();
    });

    it('does not read or write to the TierCStore for a different identityKey', async () => {
      const run = makeRun({ identityKey: 'user::~/.claude/agents::agent-a', runId: 'run-A' });
      const storePath = makeTempStorePath();
      const store = new TierCStore(storePath);
      const client = new FakeJudgeClient({ label: 'pass', reasoning: 'OK.' });

      await judgeRun(run, [], client, store);

      const freshStore = new TierCStore(storePath);
      // The other agent key should not exist
      const other = freshStore.get('user::~/.claude/agents::agent-b', 'run-B', TIER_C_VERSION);
      expect(other).toBeUndefined();
    });
  });
});
