import { describe, expect, it } from 'vitest';

import { summarizeAgents } from './agents';
import type { Run } from './run';

function run(identityKey: string, agentName: string, runId: string): Run {
  return {
    identityKey,
    runId,
    agentName,
    timestamp: '2026-06-17T10:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: {},
    definitionSnapshot: 'body',
    tags: [],
  };
}

describe('summarizeAgents', () => {
  it('groups runs by identity into one summary per agent with a run count', () => {
    const summaries = summarizeAgents([
      run('["repo","/r","reviewer"]', 'reviewer', 'a'),
      run('["repo","/r","reviewer"]', 'reviewer', 'b'),
      run('["user","/home","planner"]', 'planner', 'c'),
    ]);

    expect(summaries).toEqual([
      {
        identityKey: '["user","/home","planner"]',
        name: 'planner',
        sourceType: 'user',
        sourcePath: '/home',
        runCount: 1,
      },
      {
        identityKey: '["repo","/r","reviewer"]',
        name: 'reviewer',
        sourceType: 'repo',
        sourcePath: '/r',
        runCount: 2,
      },
    ]);
  });

  it('keeps identically-named agents in different sources distinct', () => {
    const summaries = summarizeAgents([
      run('["repo","/r","reviewer"]', 'reviewer', 'a'),
      run('["user","/home","reviewer"]', 'reviewer', 'b'),
    ]);
    expect(summaries).toHaveLength(2);
  });

  it('returns an empty array for no runs', () => {
    expect(summarizeAgents([])).toEqual([]);
  });
});
