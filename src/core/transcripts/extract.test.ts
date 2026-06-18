import { describe, expect, it } from 'vitest';

import { extractRuns, type RawRun } from './extract';

/**
 * Fixtures mirror the real parent-transcript shape confirmed against
 * `~/.claude` data: a `type: 'user'` entry whose `toolUseResult` object
 * carries `status`, `agentId`, `agentType`, the three `total*` summary
 * numbers, and a `toolStats` count map, with `cwd` at the entry level. No
 * real prompt/content text is reproduced.
 */
function completedEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'user',
    cwd: '/Users/me/repo',
    sessionId: 'sess-1',
    timestamp: '2026-06-17T00:00:00.000Z',
    message: { role: 'user', content: [] },
    toolUseResult: {
      status: 'completed',
      agentId: 'a93f6fef4ae63b956',
      agentType: 'Explore',
      totalDurationMs: 106317,
      totalTokens: 56596,
      totalToolUseCount: 26,
      toolStats: { readCount: 12, searchCount: 8, bashCount: 6 },
      ...((overrides.toolUseResult as Record<string, unknown>) ?? {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'toolUseResult')),
  };
}

describe('extractRuns', () => {
  it('extracts a completed run from a Task-result entry', () => {
    const [run, ...rest] = extractRuns([completedEntry()]);
    expect(rest).toHaveLength(0);
    expect(run).toEqual<RawRun>({
      agentType: 'Explore',
      agentId: 'a93f6fef4ae63b956',
      cwd: '/Users/me/repo',
      sessionId: 'sess-1',
      timestamp: '2026-06-17T00:00:00.000Z',
      status: 'completed',
      totalDurationMs: 106317,
      totalTokens: 56596,
      totalToolUseCount: 26,
      toolStats: { readCount: 12, searchCount: 8, bashCount: 6 },
      incomplete: false,
    });
  });

  it('skips entries whose toolUseResult is not a subagent Task result', () => {
    const fileRead = { type: 'user', cwd: '/r', toolUseResult: { type: 'text', file: {} } };
    const noResult = { type: 'assistant', message: { role: 'assistant', content: [] } };
    expect(extractRuns([fileRead, noResult])).toEqual([]);
  });

  it('tags a run with no completed summary as incomplete', () => {
    const interrupted = completedEntry({ toolUseResult: { status: undefined } });
    const [run] = extractRuns([interrupted]);
    expect(run?.incomplete).toBe(true);
    expect(run?.agentId).toBe('a93f6fef4ae63b956');
  });

  it('tags a run as incomplete when summary totals are missing or non-numeric', () => {
    const drift = completedEntry({
      toolUseResult: { totalTokens: 'lots', totalDurationMs: undefined },
    });
    const [run] = extractRuns([drift]);
    expect(run?.incomplete).toBe(true);
    expect(run?.totalTokens).toBeUndefined();
  });

  it('drops a non-record toolStats rather than throwing', () => {
    const drift = completedEntry({ toolUseResult: { toolStats: 'nope' } });
    const [run] = extractRuns([drift]);
    expect(run?.toolStats).toBeUndefined();
    expect(run?.incomplete).toBe(false);
  });

  it('returns cwd as undefined when the entry has no cwd', () => {
    const [run] = extractRuns([completedEntry({ cwd: undefined })]);
    expect(run?.cwd).toBeUndefined();
  });

  it('tolerates non-object entries without throwing', () => {
    expect(extractRuns([null, 42, 'x', undefined, completedEntry()])).toHaveLength(1);
  });
});
