/**
 * Tests for parseHookPayload (hook payload parser).
 */

import { describe, expect, it } from 'vitest';

import { parseHookPayload } from './payload';

const validFull = {
  agentId: 'agent-abc123',
  agentType: 'my-agent',
  cwd: '/home/user/project',
  sessionId: 'session-xyz',
  status: 'completed',
  totalDurationMs: 1200,
  totalTokens: 500,
  totalToolUseCount: 3,
  toolStats: { readCount: 2, writeCount: 1 },
  timestamp: '2026-06-18T12:00:00.000Z',
  incomplete: false,
};

const validMinimal = {
  agentId: 'agent-abc123',
  agentType: 'my-agent',
  cwd: '/home/user/project',
  sessionId: 'session-xyz',
  status: 'completed',
};

describe('parseHookPayload', () => {
  describe('valid inputs', () => {
    it('returns a typed HookPayload for a full valid payload', () => {
      const result = parseHookPayload(validFull);
      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('agent-abc123');
      expect(result?.agentType).toBe('my-agent');
      expect(result?.cwd).toBe('/home/user/project');
      expect(result?.sessionId).toBe('session-xyz');
      expect(result?.status).toBe('completed');
      expect(result?.totalDurationMs).toBe(1200);
      expect(result?.totalTokens).toBe(500);
      expect(result?.totalToolUseCount).toBe(3);
      expect(result?.toolStats).toEqual({ readCount: 2, writeCount: 1 });
      expect(result?.timestamp).toBe('2026-06-18T12:00:00.000Z');
      expect(result?.incomplete).toBe(false);
    });

    it('returns a typed HookPayload when optional fields are absent', () => {
      const result = parseHookPayload(validMinimal);
      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('agent-abc123');
      expect(result?.agentType).toBe('my-agent');
      expect(result?.cwd).toBe('/home/user/project');
      expect(result?.sessionId).toBe('session-xyz');
      expect(result?.status).toBe('completed');
      expect(result?.totalDurationMs).toBeUndefined();
      expect(result?.totalTokens).toBeUndefined();
      expect(result?.totalToolUseCount).toBeUndefined();
      expect(result?.toolStats).toBeUndefined();
      expect(result?.timestamp).toBeUndefined();
      expect(result?.incomplete).toBe(false);
    });

    it('tolerates partial toolStats (keeps only numeric entries)', () => {
      const result = parseHookPayload({
        ...validMinimal,
        toolStats: { readCount: 5, nonNumeric: 'bad', alsoNaN: NaN },
      });
      expect(result).not.toBeNull();
      expect(result?.toolStats).toEqual({ readCount: 5 });
    });

    it('drops toolStats entirely when it is not an object', () => {
      const result = parseHookPayload({ ...validMinimal, toolStats: 'invalid' });
      expect(result).not.toBeNull();
      expect(result?.toolStats).toBeUndefined();
    });

    it('drops optional numeric field when it is not a finite number', () => {
      const result = parseHookPayload({ ...validMinimal, totalDurationMs: 'oops' });
      expect(result).not.toBeNull();
      expect(result?.totalDurationMs).toBeUndefined();
    });

    it('drops optional string field when it is not a string', () => {
      const result = parseHookPayload({ ...validMinimal, timestamp: 42 });
      expect(result).not.toBeNull();
      expect(result?.timestamp).toBeUndefined();
    });
  });

  describe('malformed inputs — completely wrong shape', () => {
    it('returns null for null', () => {
      expect(parseHookPayload(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseHookPayload(undefined)).toBeNull();
    });

    it('returns null for a number', () => {
      expect(parseHookPayload(42)).toBeNull();
    });

    it('returns null for a string', () => {
      expect(parseHookPayload('some string')).toBeNull();
    });

    it('returns null for an array', () => {
      expect(parseHookPayload([])).toBeNull();
    });

    it('returns null for an empty object', () => {
      expect(parseHookPayload({})).toBeNull();
    });
  });

  describe('missing required fields', () => {
    it('returns null when agentId is missing', () => {
      const { agentId: _agentId, ...rest } = validFull;
      void _agentId;
      expect(parseHookPayload(rest)).toBeNull();
    });

    it('returns null when agentType is missing', () => {
      const { agentType: _agentType, ...rest } = validFull;
      void _agentType;
      expect(parseHookPayload(rest)).toBeNull();
    });

    it('returns null when cwd is missing', () => {
      const { cwd: _cwd, ...rest } = validFull;
      void _cwd;
      expect(parseHookPayload(rest)).toBeNull();
    });

    it('returns null when sessionId is missing', () => {
      const { sessionId: _sessionId, ...rest } = validFull;
      void _sessionId;
      expect(parseHookPayload(rest)).toBeNull();
    });

    it('returns null when status is missing', () => {
      const { status: _status, ...rest } = validFull;
      void _status;
      expect(parseHookPayload(rest)).toBeNull();
    });
  });

  describe('required fields with wrong types', () => {
    it('returns null when agentId is not a string', () => {
      expect(parseHookPayload({ ...validFull, agentId: 123 })).toBeNull();
    });

    it('returns null when agentId is an empty string', () => {
      expect(parseHookPayload({ ...validFull, agentId: '' })).toBeNull();
    });

    it('returns null when agentType is not a string', () => {
      expect(parseHookPayload({ ...validFull, agentType: null })).toBeNull();
    });

    it('returns null when agentType is an empty string', () => {
      expect(parseHookPayload({ ...validFull, agentType: '' })).toBeNull();
    });

    it('returns null when cwd is not a string', () => {
      expect(parseHookPayload({ ...validFull, cwd: 999 })).toBeNull();
    });

    it('returns null when cwd is an empty string', () => {
      expect(parseHookPayload({ ...validFull, cwd: '' })).toBeNull();
    });

    it('returns null when sessionId is not a string', () => {
      expect(parseHookPayload({ ...validFull, sessionId: [] })).toBeNull();
    });

    it('returns null when sessionId is an empty string', () => {
      expect(parseHookPayload({ ...validFull, sessionId: '' })).toBeNull();
    });

    it('returns null when status is not a string', () => {
      expect(parseHookPayload({ ...validFull, status: false })).toBeNull();
    });

    it('returns null when status is an empty string', () => {
      expect(parseHookPayload({ ...validFull, status: '' })).toBeNull();
    });
  });
});
