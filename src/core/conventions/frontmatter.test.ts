import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from './frontmatter';

function def(frontmatter: string): string {
  return `---\n${frontmatter}\n---\nbody text`;
}

describe('parseFrontmatter', () => {
  it('parses top-level scalar keys in declaration order', () => {
    const fm = parseFrontmatter(def('name: reviewer\ndescription: Reviews code'));
    expect(fm.present).toBe(true);
    expect(fm.keys).toEqual(['name', 'description']);
    expect(fm.values.get('name')).toBe('reviewer');
    expect(fm.values.get('description')).toBe('Reviews code');
  });

  it('strips surrounding quotes from inline scalar values', () => {
    const fm = parseFrontmatter(def('name: "reviewer"\ndescription: \'Reviews code\''));
    expect(fm.values.get('name')).toBe('reviewer');
    expect(fm.values.get('description')).toBe('Reviews code');
  });

  it('captures a block sequence value as raw text, not deep-parsed', () => {
    const fm = parseFrontmatter(def('name: a\ntools:\n  - Read\n  - Edit'));
    expect(fm.keys).toEqual(['name', 'tools']);
    expect(fm.values.get('tools')).toBe('  - Read\n  - Edit');
  });

  it('distinguishes empty frontmatter from missing frontmatter', () => {
    const empty = parseFrontmatter('---\n\n---\nbody');
    expect(empty.present).toBe(true);
    expect(empty.keys).toEqual([]);
    expect(empty.values.size).toBe(0);
  });

  it('reports missing frontmatter for content without fences', () => {
    const fm = parseFrontmatter('no frontmatter here\nname: a');
    expect(fm.present).toBe(false);
    expect(fm.keys).toEqual([]);
    expect(fm.values.size).toBe(0);
  });

  it('reports missing frontmatter for a null (orphan) snapshot', () => {
    const fm = parseFrontmatter(null);
    expect(fm.present).toBe(false);
    expect(fm.keys).toEqual([]);
  });

  it('does not throw on an unterminated (malformed) frontmatter block', () => {
    const fm = parseFrontmatter('---\nname: a\nbody with no close');
    expect(fm.present).toBe(false);
    expect(fm.keys).toEqual([]);
  });

  it('keeps the first position but last value for a duplicate key', () => {
    const fm = parseFrontmatter(def('name: first\ndescription: d\nname: second'));
    expect(fm.keys).toEqual(['name', 'description']);
    expect(fm.values.get('name')).toBe('second');
  });

  it('ignores blank lines and comments between keys', () => {
    const fm = parseFrontmatter(def('name: a\n\n# a comment\ndescription: d'));
    expect(fm.keys).toEqual(['name', 'description']);
  });
});
