import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentIdentity, identityKey } from './identity';
import { assembleRun } from './run';
import { repoSource, userSource } from './sources/source';
import type { RawRun } from './transcripts/extract';

const TRANSCRIPT = '/projects/-encoded/sess-1.jsonl';

function rawRun(overrides: Partial<RawRun> = {}): RawRun {
  return {
    agentType: 'reviewer',
    agentId: 'agent-1',
    cwd: undefined,
    sessionId: 'sess-1',
    timestamp: '2026-06-17T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: { readCount: 2 },
    incomplete: false,
    ...overrides,
  };
}

describe('assembleRun', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'handler-run-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeAgent(name: string, content: string): void {
    const dir = join(root, '.claude', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), content, 'utf8');
  }

  it('attributes a run to its repo source and snapshots the definition', () => {
    writeAgent('reviewer', 'definition body');
    const sources = [repoSource(root)];
    const run = assembleRun(rawRun({ cwd: root }), sources, TRANSCRIPT);

    expect(run).not.toBeNull();
    expect(run?.identityKey).toBe(identityKey(agentIdentity(repoSource(root), 'reviewer')));
    expect(run?.runId).toBe('agent-1');
    expect(run?.agentName).toBe('reviewer');
    expect(run?.definitionSnapshot).toBe('definition body');
    expect(run?.tags).toEqual([]);
    expect(run?.totalTokens).toBe(500);
  });

  it('records the run cwd, session id, and sub-transcript locator', () => {
    const run = assembleRun(rawRun({ cwd: root }), [repoSource(root)], TRANSCRIPT);
    expect(run?.cwd).toBe(root);
    expect(run?.sessionId).toBe('sess-1');
    expect(run?.sidechainPath).toBe('/projects/-encoded/sess-1/subagents/agent-agent-1.jsonl');
  });

  it('leaves the sidechain locator undefined when the session id is missing', () => {
    const run = assembleRun(
      rawRun({ cwd: root, sessionId: undefined }),
      [repoSource(root)],
      TRANSCRIPT,
    );
    expect(run?.sessionId).toBeUndefined();
    expect(run?.sidechainPath).toBeUndefined();
  });

  it('keeps a run whose definition is missing, tagging it orphan', () => {
    const run = assembleRun(rawRun({ cwd: root }), [repoSource(root)], TRANSCRIPT);
    expect(run?.definitionSnapshot).toBeNull();
    expect(run?.tags).toEqual(['orphan']);
  });

  it('preserves the incomplete tag and combines it with orphan', () => {
    const run = assembleRun(
      rawRun({ cwd: root, incomplete: true }),
      [repoSource(root)],
      TRANSCRIPT,
    );
    expect(run?.tags).toEqual(['incomplete', 'orphan']);
  });

  it('drops a built-in agent run (returns null)', () => {
    expect(
      assembleRun(rawRun({ agentType: 'Explore', cwd: root }), [repoSource(root)], TRANSCRIPT),
    ).toBeNull();
  });

  it('drops a run that matches no registered source', () => {
    expect(assembleRun(rawRun({ cwd: root }), [], TRANSCRIPT)).toBeNull();
  });

  it('falls back to the user source when the entry has no cwd', () => {
    const run = assembleRun(rawRun({ cwd: undefined }), [userSource(root)], TRANSCRIPT);
    expect(run?.identityKey).toBe(identityKey(agentIdentity(userSource(root), 'reviewer')));
  });
});
