import { describe, expect, it } from 'vitest';

import { parseToolScope } from './scope';

function def(frontmatter: string): string {
  return `---\n${frontmatter}\n---\nbody text`;
}

describe('parseToolScope', () => {
  it('parses an inline comma-separated tools list', () => {
    const scope = parseToolScope(def('name: a\ndescription: d\ntools: Read, Edit, Bash'));
    expect(scope.declared).toBe(true);
    expect([...scope.granted].sort()).toEqual(['Bash', 'Edit', 'Read']);
  });

  it('parses an inline bracket array', () => {
    const scope = parseToolScope(def('tools: [Read, Edit]'));
    expect([...scope.granted].sort()).toEqual(['Edit', 'Read']);
  });

  it('parses a block sequence and strips quotes', () => {
    const scope = parseToolScope(def('name: a\ntools:\n  - Read\n  - "Edit"\n  - \'Bash\''));
    expect([...scope.granted].sort()).toEqual(['Bash', 'Edit', 'Read']);
  });

  it('treats a missing tools key as undeclared', () => {
    const scope = parseToolScope(def('name: a\ndescription: d'));
    expect(scope.declared).toBe(false);
    expect(scope.granted.size).toBe(0);
  });

  it('treats an empty tools value as undeclared', () => {
    expect(parseToolScope(def('tools:')).declared).toBe(false);
  });

  it('treats a null snapshot (orphan) as undeclared', () => {
    expect(parseToolScope(null).declared).toBe(false);
  });

  it('treats content without frontmatter as undeclared', () => {
    expect(parseToolScope('no frontmatter here\ntools: Read').declared).toBe(false);
  });

  it('does not throw on unterminated frontmatter', () => {
    expect(parseToolScope('---\ntools: Read\nbody with no close').declared).toBe(false);
  });

  it('does not match a similarly-named key', () => {
    expect(parseToolScope(def('tools_extra: Read')).declared).toBe(false);
  });

  it('returns an empty spawnTargets set when no Agent(...) grant is present', () => {
    const scope = parseToolScope(def('tools: Read, Edit'));
    expect(scope.spawnTargets.size).toBe(0);
  });

  it('parses a single-target Agent(...) grant', () => {
    const scope = parseToolScope(def('tools: Read, Agent(reviewer)'));
    expect([...scope.spawnTargets]).toEqual(['reviewer']);
  });

  it('parses a multi-target Agent(a, b) grant', () => {
    const scope = parseToolScope(def('tools: Agent(reviewer, tester)'));
    expect([...scope.spawnTargets].sort()).toEqual(['reviewer', 'tester']);
  });

  it('recovers trailing tool names from a malformed unbalanced-paren grant', () => {
    // `Agent(reviewer` never closes; a naive paren-aware split would swallow
    // Read/Write. The fallback plain-split keeps them in `granted`.
    const scope = parseToolScope(def('tools: Agent(reviewer, Read, Write'));
    expect(scope.granted.has('Read')).toBe(true);
    expect(scope.granted.has('Write')).toBe(true);
  });

  it('parses a wildcard Agent(*) grant', () => {
    const scope = parseToolScope(def('tools: Read, Agent(*)'));
    expect([...scope.spawnTargets]).toEqual(['*']);
  });

  it('parses an Agent(...) grant in a block sequence', () => {
    const scope = parseToolScope(def('tools:\n  - Read\n  - Agent(reviewer, tester)'));
    expect([...scope.spawnTargets].sort()).toEqual(['reviewer', 'tester']);
  });

  it('does not include Agent(...) grants in spawnTargets when undeclared', () => {
    expect(parseToolScope(null).spawnTargets.size).toBe(0);
  });

  it('leaves the existing declared/granted output unchanged when Agent(...) is present', () => {
    const scope = parseToolScope(def('tools: Read, Edit, Agent(reviewer)'));
    expect(scope.declared).toBe(true);
    expect([...scope.granted].sort()).toEqual(['Agent(reviewer)', 'Edit', 'Read']);
  });
});
