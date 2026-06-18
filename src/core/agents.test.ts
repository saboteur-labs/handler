import { describe, expect, it } from 'vitest';

import { resolveAgentByName, summarizeAgents } from './agents';
import { identityKey } from './identity';
import type { Run } from './run';

function run(identityKey: string, agentName: string, runId: string): Run {
  return {
    identityKey,
    runId,
    agentName,
    cwd: '/r',
    sessionId: 'sess-1',
    sidechainPath: undefined,
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

describe('resolveAgentByName', () => {
  it('resolves a uniquely-named agent to its identity', () => {
    const result = resolveAgentByName(
      [run('["user","/home","planner"]', 'planner', 'a')],
      'planner',
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.identity).toEqual({ sourceType: 'user', sourcePath: '/home', name: 'planner' });
    // The rebuilt identity must serialize to the key the run store recorded.
    expect(identityKey(result.identity)).toBe('["user","/home","planner"]');
  });

  it('reports ambiguous when the same name exists in multiple sources', () => {
    const result = resolveAgentByName(
      [
        run('["repo","/r","reviewer"]', 'reviewer', 'a'),
        run('["user","/home","reviewer"]', 'reviewer', 'b'),
      ],
      'reviewer',
    );
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.matches).toHaveLength(2);
  });

  it('disambiguates by an optional source filter', () => {
    const result = resolveAgentByName(
      [
        run('["repo","/r","reviewer"]', 'reviewer', 'a'),
        run('["user","/home","reviewer"]', 'reviewer', 'b'),
      ],
      'reviewer',
      { type: 'user' },
    );
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.identity.sourceType).toBe('user');
  });

  it('resolves an agent whose definition was deleted but which still has runs', () => {
    const orphan: Run = {
      ...run('["repo","/r","gone"]', 'gone', 'a'),
      definitionSnapshot: null,
      tags: ['orphan'],
    };
    const result = resolveAgentByName([orphan], 'gone');
    expect(result.kind).toBe('found');
  });

  it('reports unknown for a name with no runs', () => {
    expect(resolveAgentByName([], 'nobody').kind).toBe('unknown');
  });
});
