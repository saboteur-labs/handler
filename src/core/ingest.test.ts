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

describe('ingest — in-process deduplication', () => {
  let repoRoot: string;
  let projectsRoot: string;
  let storePath: string;
  let projectDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'handler-repo-'));
    projectsRoot = mkdtempSync(join(tmpdir(), 'handler-projects-'));
    storePath = join(mkdtempSync(join(tmpdir(), 'handler-store-')), 'runs.json');
    projectDir = join(projectsRoot, '-encoded-project');
    mkdirSync(projectDir, { recursive: true });

    const agentsDir = join(repoRoot, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'reviewer.md'), 'reviewer def', 'utf8');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(join(storePath, '..'), { recursive: true, force: true });
  });

  it('deduplicates a run whose agentId appears in both a top-level transcript and a sidechain', () => {
    // Top-level transcript records reviewer as agent-1
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

    // A sidechain file also contains the same agentId (agent-1) as a Task result
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'agent-agent-99.jsonl'),
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

    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    // Only one record for agent-1 — the duplicate is skipped
    const reviewerRuns = runs.filter((r) => r.runId === 'agent-1');
    expect(reviewerRuns).toHaveLength(1);
  });

  it('writes both runs when two different agentIds appear in the same sidechain', () => {
    // Top-level transcript with a dummy entry so the session directory is valid
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      JSON.stringify({
        type: 'user',
        cwd: repoRoot,
        sessionId: 'session',
        toolUseResult: {
          status: 'completed',
          agentId: 'agent-0',
          agentType: 'reviewer',
          totalDurationMs: 500,
          totalTokens: 100,
          totalToolUseCount: 1,
          toolStats: { readCount: 0 },
        },
      }),
      'utf8',
    );

    const agentsDir = join(repoRoot, '.claude', 'agents');
    writeFileSync(join(agentsDir, 'linter.md'), 'linter def', 'utf8');

    // Sidechain has two different agentIds
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'agent-agent-0.jsonl'),
      [
        JSON.stringify({
          type: 'user',
          cwd: repoRoot,
          sessionId: 'session',
          toolUseResult: {
            status: 'completed',
            agentId: 'agent-1',
            agentType: 'reviewer',
            totalDurationMs: 800,
            totalTokens: 300,
            totalToolUseCount: 2,
            toolStats: { readCount: 1 },
          },
        }),
        JSON.stringify({
          type: 'user',
          cwd: repoRoot,
          sessionId: 'session',
          toolUseResult: {
            status: 'completed',
            agentId: 'agent-2',
            agentType: 'linter',
            totalDurationMs: 600,
            totalTokens: 200,
            totalToolUseCount: 1,
            toolStats: { readCount: 0 },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    // Both nested runs should be stored
    expect(runs.find((r) => r.runId === 'agent-1')).toBeDefined();
    expect(runs.find((r) => r.runId === 'agent-2')).toBeDefined();
  });

  it('handles the same agentId across two separate ingest calls without error', () => {
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

    const sources = [repoSource(repoRoot)];
    // First call — ingests and stores
    ingest({ sources, projectsRoot, storePath });
    // Second call — store's upsert no-ops (not the in-process set), no error
    const second = ingest({ sources, projectsRoot, storePath });

    // Store still has exactly one record
    expect(second.filter((r) => r.runId === 'agent-1')).toHaveLength(1);
  });
});
