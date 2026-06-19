/**
 * Tests for listAgents (GUI core API).
 */
import { describe, expect, it } from 'vitest';

import type { Run } from '../run';
import { listAgents } from './agents';

function makeRun(overrides: Partial<Run> & { identityKey: string }): Run {
  return {
    runId: 'run-1',
    agentName: 'agent',
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

const USER_KEY = JSON.stringify(['user', '/home/user/.claude/agents', 'alpha']);
const REPO_KEY = JSON.stringify(['repo', '/home/user/repo/.claude/agents', 'beta']);
const ORPHAN_KEY = JSON.stringify(['user', '/home/user/.claude/agents', 'orphan-agent']);

describe('listAgents', () => {
  it('returns an empty array when there are no runs', () => {
    const result = listAgents([]);
    expect(result).toEqual([]);
  });

  it('returns one entry per distinct agent sorted by name', () => {
    const runs: Run[] = [
      makeRun({ identityKey: REPO_KEY, agentName: 'beta', timestamp: '2024-02-01T00:00:00.000Z' }),
      makeRun({ identityKey: USER_KEY, agentName: 'alpha', timestamp: '2024-01-15T00:00:00.000Z' }),
      makeRun({
        identityKey: USER_KEY,
        agentName: 'alpha',
        runId: 'run-2',
        timestamp: '2024-01-20T00:00:00.000Z',
      }),
    ];

    const result = listAgents(runs);

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('alpha');
    expect(result[1]?.name).toBe('beta');
  });

  it('returns correct fields for a user-source agent with runs', () => {
    const runs: Run[] = [
      makeRun({
        identityKey: USER_KEY,
        agentName: 'alpha',
        timestamp: '2024-01-15T00:00:00.000Z',
        runId: 'run-a',
      }),
      makeRun({
        identityKey: USER_KEY,
        agentName: 'alpha',
        timestamp: '2024-01-20T00:00:00.000Z',
        runId: 'run-b',
      }),
    ];

    const [entry] = listAgents(runs);

    expect(entry).toMatchObject({
      name: 'alpha',
      sourceType: 'user',
      sourcePath: '/home/user/.claude/agents',
      identityKey: USER_KEY,
      lastRunDate: '2024-01-20T00:00:00.000Z',
    });
  });

  it('returns correct fields for a repo-source agent', () => {
    const runs: Run[] = [
      makeRun({
        identityKey: REPO_KEY,
        agentName: 'beta',
        timestamp: '2024-02-01T00:00:00.000Z',
      }),
    ];

    const [entry] = listAgents(runs);

    expect(entry).toMatchObject({
      name: 'beta',
      sourceType: 'repo',
      sourcePath: '/home/user/repo/.claude/agents',
      identityKey: REPO_KEY,
      lastRunDate: '2024-02-01T00:00:00.000Z',
    });
  });

  it('returns null for lastRunDate when all runs have no timestamp', () => {
    const runs: Run[] = [
      makeRun({ identityKey: USER_KEY, agentName: 'alpha', timestamp: undefined }),
    ];

    const [entry] = listAgents(runs);
    expect(entry?.lastRunDate).toBeNull();
  });

  it('handles multiple agents from mixed sources', () => {
    const runs: Run[] = [
      makeRun({ identityKey: USER_KEY, agentName: 'alpha', runId: 'r1' }),
      makeRun({ identityKey: REPO_KEY, agentName: 'beta', runId: 'r2' }),
      makeRun({ identityKey: ORPHAN_KEY, agentName: 'orphan-agent', runId: 'r3' }),
    ];

    const result = listAgents(runs);
    expect(result).toHaveLength(3);
    const names = result.map((e) => e.name);
    expect(names).toEqual(['alpha', 'beta', 'orphan-agent']);
  });
});
