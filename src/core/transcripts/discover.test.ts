import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discoverSidechains, discoverTranscripts } from './discover';

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

describe('discoverSidechains', () => {
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

  it('returns [] when a project has no subagents directory', () => {
    touch('-Users-me-repo', 'session.jsonl');
    expect(discoverSidechains(root)).toEqual([]);
  });

  it('returns the sidechain path for a single depth-1 sidechain', () => {
    const sidechain = touch('-Users-me-repo', 'session', 'subagents', 'agent-abc.jsonl');
    expect(discoverSidechains(root)).toEqual([sidechain]);
  });

  it('returns sidechains at two levels of depth (sidechain of a sidechain)', () => {
    const depth1 = touch('-Users-me-repo', 'session1', 'subagents', 'agent-abc.jsonl');
    const depth2 = touch(
      '-Users-me-repo',
      'session1',
      'subagents',
      'session2',
      'subagents',
      'agent-xyz.jsonl',
    );
    expect(discoverSidechains(root)).toEqual([depth1, depth2].sort());
  });

  it('returns all sidechains from multiple projects, sorted', () => {
    const a = touch('-Users-me-repo-one', 'session-a', 'subagents', 'agent-1.jsonl');
    const b = touch('-Users-me-repo-two', 'session-b', 'subagents', 'agent-2.jsonl');
    expect(discoverSidechains(root)).toEqual([a, b].sort());
  });

  it('returns [] for a missing projectsRoot without throwing', () => {
    expect(discoverSidechains(join(root, 'does-not-exist'))).toEqual([]);
  });
});
