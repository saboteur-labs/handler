/**
 * Tests for getAgentDetail (GUI core API).
 */
import { describe, expect, it, vi } from 'vitest';

import type { Score } from '../scoring/rubric';
import type { TierBResult } from '../scoring/tier-b';
import type { TierCResult } from '../scoring/tier-c';
import { TIER_C_VERSION } from '../scoring/tier-c';
import type { ScoreStore } from '../store/score-store';
import type { TierBStore } from '../store/tier-b-store';
import type { TierCStore } from '../store/tier-c-store';
import type { NoteStore } from '../store/note-store';
import type { Run } from '../run';
import { getAgentDetail } from './agent-detail';

function makeRun(overrides: Partial<Run> & { identityKey: string; runId: string }): Run {
  return {
    agentName: 'test-agent',
    cwd: '/home/user',
    sessionId: 'session-1',
    sidechainPath: undefined,
    timestamp: '2024-01-01T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: {},
    definitionSnapshot: 'description: test',
    tags: [],
    ...overrides,
  };
}

const IDENTITY_KEY = JSON.stringify(['user', '/home/user/.claude/agents', 'test-agent']);
const OTHER_KEY = JSON.stringify(['user', '/home/user/.claude/agents', 'other-agent']);

function makeScoreStore(scoreMap: Map<string, Score>): ScoreStore {
  return {
    get: vi.fn((runId: string) => scoreMap.get(runId)),
    add: vi.fn(),
    list: vi.fn(() => []),
  } as unknown as ScoreStore;
}

function makeTierBStore(tierBMap: Map<string, TierBResult>): TierBStore {
  return {
    get: vi.fn((runId: string) => tierBMap.get(runId)),
    add: vi.fn(),
    list: vi.fn(() => []),
  } as unknown as TierBStore;
}

function makeTierCStore(tierCMap: Map<string, TierCResult>): TierCStore {
  return {
    get: vi.fn((...args: [string, string, string]) => tierCMap.get(args[1])),
    add: vi.fn(),
    list: vi.fn(() => []),
  } as unknown as TierCStore;
}

function makeNoteStore(notes: Map<string, string>): NoteStore {
  return {
    get: vi.fn((key: string) => {
      const body = notes.get(key);
      return body !== undefined
        ? { identityKey: key, body, updatedAt: '2024-01-01T00:00:00.000Z' }
        : undefined;
    }),
    set: vi.fn(),
    list: vi.fn(() => []),
  } as unknown as NoteStore;
}

const emptyScoreStore = makeScoreStore(new Map());
const emptyTierBStore = makeTierBStore(new Map());
const emptyTierCStore = makeTierCStore(new Map());
const emptyNoteStore = makeNoteStore(new Map());

