import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE_AGENT_IDS,
  CAPTURE_PROJECTS_ROOT,
  capturePaths,
} from '../__fixtures__/capture/fixtures';
import { discoverMetaRuns, discoverSidechains, discoverTranscripts } from './discover';

describe('discoverMetaRuns', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'handler-metaruns-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function put(content: string, ...segments: string[]): string {
    const file = join(root, ...segments);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content, 'utf8');
    return file;
  }

  const meta = (type: string): string => JSON.stringify({ agentType: type, spawnDepth: 1 });
  const sub = ['-proj', 'sess', 'subagents'];

  it('finds fixture runs including the nested one, sorted, with paths as found', () => {
    const runs = discoverMetaRuns(CAPTURE_PROJECTS_ROOT);
    expect(runs.map((r) => r.agentId).sort()).toEqual(
      [
        CAPTURE_AGENT_IDS.reviewer,
        CAPTURE_AGENT_IDS.writer,
        CAPTURE_AGENT_IDS.explore,
        CAPTURE_AGENT_IDS.empty,
        CAPTURE_AGENT_IDS.malformed,
        CAPTURE_AGENT_IDS.nested,
      ].sort(),
    );
    const paths = runs.map((r) => r.sidechainPath);
    expect(paths).toEqual([...paths].sort());
    const nested = runs.find((r) => r.agentId === CAPTURE_AGENT_IDS.nested)!;
    expect(nested.sidechainPath).toBe(capturePaths.subTranscript(CAPTURE_AGENT_IDS.nested));
    expect(nested.metaPath).toBe(capturePaths.meta(CAPTURE_AGENT_IDS.nested));
    expect(nested.meta.agentType).toBe('planner');
    expect(nested.meta.parentAgentId).toBe(CAPTURE_AGENT_IDS.reviewer);
  });

  it('takes agentId from the filename', () => {
    const jsonl = put('', ...sub, 'agent-abc123.jsonl');
    const metaPath = put(meta('foo'), ...sub, 'agent-abc123.meta.json');
    expect(discoverMetaRuns(root)).toEqual([
      {
        agentId: 'abc123',
        sidechainPath: jsonl,
        metaPath,
        meta: { agentType: 'foo', spawnDepth: 1 },
      },
    ]);
  });

  it('does not treat a stray foo.json or a lone meta file as a candidate', () => {
    put('{}', ...sub, 'foo.json');
    put(meta('x'), ...sub, 'agent-x.meta.json');
    put('', ...sub, 'foo.jsonl');
    expect(discoverMetaRuns(root)).toEqual([]);
  });

  it('does not treat a jsonl without a meta file as a candidate', () => {
    put('', ...sub, 'agent-nometa.jsonl');
    expect(discoverMetaRuns(root)).toEqual([]);
  });

  it('only looks under subagents/ directories', () => {
    put('', '-proj', 'sess', 'agent-out.jsonl');
    put(meta('x'), '-proj', 'sess', 'agent-out.meta.json');
    expect(discoverMetaRuns(root)).toEqual([]);
  });

  it('skips runs with unreadable meta but still discovers the others', () => {
    put('', ...sub, 'agent-bad.jsonl');
    put('{ nope', ...sub, 'agent-bad.meta.json');
    put('', ...sub, 'agent-empty.jsonl');
    put('', ...sub, 'agent-empty.meta.json');
    const good = put('', ...sub, 'agent-good.jsonl');
    put(meta('ok'), ...sub, 'agent-good.meta.json');
    expect(discoverMetaRuns(root).map((r) => r.sidechainPath)).toEqual([good]);
  });

  it('returns [] for a missing root', () => {
    expect(discoverMetaRuns(join(root, 'does-not-exist'))).toEqual([]);
  });
});

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
