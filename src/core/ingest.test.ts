import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentIdentity, identityKey } from './identity';
import { ingest } from './ingest';
import { repoSource } from './sources/source';
import { RunStore } from './store/run-store';

/** A parent-transcript Task-result entry, in the real on-disk shape. */
function taskEntry(agentType: string, agentId: string, cwd: string): string {
  return JSON.stringify({
    type: 'user',
    cwd,
    sessionId: 'session',
    toolUseResult: {
      status: 'completed',
      agentId,
      agentType,
      totalDurationMs: 1000,
      totalTokens: 500,
      totalToolUseCount: 3,
      toolStats: { readCount: 2 },
    },
  });
}

describe('ingest', () => {
  let repoRoot: string;
  let projectsRoot: string;
  let storePath: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'handler-repo-'));
    projectsRoot = mkdtempSync(join(tmpdir(), 'handler-projects-'));
    storePath = join(mkdtempSync(join(tmpdir(), 'handler-store-')), 'runs.json');

    const agentsDir = join(repoRoot, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'reviewer.md'), 'definition body', 'utf8');

    const projectDir = join(projectsRoot, '-encoded-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [
        taskEntry('reviewer', 'agent-1', repoRoot),
        taskEntry('Explore', 'agent-2', repoRoot), // built-in: excluded
        '{ not json',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(join(storePath, '..'), { recursive: true, force: true });
  });

  it('ingests user-authored runs, excludes built-ins, and snapshots the definition', () => {
    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.agentName).toBe('reviewer');
    expect(runs[0]?.identityKey).toBe(identityKey(agentIdentity(repoSource(repoRoot), 'reviewer')));
    expect(runs[0]?.definitionSnapshot).toBe('definition body');
    expect(runs[0]?.tags).toEqual([]);
    expect(runs[0]?.sidechainPath).toBe(
      join(projectsRoot, '-encoded-project', 'session', 'subagents', 'agent-agent-1.jsonl'),
    );
  });

  it('persists ingested runs to the store file', () => {
    ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });
    expect(new RunStore(storePath).list()).toHaveLength(1);
  });

  it('is idempotent across repeated ingests', () => {
    ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });
    const second = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });
    expect(second).toHaveLength(1);
  });

  it('returns an empty set when no sources are registered', () => {
    expect(ingest({ sources: [], projectsRoot, storePath })).toEqual([]);
  });

  it('preserves the original definition snapshot when re-ingesting after a definition edit', () => {
    const sources = [repoSource(repoRoot)];
    const first = ingest({ sources, projectsRoot, storePath });
    expect(first[0]?.definitionSnapshot).toBe('definition body');

    // The author edits the definition; the same run is re-ingested.
    writeFileSync(join(repoRoot, '.claude', 'agents', 'reviewer.md'), 'revised body', 'utf8');
    const second = ingest({ sources, projectsRoot, storePath });

    expect(second).toHaveLength(1);
    // History survives edits: the run keeps the snapshot captured at first ingest.
    expect(second[0]?.definitionSnapshot).toBe('definition body');
  });
});
