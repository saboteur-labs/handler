import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildAsyncLaunchedResult,
  buildMeta,
  buildSubTranscript,
  buildTaskNotificationText,
  CAPTURE_CWD,
  CAPTURE_SESSION_ID,
} from './__fixtures__/capture/fixtures';
import { agentIdentity, identityKey } from './identity';
import { ingest } from './ingest';
import { repoSource, userSource } from './sources/source';
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

  it('locates a nested run sub-transcript as its sibling and captures telemetry', () => {
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    // Parent (reviewer) sidechain references the nested linter run.
    writeFileSync(
      join(subagentsDir, 'agent-agent-1.jsonl'),
      sidechainTaskEntry('linter', 'agent-2', repoRoot),
      'utf8',
    );
    // The nested run's OWN sub-transcript is a sibling in the same dir.
    const nestedSub = join(subagentsDir, 'agent-agent-2.jsonl');
    writeFileSync(
      nestedSub,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-18T10:00:00.000Z',
        message: {
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
          content: [],
        },
      }),
      'utf8',
    );

    const runs = ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });

    const nestedRun = runs.find((r) => r.agentName === 'linter');
    expect(nestedRun?.sidechainPath).toBe(nestedSub);
    expect(nestedRun?.telemetry?.turns).toHaveLength(1);
  });

  it('self-heals a stale nested sub-transcript locator on re-ingest', () => {
    const subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'agent-agent-1.jsonl'),
      sidechainTaskEntry('linter', 'agent-2', repoRoot),
      'utf8',
    );
    const nestedSub = join(subagentsDir, 'agent-agent-2.jsonl');
    writeFileSync(
      nestedSub,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-18T10:00:00.000Z',
        message: {
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
          content: [],
        },
      }),
      'utf8',
    );

    // First ingest yields a correct record; simulate a record persisted by the
    // buggy build by overwriting its locator with a non-existent doubled path.
    ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });
    const store = new RunStore(storePath);
    const broken = store.list().find((r) => r.agentName === 'linter');
    expect(broken).toBeDefined();
    const badPath = join(subagentsDir, 'session', 'subagents', 'agent-agent-2.jsonl');
    store.upsert({ ...broken!, sidechainPath: badPath, telemetry: undefined });
    expect(
      new RunStore(storePath).list().find((r) => r.agentName === 'linter')?.telemetry,
    ).toBeUndefined();

    // Re-ingest should heal the locator back to the real sibling and recover telemetry.
    ingest({ sources: [repoSource(repoRoot)], projectsRoot, storePath });
    const healed = new RunStore(storePath).list().find((r) => r.agentName === 'linter');
    expect(healed?.sidechainPath).toBe(nestedSub);
    expect(healed?.telemetry?.turns).toHaveLength(1);
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

