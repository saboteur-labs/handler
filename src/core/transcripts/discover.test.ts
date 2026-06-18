import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discoverTranscripts } from './discover';

describe('discoverTranscripts', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'handler-projects-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function touch(...segments: string[]): string {
    const file = join(root, ...segments);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '', 'utf8');
    return file;
  }

  it('finds parent-session transcripts across project dirs', () => {
    const a = touch('-Users-me-repo-one', 'session-a.jsonl');
    const b = touch('-Users-me-repo-two', 'session-b.jsonl');
    expect(discoverTranscripts(root)).toEqual([a, b].sort());
  });

  it('excludes per-run subagent sidechain transcripts', () => {
    const parent = touch('-Users-me-repo', 'session.jsonl');
    touch('-Users-me-repo', 'session', 'subagents', 'agent-x.jsonl');
    expect(discoverTranscripts(root)).toEqual([parent]);
  });

  it('ignores non-jsonl entries and stray sibling directories', () => {
    const parent = touch('-Users-me-repo', 'session.jsonl');
    touch('-Users-me-repo', 'notes.txt');
    mkdirSync(join(root, '-Users-me-repo', 'memory'), { recursive: true });
    expect(discoverTranscripts(root)).toEqual([parent]);
  });

  it('returns an empty array for a missing projects root', () => {
    expect(discoverTranscripts(join(root, 'does-not-exist'))).toEqual([]);
  });

  it('returns an empty array for an empty projects root', () => {
    expect(discoverTranscripts(root)).toEqual([]);
  });
});
