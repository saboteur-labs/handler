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
});
