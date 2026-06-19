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

  it('top-level runs have parentAgentId undefined', () => {
    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.parentAgentId).toBeUndefined();
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

describe('ingest — sidechain (nested subagent) discovery', () => {
  let repoRoot: string;
  let projectsRoot: string;
  let storePath: string;
  let projectDir: string;

  /**
   * Build a Task-result entry as it would appear inside a sidechain transcript
   * (the nested agent's conversation), pointing to a grandchild run.
   */
  function sidechainTaskEntry(agentType: string, agentId: string, cwd: string): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      toolUseResult: {
        status: 'completed',
        agentId,
        agentType,
        totalDurationMs: 800,
        totalTokens: 300,
        totalToolUseCount: 2,
        toolStats: { readCount: 1 },
      },
    });
  }

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'handler-repo-'));
    projectsRoot = mkdtempSync(join(tmpdir(), 'handler-projects-'));
    storePath = join(mkdtempSync(join(tmpdir(), 'handler-store-')), 'runs.json');
    projectDir = join(projectsRoot, '-encoded-project');
    mkdirSync(projectDir, { recursive: true });

    // Register two agents: reviewer and linter
    const agentsDir = join(repoRoot, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'reviewer.md'), 'reviewer def', 'utf8');
    writeFileSync(join(agentsDir, 'linter.md'), 'linter def', 'utf8');

    // Top-level parent transcript: reviewer run (agent-1) spawned by session
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      JSON.stringify({
        type: 'user',
        cwd: repoRoot,
        sessionId: 'session',
        toolUseResult: {
          status: 'completed',
          agentId: 'agent-1',
          agentType: 'reviewer',
          totalDurationMs: 1000,
          totalTokens: 500,
          totalToolUseCount: 3,
          toolStats: { readCount: 2 },
        },
      }),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(join(storePath, '..'), { recursive: true, force: true });
  });

  it('ingests nested run from sidechain with parentAgentId set to the parent agentId', () => {
    // Sidechain for reviewer (agent-1) contains a linter run (agent-2)
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'agent-agent-1.jsonl'),
      sidechainTaskEntry('linter', 'agent-2', repoRoot),
      'utf8',
    );

    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    const nestedRun = runs.find((r) => r.agentName === 'linter');
    expect(nestedRun).toBeDefined();
    expect(nestedRun?.parentAgentId).toBe('agent-1');
    expect(nestedRun?.agentName).toBe('linter');
    expect(nestedRun?.identityKey).toBe(identityKey(agentIdentity(repoSource(repoRoot), 'linter')));
  });

  it('ingests deeply-nested sidechains (depth ≥ 2) with correct parentAgentId at each level', () => {
    // reviewer (agent-1) spawns linter (agent-2)
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'agent-agent-1.jsonl'),
      sidechainTaskEntry('linter', 'agent-2', repoRoot),
      'utf8',
    );

    // linter (agent-2) spawns reviewer (agent-3) — this is depth-2 nesting.
    // The grandchild sidechain sits under the linter's sidechain dir.
    // agent-agent-2.jsonl is the sidechain of linter (agent-2) itself.
    writeFileSync(
      join(subagentsDir, 'agent-agent-2.jsonl'),
      sidechainTaskEntry('reviewer', 'agent-3', repoRoot),
      'utf8',
    );

    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    const linterRun = runs.find((r) => r.agentName === 'linter');
    expect(linterRun?.parentAgentId).toBe('agent-1');

    // agent-3 is extracted from agent-agent-2.jsonl whose filename encodes parentAgentId = 'agent-2'
    const grandchildRuns = runs.filter((r) => r.runId === 'agent-3');
    expect(grandchildRuns).toHaveLength(1);
    expect(grandchildRuns[0]?.parentAgentId).toBe('agent-2');
  });

  it('keeps-and-tags interrupted (incomplete) nested runs with the incomplete tag', () => {
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    // An interrupted run: status is not 'completed', missing totalDurationMs etc.
    writeFileSync(
      join(subagentsDir, 'agent-agent-1.jsonl'),
      JSON.stringify({
        type: 'user',
        cwd: repoRoot,
        sessionId: 'session',
        toolUseResult: {
          status: 'interrupted',
          agentId: 'agent-2',
          agentType: 'linter',
        },
      }),
      'utf8',
    );

    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    const nestedRun = runs.find((r) => r.runId === 'agent-2');
    expect(nestedRun).toBeDefined();
    expect(nestedRun?.tags).toContain('incomplete');
    expect(nestedRun?.parentAgentId).toBe('agent-1');
  });

  it('drops a nested run naming a built-in agent', () => {
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'agent-agent-1.jsonl'),
      sidechainTaskEntry('Explore', 'agent-builtin', repoRoot),
      'utf8',
    );

    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    expect(runs.find((r) => r.runId === 'agent-builtin')).toBeUndefined();
  });

  it('drops a nested run that matches no registered source', () => {
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'agent-agent-1.jsonl'),
      sidechainTaskEntry('linter', 'agent-2', repoRoot),
      'utf8',
    );

    // Pass no sources — the nested run can't be attributed
    const runs = ingest({ sources: [], projectsRoot, storePath });

    expect(runs.find((r) => r.runId === 'agent-2')).toBeUndefined();
  });
});
