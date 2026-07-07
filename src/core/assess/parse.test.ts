import { describe, expect, it } from 'vitest';

import { extractBody, parseDefinition } from './parse';

function def(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe('extractBody', () => {
  it('returns an empty string for a null (orphan) snapshot', () => {
    expect(extractBody(null)).toBe('');
  });

  it('returns an empty string when the definition has no frontmatter', () => {
    expect(extractBody('just a plain body, no frontmatter')).toBe('');
  });

  it('returns an empty string for a frontmatter-only definition', () => {
    expect(extractBody('---\nname: a\n---\n')).toBe('');
    expect(extractBody('---\nname: a\n---')).toBe('');
  });

  it('returns the content after the closing fence for a normal definition', () => {
    expect(extractBody(def('name: a', 'You are a helpful agent.'))).toBe(
      'You are a helpful agent.',
    );
  });

  it('returns an empty string for malformed (unterminated) frontmatter', () => {
    expect(extractBody('---\nname: a\nbody with no close fence')).toBe('');
  });

  it('never throws on malformed input', () => {
    expect(() => extractBody('---')).not.toThrow();
    expect(() => extractBody('')).not.toThrow();
  });
});

describe('parseDefinition', () => {
  it('aggregates name, description, model, tool scope, and body', () => {
    const snapshot = def(
      'name: reviewer\ndescription: Reviews code\nmodel: opus\ntools: Read, Agent(tester)',
      'You review code carefully.',
    );
    const parsed = parseDefinition(snapshot);

    expect(parsed.name).toBe('reviewer');
    expect(parsed.description).toBe('Reviews code');
    expect(parsed.model).toBe('opus');
    expect(parsed.scope.declared).toBe(true);
    expect([...parsed.scope.granted].sort()).toEqual(['Agent(tester)', 'Read']);
    expect([...parsed.scope.spawnTargets]).toEqual(['tester']);
    expect(parsed.body).toBe('You review code carefully.');
  });

  it('handles a null (orphan) snapshot without throwing', () => {
    const parsed = parseDefinition(null);
    expect(parsed.name).toBeUndefined();
    expect(parsed.description).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.scope.declared).toBe(false);
    expect(parsed.body).toBe('');
  });

  it('handles a definition with no model key', () => {
    const parsed = parseDefinition(def('name: a\ndescription: d', 'body'));
    expect(parsed.model).toBeUndefined();
  });
});