describe('getAgentDetail', () => {
  it('returns null when no runs match identityKey', () => {
    const runs: Run[] = [makeRun({ identityKey: OTHER_KEY, runId: 'r1' })];
    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );
    expect(result).toBeNull();
  });

  it('returns agent with empty runs array when no runs match', () => {
    const result = getAgentDetail(
      IDENTITY_KEY,
      [],
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );
    expect(result).toBeNull();
  });

  it('returns agent detail with basic fields when runs exist', () => {
    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];
    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );

    expect(result).not.toBeNull();
    expect(result?.name).toBe('test-agent');
    expect(result?.sourceType).toBe('user');
    expect(result?.sourcePath).toBe('/home/user/.claude/agents');
    expect(result?.identityKey).toBe(IDENTITY_KEY);
  });

  it('returns runs sorted chronologically', () => {
    const runs: Run[] = [
      makeRun({ identityKey: IDENTITY_KEY, runId: 'r2', timestamp: '2024-01-02T00:00:00.000Z' }),
      makeRun({ identityKey: IDENTITY_KEY, runId: 'r1', timestamp: '2024-01-01T00:00:00.000Z' }),
    ];

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );

    expect(result?.runs[0]?.runId).toBe('r1');
    expect(result?.runs[1]?.runId).toBe('r2');
  });

  it('returns null for tierA, tierB, tierC when no scores present', () => {
    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );

    const run = result?.runs[0];
    expect(run?.tierA).toBeNull();
    expect(run?.tierB).toBeNull();
    expect(run?.tierC).toBeNull();
  });

  it('returns null for note when no note is stored', () => {
    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );

    expect(result?.note).toBeNull();
  });

  it('returns null for conventionsResults when no conventions provided', () => {
    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
      null,
      null,
    );

    expect(result?.conventionsResults).toBeNull();
  });

  it('returns note body when note is present', () => {
    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];
    const noteStore = makeNoteStore(new Map([[IDENTITY_KEY, 'This is my note.']]));

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      emptyTierCStore,
      noteStore,
    );

    expect(result?.note).toBe('This is my note.');
  });

  it('returns tierA when score is present', () => {
    const score: Score = {
      band: 'warn',
      composite: 75,
      rubricVersion: 1,
      breakdown: [
        { id: 'terminal', label: 'Terminal status', status: 'warn', detail: 'did not complete' },
        { id: 'tool-scope', label: 'Tool-scope adherence', status: 'pass', detail: 'ok' },
      ],
    };
    const scoreStore = makeScoreStore(new Map([['r1', score]]));

    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      scoreStore,
      emptyTierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );

    const tierA = result?.runs[0]?.tierA;
    expect(tierA).not.toBeNull();
    expect(tierA?.composite).toBe(75);
    expect(tierA?.band).toBe('warn');
    expect(tierA?.failingChecks).toHaveLength(1);
    expect(tierA?.failingChecks[0]?.label).toBe('Terminal status');
  });

  it('returns tierB when present', () => {
    const tierBResult: TierBResult = {
      status: 'applicable',
      tierBVersion: 1,
      flags: [{ dimension: 'tokens', status: 'outlier', value: 2000, median: 500, factor: 2 }],
      contract: { status: 'pass' },
    };
    const tierBStore = makeTierBStore(new Map([['r1', tierBResult]]));

    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      tierBStore,
      emptyTierCStore,
      emptyNoteStore,
    );

    const tierB = result?.runs[0]?.tierB;
    expect(tierB).not.toBeNull();
    expect(tierB?.status).toBe('applicable');
    expect(tierB?.flags).toHaveLength(1);
    expect(tierB?.contract?.status).toBe('pass');
  });

  it('returns tierC when present', () => {
    const tierCResult: TierCResult = {
      label: 'pass',
      reasoning: 'Excellent run',
      rubricVersion: TIER_C_VERSION,
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    const tierCStore = makeTierCStore(new Map([['r1', tierCResult]]));

    const runs: Run[] = [makeRun({ identityKey: IDENTITY_KEY, runId: 'r1' })];

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      emptyScoreStore,
      emptyTierBStore,
      tierCStore,
      emptyNoteStore,
    );

    const tierC = result?.runs[0]?.tierC;
    expect(tierC).not.toBeNull();
    expect(tierC?.label).toBe('pass');
    expect(tierC?.reasoning).toBe('Excellent run');
  });

  it('full happy path: returns all data when everything is present', () => {
    const score: Score = {
      band: 'pass',
      composite: 100,
      rubricVersion: 1,
      breakdown: [
        { id: 'terminal', label: 'Terminal status', status: 'pass', detail: 'completed' },
      ],
    };
    const tierBResult: TierBResult = {
      status: 'applicable',
      tierBVersion: 1,
      flags: [{ dimension: 'tokens', status: 'within', value: 500, median: 500, factor: 2 }],
      contract: { status: 'not-applicable' },
    };
    const tierCResult: TierCResult = {
      label: 'pass',
      reasoning: 'great',
      rubricVersion: TIER_C_VERSION,
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    const scoreStore = makeScoreStore(new Map([['r1', score]]));
    const tierBStore = makeTierBStore(new Map([['r1', tierBResult]]));
    const tierCStore = makeTierCStore(new Map([['r1', tierCResult]]));
    const noteStore = makeNoteStore(new Map([[IDENTITY_KEY, 'my note']]));

    const runs: Run[] = [
      makeRun({
        identityKey: IDENTITY_KEY,
        runId: 'r1',
        timestamp: '2024-01-01T00:00:00.000Z',
        definitionSnapshot: '---\nname: test-agent\ndescription: A test agent\n---\n',
      }),
    ];

    const conventions = {
      status: 'loaded' as const,
      artifact: {
        version: 1,
        sourceHash: 'abc',
        lastSynced: '2024-01-01T00:00:00.000Z',
        rules: {
          requiredKeys: ['description'],
          allowedKeys: ['description', 'name'],
          descriptionMinLength: 10,
          cuePatterns: ['test'],
        },
      },
    };

    const result = getAgentDetail(
      IDENTITY_KEY,
      runs,
      scoreStore,
      tierBStore,
      tierCStore,
      noteStore,
      conventions,
      '---\nname: test-agent\ndescription: A test agent for testing things\n---\n',
    );

    expect(result).not.toBeNull();
    expect(result?.name).toBe('test-agent');
    expect(result?.note).toBe('my note');
    expect(result?.runs).toHaveLength(1);

    const run = result?.runs[0];
    expect(run?.tierA?.composite).toBe(100);
    expect(run?.tierA?.band).toBe('pass');
    expect(run?.tierB?.status).toBe('applicable');
    expect(run?.tierC?.label).toBe('pass');
  });
});
