/**
 * Tests for parseHookPayload against Claude Code's real snake_case
 * SubagentStop payload (FR-17, FR-34).
 */

import { describe, expect, it } from 'vitest';

import { buildSubagentStopPayload } from '../__fixtures__/capture/fixtures';
import { parseHookPayload } from './payload';

const real = buildSubagentStopPayload({
  agentId: 'agent-abc123',
  agentType: 'my-agent',
  agentTranscriptPath: '/synthetic/agent-abc123.jsonl',
});

describe('parseHookPayload', () => {
  it('maps the snake_case fields of the real payload', () => {
    expect(parseHookPayload(real)).toEqual({
      agentId: 'agent-abc123',
      agentType: 'my-agent',
      cwd: '/synthetic/workspace/app',
      sessionId: 'sess-0001',
      agentTranscriptPath: '/synthetic/agent-abc123.jsonl',
    });
  });

  it('does not require status or totals and ignores extra keys', () => {
    const result = parseHookPayload({ agent_id: 'a1', agent_type: 'x', surprise: { deep: 1 } });
    expect(result).toEqual({
      agentId: 'a1',
      agentType: 'x',
      cwd: undefined,
      sessionId: undefined,
      agentTranscriptPath: undefined,
    });
  });

  it('parses an empty agent_type as the skip signal (agentType "")', () => {
    expect(parseHookPayload({ ...real, agent_type: '' })?.agentType).toBe('');
  });

  it('parses an absent or non-string agent_type as agentType ""', () => {
    const { agent_type: _t, ...rest } = real as Record<string, unknown>;
    void _t;
    expect(parseHookPayload(rest)?.agentType).toBe('');
    expect(parseHookPayload({ ...real, agent_type: 7 })?.agentType).toBe('');
  });

  it('treats empty or wrongly typed optional strings as undefined', () => {
    const result = parseHookPayload({
      ...real,
      cwd: '',
      session_id: 1,
      agent_transcript_path: null,
    });
    expect(result?.cwd).toBeUndefined();
    expect(result?.sessionId).toBeUndefined();
    expect(result?.agentTranscriptPath).toBeUndefined();
  });

  it('returns null when agent_id is missing, empty, or not a string', () => {
    const { agent_id: _id, ...rest } = real as Record<string, unknown>;
    void _id;
    expect(parseHookPayload(rest)).toBeNull();
    expect(parseHookPayload({ ...real, agent_id: '' })).toBeNull();
    expect(parseHookPayload({ ...real, agent_id: 5 })).toBeNull();
  });

  it('returns null for non-objects and never throws', () => {
    for (const bad of [null, undefined, 42, 'str', true, [], [real], {}]) {
      expect(parseHookPayload(bad)).toBeNull();
    }
  });

  it('rejects the old camelCase shape (no agent_id)', () => {
    expect(
      parseHookPayload({ agentId: 'a', agentType: 'b', cwd: '/c', sessionId: 's', status: 'ok' }),
    ).toBeNull();
  });
});
