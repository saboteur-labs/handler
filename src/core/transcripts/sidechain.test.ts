import { describe, expect, it } from 'vitest';

import { parseSidechainParentAgentId } from './sidechain';

describe('parseSidechainParentAgentId', () => {
  it('extracts the id from a path with a UUID-style id', () => {
    expect(parseSidechainParentAgentId('/some/path/agent-abc-123.jsonl')).toBe('abc-123');
  });

  it('extracts the id from a path whose filename matches exactly agent-x.jsonl', () => {
    expect(parseSidechainParentAgentId('/some/path/agent-x.jsonl')).toBe('x');
  });

  it('returns undefined for a non-matching filename', () => {
    expect(parseSidechainParentAgentId('/some/path/session.jsonl')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseSidechainParentAgentId('')).toBeUndefined();
  });
});
