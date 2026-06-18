import { describe, expect, it } from 'vitest';

import { BUILTIN_AGENT_NAMES, isBuiltinAgent } from './denylist';

describe('isBuiltinAgent (Req 3)', () => {
  it('returns true for every seeded built-in agent name', () => {
    for (const name of BUILTIN_AGENT_NAMES) {
      expect(isBuiltinAgent(name)).toBe(true);
    }
  });

  it('recognizes well-known built-ins explicitly', () => {
    expect(isBuiltinAgent('general-purpose')).toBe(true);
    expect(isBuiltinAgent('statusline-setup')).toBe(true);
    expect(isBuiltinAgent('Explore')).toBe(true);
  });

  it('returns false for user-authored agent names', () => {
    expect(isBuiltinAgent('code-reviewer')).toBe(false);
    expect(isBuiltinAgent('my-helper')).toBe(false);
    expect(isBuiltinAgent('antonini-refactor')).toBe(false);
  });

  it('matches exactly, not by substring', () => {
    expect(isBuiltinAgent('general-purpose-helper')).toBe(false);
    expect(isBuiltinAgent('general')).toBe(false);
  });

  it('is case-sensitive (built-in names are recorded verbatim)', () => {
    expect(isBuiltinAgent('explore')).toBe(false);
    expect(isBuiltinAgent('GENERAL-PURPOSE')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isBuiltinAgent('')).toBe(false);
  });
});
