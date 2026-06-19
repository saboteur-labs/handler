import { describe, expect, it } from 'vitest';

import { RUBRIC_VERSION } from './rubric';
import { TIER_B_VERSION } from './tier-b';
import { TIER_C_VERSION, type TierCAnchor, type TierCResult } from './tier-c';

describe('TIER_C_VERSION', () => {
  it('is a string', () => {
    expect(typeof TIER_C_VERSION).toBe('string');
  });

  it('has the expected value', () => {
    expect(TIER_C_VERSION).toBe('tier-c-v1');
  });

  it('is not the same as RUBRIC_VERSION', () => {
    expect(TIER_C_VERSION).not.toBe(String(RUBRIC_VERSION));
  });

  it('is not the same as TIER_B_VERSION', () => {
    expect(TIER_C_VERSION).not.toBe(String(TIER_B_VERSION));
  });
});

describe('TierCResult', () => {
  it('can be constructed with required fields', () => {
    const result: TierCResult = {
      label: 'pass',
      reasoning: 'The agent performed well.',
      rubricVersion: TIER_C_VERSION,
      createdAt: new Date().toISOString(),
    };

    expect(result.label).toBe('pass');
    expect(result.reasoning).toBe('The agent performed well.');
    expect(result.rubricVersion).toBe(TIER_C_VERSION);
    expect(typeof result.createdAt).toBe('string');
  });

  it('accepts fail label', () => {
    const result: TierCResult = {
      label: 'fail',
      reasoning: 'The agent made errors.',
      rubricVersion: TIER_C_VERSION,
      createdAt: new Date().toISOString(),
    };

    expect(result.label).toBe('fail');
  });

  it('has all required fields', () => {
    const result: TierCResult = {
      label: 'pass',
      reasoning: 'Looks good.',
      rubricVersion: TIER_C_VERSION,
      createdAt: '2026-06-18T00:00:00.000Z',
    };

    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['label', 'reasoning', 'rubricVersion', 'createdAt']),
    );
  });
});

describe('TierCAnchor', () => {
  it('can be constructed with required fields', () => {
    const anchor: TierCAnchor = {
      identityKey: 'user::~/.claude/agents::my-agent',
      runId: 'run-abc123',
      definitionSnapshot: 'description: A helpful agent\nsystem_prompt: You are helpful.',
      runOutput: 'The task was completed successfully.',
      score: 'pass',
      reasoning: 'Agent followed instructions well and completed the task cleanly.',
      createdAt: '2026-06-18T00:00:00.000Z',
    };

    expect(anchor.identityKey).toBe('user::~/.claude/agents::my-agent');
    expect(anchor.runId).toBe('run-abc123');
    expect(anchor.definitionSnapshot).toContain('description');
    expect(anchor.runOutput).toBe('The task was completed successfully.');
    expect(anchor.score).toBe('pass');
    expect(anchor.reasoning).toBe(
      'Agent followed instructions well and completed the task cleanly.',
    );
    expect(typeof anchor.createdAt).toBe('string');
  });

  it('accepts fail score', () => {
    const anchor: TierCAnchor = {
      identityKey: 'user::~/.claude/agents::my-agent',
      runId: 'run-xyz456',
      definitionSnapshot: 'description: An agent',
      runOutput: 'Failed to complete task.',
      score: 'fail',
      reasoning: 'Agent went off-script.',
      createdAt: '2026-06-18T00:00:00.000Z',
    };

    expect(anchor.score).toBe('fail');
  });

  it('has all required fields', () => {
    const anchor: TierCAnchor = {
      identityKey: 'repo::/path/to/repo::my-agent',
      runId: 'run-1',
      definitionSnapshot: 'description: Test',
      runOutput: 'output',
      score: 'pass',
      reasoning: 'fine',
      createdAt: '2026-06-18T00:00:00.000Z',
    };

    expect(Object.keys(anchor)).toEqual(
      expect.arrayContaining([
        'identityKey',
        'runId',
        'definitionSnapshot',
        'runOutput',
        'score',
        'reasoning',
        'createdAt',
      ]),
    );
  });
});
