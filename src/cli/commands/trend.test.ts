/**
 * Tests for `handler trend <agent>` command (v1 Feature 1, Task 4).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: trend command', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let scoreStorePath: string;
  let projectsRoot: string;
  let repo: string;
  let home: string;
  let out: string[];

  function entry(
    toolUseResult: Record<string, unknown>,
    cwd: string,
    timestamp = '2024-01-15T10:00:00.000Z',
  ): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      timestamp,
      toolUseResult,
    });
  }

  function completed(
    agentType: string,
    agentId: string,
    cwd: string,
    timestamp = '2024-01-15T10:00:00.000Z',
  ): string {
    return entry(
      {
        status: 'completed',
        agentId,
        agentType,
        totalDurationMs: 1234,
        totalTokens: 5000,
        totalToolUseCount: 12,
        toolStats: {},
      },
      cwd,
      timestamp,
    );
  }

  function interrupted(agentType: string, agentId: string, cwd: string): string {
    return entry({ agentId, agentType }, cwd); // no status/totals -> incomplete
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-trend-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    scoreStorePath = join(dir, 'scores.json');
    projectsRoot = join(dir, 'projects');
    repo = join(dir, 'repo');
    home = join(dir, 'home');

    for (const root of [repo, home]) {
      const agentsDir = join(root, '.claude', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'reviewer.md'), 'definition body', 'utf8');
    }

    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, {
      registryPath,
      storePath,
      scoreStorePath,
      projectsRoot,
      out: (line) => out.push(line),
    });

  // Helper: set up a single completed run for 'reviewer'
  function setupSingleRun(timestamp = '2024-01-15T10:00:00.000Z'): void {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completed('reviewer', 'agent-1', repo, timestamp),
      'utf8',
    );
  }

  // Helper: set up multiple completed runs for 'reviewer'
  function setupMultipleRuns(): void {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [
        completed('reviewer', 'agent-1', repo, '2024-01-10T10:00:00.000Z'),
        completed('reviewer', 'agent-2', repo, '2024-01-15T10:00:00.000Z'),
        completed('reviewer', 'agent-3', repo, '2024-01-20T10:00:00.000Z'),
      ].join('\n'),
      'utf8',
    );
  }

  // 1. No runs for agent -> prints "No runs found"
  it('prints "No runs found" when there are no runs for the agent', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'ghost'])).toBe(0);
    expect(out.join('\n')).toMatch(/No runs found for agent "ghost"/);
  });

  // 2. Unknown agent -> prints "No runs found"
  it('prints "No runs found" for an agent name with zero matching runs', async () => {
    setupSingleRun();
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'unknown-agent'])).toBe(0);
    expect(out.join('\n')).toMatch(/No runs found for agent "unknown-agent"/);
  });

  // 3. Single run -> renders one row
  it('renders a single row for a single run', async () => {
    setupSingleRun('2024-01-15T10:00:00.000Z');
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toContain('2024-01-15T10:00:00.000Z');
    expect(report).toContain('1234ms');
    expect(report).toContain('5000');
    expect(report).toContain('12');
    expect(report).toContain('completed');
  });

  // 4. Multiple runs -> rows ordered oldest->newest
  it('renders rows ordered oldest to newest', async () => {
    setupMultipleRuns();
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    const idx1 = report.indexOf('2024-01-10');
    const idx2 = report.indexOf('2024-01-15');
    const idx3 = report.indexOf('2024-01-20');
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  // 5. Incomplete run row -> shows — for numeric fields and [incomplete] tag
  it('shows — for numeric fields and [incomplete] tag for incomplete runs', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      interrupted('reviewer', 'agent-1', repo),
      'utf8',
    );
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toContain('[incomplete]');
    // Numeric fields should show — (em dash)
    expect(report).toContain('—');
  });

  // 6. Missing-timestamp run -> shows — for timestamp and [no-timestamp] tag
  it('shows — for timestamp and [no-timestamp] tag for missing-timestamp runs', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    // Write a run entry without a timestamp field
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      JSON.stringify({
        type: 'user',
        cwd: repo,
        sessionId: 'session',
        // no timestamp field
        toolUseResult: {
          status: 'completed',
          agentId: 'agent-1',
          agentType: 'reviewer',
          totalDurationMs: 1234,
          totalTokens: 5000,
          totalToolUseCount: 12,
          toolStats: {},
        },
      }),
      'utf8',
    );
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toContain('[no-timestamp]');
    // The timestamp column should show em dash
    expect(report).toMatch(/—/);
  });

  // 7. --bucket week -> bucket rows with correct format
  it('renders bucket rows with YYYY-Www format for --bucket week', async () => {
    setupMultipleRuns();
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer', '--bucket', 'week'])).toBe(0);
    const report = out.join('\n');
    // ISO week format
    expect(report).toMatch(/\d{4}-W\d{2}/);
    expect(report).toContain('runs');
  });

  // 8. --bucket day -> bucket rows
  it('renders bucket rows with YYYY-MM-DD format for --bucket day', async () => {
    setupMultipleRuns();
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer', '--bucket', 'day'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(report).toContain('runs');
  });

  // 9. --since filter -> only runs on/after the date
  it('filters runs to only those on/after --since date', async () => {
    setupMultipleRuns();
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer', '--since', '2024-01-15'])).toBe(0);
    const report = out.join('\n');
    expect(report).not.toContain('2024-01-10');
    expect(report).toContain('2024-01-15');
    expect(report).toContain('2024-01-20');
  });

  // 10. --last filter -> only last N runs
  it('filters runs to only the last N with --last', async () => {
    setupMultipleRuns();
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer', '--last', '2'])).toBe(0);
    const report = out.join('\n');
    expect(report).not.toContain('2024-01-10');
    expect(report).toContain('2024-01-15');
    expect(report).toContain('2024-01-20');
  });

  // 11. Invalid --bucket value -> error message
  it('prints an error for an invalid --bucket value', async () => {
    setupSingleRun();
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer', '--bucket', 'month'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/Unknown bucket granularity "month"/);
    expect(report).toMatch(/Use "day" or "week"/);
  });

  // 12. Ambiguous agent name -> disambiguation prompt (same as show)
  it('prints disambiguation prompt for ambiguous agent name', async () => {
    // A second run attributed to the user-level source (cwd under home).
    const projectDir = join(projectsRoot, '-encoded-2');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 's.jsonl'), completed('reviewer', 'agent-3', home), 'utf8');
    // Also set up a run for repo
    setupSingleRun();

    await invoke(['source', 'register', repo]);
    await invoke(['source', 'register', '--user', home]);
    out.length = 0;
    expect(await invoke(['trend', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/[Mm]ultiple agents named "reviewer"/);
    expect(report).toContain(repo);
    expect(report).toContain(home);
  });

  describe('nested run "spawned by" annotation in trend (V1 Feature 7, Task 8)', () => {
    /**
     * Write a sidechain file named `agent-<parentAgentId>.jsonl` containing a
     * nested run entry. Claude Code names sidechain files after the parent's
     * agentId, so `parseSidechainParentAgentId` extracts `parentAgentId` from
     * the filename to stamp the nested run.
     */
    function writeNestedRun(
      parentAgentId: string,
      agentType: string,
      agentId: string,
      cwd: string,
      timestamp = '2024-01-16T10:00:00.000Z',
    ): void {
      const subDir = join(projectsRoot, '-encoded', 'session', 'subagents');
      mkdirSync(subDir, { recursive: true });
      const nestedEntry = JSON.stringify({
        type: 'user',
        cwd,
        sessionId: 'session',
        timestamp,
        toolUseResult: {
          status: 'completed',
          agentId,
          agentType,
          totalDurationMs: 800,
          totalTokens: 300,
          totalToolUseCount: 2,
          toolStats: {},
        },
      });
      writeFileSync(join(subDir, `agent-${parentAgentId}.jsonl`), nestedEntry, 'utf8');
    }

    // 13. Mix of nested and top-level runs → annotation only on nested runs
    it('shows "spawned by" annotation only on nested runs, not on top-level runs', async () => {
      // Top-level run: agent-1 (no parentAgentId)
      setupSingleRun('2024-01-15T10:00:00.000Z');
      // Nested run: agent-3 spawned by agent-1 (sidechain file agent-agent-1.jsonl)
      writeNestedRun('agent-1', 'reviewer', 'agent-3', repo, '2024-01-16T10:00:00.000Z');

      await invoke(['source', 'register', repo]);
      out.length = 0;
      expect(await invoke(['trend', 'reviewer'])).toBe(0);
      const report = out.join('\n');

      // The nested run row should show the annotation
      expect(report).toContain('spawned by reviewer');
      // Only one "spawned by" line should appear (not on the top-level run)
      const spawnedByCount = (report.match(/spawned by/g) ?? []).length;
      expect(spawnedByCount).toBe(1);
    });

    // 14. Bucketed output → no annotations rendered
    it('does not render "spawned by" annotations on bucketed rows', async () => {
      setupSingleRun('2024-01-15T10:00:00.000Z');
      writeNestedRun('agent-1', 'reviewer', 'agent-3', repo, '2024-01-16T10:00:00.000Z');

      await invoke(['source', 'register', repo]);
      out.length = 0;
      expect(await invoke(['trend', 'reviewer', '--bucket', 'day'])).toBe(0);
      const report = out.join('\n');

      expect(report).not.toMatch(/spawned by/);
    });

    // 15. Parent run not found → degrades gracefully (raw id shown, no error)
    it('shows raw parentAgentId when parent run is not in the store', async () => {
      // Nested run in sidechain agent-agent-99.jsonl → parentAgentId = 'agent-99'
      // but no run with runId 'agent-99' exists in the store
      writeNestedRun('agent-99', 'reviewer', 'agent-3', repo, '2024-01-15T10:00:00.000Z');

      await invoke(['source', 'register', repo]);
      out.length = 0;
      expect(await invoke(['trend', 'reviewer'])).toBe(0);
      const report = out.join('\n');

      // Degrades gracefully: shows raw id, no error
      expect(report).toContain('spawned by agent-99');
    });
  });
});