describe('ingest — meta pass (subagent-run-capture FR-4..FR-8, FR-13..FR-16, FR-23)', () => {
  let home: string;
  let repoRoot: string;
  let projectsRoot: string;
  let storePath: string;
  let projectDir: string;
  let subagentsDir: string;

  const usage = { input: 100, cacheRead: 50, cacheCreation: 25, output: 10 };

  /** Write a meta-discoverable run: sub-transcript (3 tools, 6s) plus meta file. */
  function writeMetaRun(
    agentId: string,
    agentType: string,
    extra: { parentAgentId?: string; spawnDepth?: number } = {},
  ): string {
    const sidechain = join(subagentsDir, `agent-${agentId}.jsonl`);
    writeFileSync(
      sidechain,
      buildSubTranscript({
        agentId,
        startMs: Date.parse('2026-10-01T10:00:00.000Z'),
        durationMs: 6000,
        turns: [
          { tools: ['Read', 'Read'], usage },
          { tools: ['Edit'], usage },
          { tools: [], usage },
        ],
      }),
      'utf8',
    );
    writeFileSync(
      join(subagentsDir, `agent-${agentId}.meta.json`),
      JSON.stringify(
        buildMeta({ agentType, toolUseId: `toolu_${agentId}`, spawnDepth: 1, ...extra }),
      ),
      'utf8',
    );
    return sidechain;
  }

  function notificationEntry(taskId: string, status: string): string {
    return JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildTaskNotificationText({
              taskId,
              status,
              toolUses: 3,
              durationMs: 6000,
              subagentTokens: 185,
            }),
          },
        ],
      },
    });
  }

  function writeParent(lines: string[]): void {
    writeFileSync(join(projectDir, 'session.jsonl'), lines.join('\n'), 'utf8');
  }

  function run(): ReturnType<typeof ingest> {
    return ingest({
      sources: [repoSource(repoRoot), userSource(home)],
      projectsRoot,
      storePath,
    });
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'handler-meta-home-'));
    repoRoot = mkdtempSync(join(tmpdir(), 'handler-meta-repo-'));
    projectsRoot = mkdtempSync(join(tmpdir(), 'handler-meta-projects-'));
    storePath = join(mkdtempSync(join(tmpdir(), 'handler-meta-store-')), 'runs.json');
    for (const [root, name] of [
      [home, 'alpha'],
      [home, 'beta'],
      [repoRoot, 'alpha'],
    ] as const) {
      mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
      writeFileSync(join(root, '.claude', 'agents', `${name}.md`), `${name} definition`, 'utf8');
    }
    projectDir = join(projectsRoot, '-encoded-project');
    subagentsDir = join(projectDir, 'session', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  });

  it('discovers a meta run and computes metrics from the sub-transcript', () => {
    const sidechain = writeMetaRun('m-1', 'alpha');
    const runs = run();

    expect(runs).toHaveLength(1);
    const r = runs[0]!;
    expect(r.runId).toBe('m-1');
    expect(r.agentName).toBe('alpha');
    expect(r.source).toBe('transcript');
    expect(r.sidechainPath).toBe(sidechain);
    expect(r.cwd).toBe(CAPTURE_CWD);
    expect(r.sessionId).toBe(CAPTURE_SESSION_ID);
    expect(r.totalToolUseCount).toBe(3);
    expect(r.totalDurationMs).toBe(6000);
    expect(r.totalTokens).toBe(185);
    expect(r.definitionSnapshot).toBe('alpha definition');
    expect(r.tags).toEqual([]);
    expect(r.status).toBeUndefined();
  });

  it('takes status from the latest notification, and leaves it unset with none', () => {
    writeMetaRun('m-1', 'alpha');
    writeMetaRun('m-2', 'beta');
    writeParent([
      notificationEntry('m-1', 'completed'),
      notificationEntry('m-1', 'failed'),
      notificationEntry('ghost-id', 'completed'),
      '{ not json',
    ]);
    const runs = run();

    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.runId === 'm-1')?.status).toBe('failed');
    expect(runs.find((r) => r.runId === 'm-2')?.status).toBeUndefined();
  });

  it('ignores notifications whose task-id matches no on-disk run', () => {
    writeParent([notificationEntry('ghost-id', 'completed')]);
    expect(run()).toEqual([]);
  });

  it('records parentAgentId and spawnDepth from the meta file for a nested run', () => {
    writeMetaRun('m-1', 'alpha');
    writeMetaRun('m-2', 'beta', { parentAgentId: 'm-1', spawnDepth: 2 });
    const nested = run().find((r) => r.runId === 'm-2');

    expect(nested?.parentAgentId).toBe('m-1');
    expect(nested?.spawnDepth).toBe(2);
  });

  it('produces no run, and no error, for an async_launched result without agentType', () => {
    writeParent([
      JSON.stringify({
        type: 'user',
        cwd: CAPTURE_CWD,
        sessionId: 'session',
        toolUseResult: buildAsyncLaunchedResult({ agentId: 'a-1', description: 'Synthetic' }),
      }),
    ]);
    expect(run()).toEqual([]);
  });

  it('keeps a run with an empty sub-transcript, tagged incomplete', () => {
    writeMetaRun('m-1', 'alpha');
    writeFileSync(join(subagentsDir, 'agent-m-1.jsonl'), '', 'utf8');
    const r = run()[0];

    expect(r?.tags).toContain('incomplete');
    expect(r?.totalToolUseCount).toBeUndefined();
  });

  it('skips a malformed meta file and a malformed sub-transcript without dropping other runs', () => {
    writeMetaRun('m-good', 'alpha');
    writeMetaRun('m-bad-meta', 'beta');
    writeFileSync(join(subagentsDir, 'agent-m-bad-meta.meta.json'), '{ nope', 'utf8');
    writeMetaRun('m-bad-sub', 'beta');
    writeFileSync(join(subagentsDir, 'agent-m-bad-sub.jsonl'), '{ nope\n{"type":', 'utf8');
    const runs = run();

    expect(runs.map((r) => r.runId).sort()).toEqual(['m-bad-sub', 'm-good']);
    expect(runs.find((r) => r.runId === 'm-bad-sub')?.tags).toContain('incomplete');
  });

  it('drops built-in agents and runs matching no registered source', () => {
    writeMetaRun('m-builtin', 'Explore');
    writeMetaRun('m-1', 'alpha');
    expect(ingest({ sources: [], projectsRoot, storePath })).toEqual([]);
    const runs = run();
    expect(runs.map((r) => r.runId)).toEqual(['m-1']);
  });

  it('is idempotent and yields one run for repeated notifications', () => {
    writeMetaRun('m-1', 'alpha');
    writeParent([notificationEntry('m-1', 'completed'), notificationEntry('m-1', 'completed')]);
    run();
    const second = run();

    expect(second).toHaveLength(1);
    expect(new RunStore(storePath).list()).toHaveLength(1);
  });

  describe('merge with the legacy pass (FR-13, FR-15)', () => {
    function legacyEntry(overrides: Record<string, unknown>): string {
      return JSON.stringify({
        type: 'user',
        cwd: CAPTURE_CWD,
        sessionId: 'session',
        toolUseResult: { agentType: 'alpha', agentId: 'm-1', ...overrides },
      });
    }

    it('stores a run seen by both paths once; a complete legacy result supplies the metrics', () => {
      writeMetaRun('m-1', 'alpha', { parentAgentId: 'p-9', spawnDepth: 2 });
      writeParent([
        legacyEntry({
          status: 'completed',
          totalDurationMs: 1234,
          totalTokens: 999,
          totalToolUseCount: 7,
          toolStats: { readCount: 7 },
        }),
        notificationEntry('m-1', 'failed'),
      ]);
      const runs = run();

      expect(runs).toHaveLength(1);
      const r = runs[0]!;
      expect(r.status).toBe('completed');
      expect(r.totalDurationMs).toBe(1234);
      expect(r.totalTokens).toBe(999);
      expect(r.totalToolUseCount).toBe(7);
      expect(r.toolStats).toEqual({ readCount: 7 });
      expect(r.parentAgentId).toBe('p-9');
      expect(r.spawnDepth).toBe(2);
    });

    it('fills the gaps of an incomplete legacy result from the meta run', () => {
      writeMetaRun('m-1', 'alpha');
      writeParent([legacyEntry({ status: 'completed' }), notificationEntry('m-1', 'completed')]);
      const runs = run();

      expect(runs).toHaveLength(1);
      const r = runs[0]!;
      expect(r.status).toBe('completed');
      expect(r.totalDurationMs).toBe(6000);
      expect(r.totalTokens).toBe(185);
      expect(r.totalToolUseCount).toBe(3);
      expect(r.tags).not.toContain('incomplete');
      expect(r.definitionSnapshot).toBe('alpha definition');
    });

    it('keeps a legacy-only run exactly as before', () => {
      writeParent([
        legacyEntry({
          status: 'completed',
          totalDurationMs: 10,
          totalTokens: 20,
          totalToolUseCount: 1,
        }),
      ]);
      const r = run()[0]!;
      expect(r.totalDurationMs).toBe(10);
      expect(r.parentAgentId).toBeUndefined();
      expect(r.spawnDepth).toBeUndefined();
    });

    it('stores per (identityKey, runId) when one agentId resolves to different identities', () => {
      // Legacy entry's cwd is inside the repo (repo identity); the sub-transcript's cwd is
      // not (user-level identity). Same agentId, same name, two identities: two records.
      writeMetaRun('m-1', 'alpha');
      writeParent([
        JSON.stringify({
          type: 'user',
          cwd: repoRoot,
          sessionId: 'session',
          toolUseResult: {
            agentType: 'alpha',
            agentId: 'm-1',
            status: 'completed',
            totalDurationMs: 1,
            totalTokens: 2,
            totalToolUseCount: 3,
          },
        }),
      ]);
      const runs = run();

      expect(runs).toHaveLength(2);
      expect(new Set(runs.map((r) => r.identityKey)).size).toBe(2);
      expect(runs.every((r) => r.runId === 'm-1')).toBe(true);
      expect(run()).toHaveLength(2);
    });
  });

  describe('later ingest (FR-6, FR-22/23)', () => {
    it('updates status and metrics but never the definition snapshot', () => {
      const sidechain = writeMetaRun('m-1', 'alpha');
      expect(run()[0]?.status).toBeUndefined();

      writeFileSync(join(home, '.claude', 'agents', 'alpha.md'), 'EDITED definition', 'utf8');
      appendFileSync(
        sidechain,
        buildSubTranscript({
          agentId: 'm-1',
          startMs: Date.parse('2026-10-01T10:00:09.000Z'),
          durationMs: 3000,
          turns: [
            { tools: ['Bash'], usage: { input: 1, cacheRead: 2, cacheCreation: 3, output: 4 } },
          ],
        }),
      );
      writeParent([notificationEntry('m-1', 'completed')]);
      const runs = run();

      expect(runs).toHaveLength(1);
      const r = runs[0]!;
      expect(r.status).toBe('completed');
      expect(r.totalToolUseCount).toBe(4);
      expect(r.totalTokens).toBe(10);
      expect(r.definitionSnapshot).toBe('alpha definition');
    });

    it('lets a later notification change a stored status (resume)', () => {
      writeMetaRun('m-1', 'alpha');
      writeParent([notificationEntry('m-1', 'completed')]);
      expect(run()[0]?.status).toBe('completed');
      writeParent([notificationEntry('m-1', 'completed'), notificationEntry('m-1', 'failed')]);
      expect(run()[0]?.status).toBe('failed');
    });

    it('does not erase stored metrics when a later read yields none', () => {
      const sidechain = writeMetaRun('m-1', 'alpha');
      run();
      writeFileSync(sidechain, '', 'utf8');
      const r = run()[0]!;
      expect(r.totalToolUseCount).toBe(3);
    });

    it.each(['runlog', 'hook'] as const)(
      'upgrades a %s record to a transcript record',
      (source) => {
        writeMetaRun('m-1', 'alpha');
        const first = run()[0]!;
        const store = new RunStore(storePath);
        store.upsert({
          ...first,
          source,
          status: undefined,
          totalToolUseCount: undefined,
          definitionSnapshot: null,
          tags: ['orphan', 'incomplete'],
        });
        const r = run()[0]!;

        expect(r.source).toBe('transcript');
        expect(r.totalToolUseCount).toBe(3);
        expect(r.definitionSnapshot).toBe('alpha definition');
      },
    );
  });
});
