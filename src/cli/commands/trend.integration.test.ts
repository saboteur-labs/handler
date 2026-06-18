/**
 * End-to-end integration test for `handler trend <agent>` (v1 Feature 1, Task 5).
 *
 * Seeds fixture JSONL transcript data spanning multiple weeks for one agent and
 * exercises the full pipeline: per-run series, --bucket week aggregate, --since
 * window, and --last window.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler trend: end-to-end integration', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let scoreStorePath: string;
  let projectsRoot: string;
  let agentsHome: string;
  let out: string[];

  /**
   * Serialise a completed toolUseResult entry. Each call gets a unique
   * sessionId so it ends up as an independent attributed run.
   */
  function completedEntry(agentId: string, timestamp: string, sessionId: string): string {
    return JSON.stringify({
      type: 'user',
      cwd: agentsHome,
      sessionId,
      timestamp,
      toolUseResult: {
        status: 'completed',
        agentId,
        agentType: 'test-agent',
        totalDurationMs: 2000,
        totalTokens: 1500,
        totalToolUseCount: 8,
        toolStats: { readCount: 5, editCount: 2 },
      },
    });
  }

  /**
   * Serialise an incomplete (no status/totals) toolUseResult entry.
   */
  function incompleteEntry(agentId: string, timestamp: string, sessionId: string): string {
    return JSON.stringify({
      type: 'user',
      cwd: agentsHome,
      sessionId,
      timestamp,
      toolUseResult: {
        agentId,
        agentType: 'test-agent',
        // no status / no totals → tagged incomplete on ingest
      },
    });
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-trend-e2e-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    scoreStorePath = join(dir, 'scores.json');
    projectsRoot = join(dir, 'projects');

    // Create a fake user-level agents directory with a test-agent definition.
    agentsHome = join(dir, 'home');
    const agentsDir = join(agentsHome, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'test-agent.md'), 'test agent definition body', 'utf8');

    /**
     * Runs span three different ISO weeks so --bucket week produces ≥ 2 buckets.
     *
     * Week 2025-W02: 2025-01-06 (Monday)    → agent-w1a
     * Week 2025-W02: 2025-01-08 (Wednesday) → agent-w1b  (same week, second run)
     * Week 2025-W04: 2025-01-20 (Monday)    → agent-w3a
     * Week 2025-W06: 2025-02-03 (Monday)    → agent-w5a (incomplete)
     *
     * Each run lives in its own JSONL file so each gets a distinct sessionId.
     */
    const runs: Array<{ file: string; line: string }> = [
      {
        file: 'session-w1a.jsonl',
        line: completedEntry('agent-w1a', '2025-01-06T09:00:00.000Z', 'session-w1a'),
      },
      {
        file: 'session-w1b.jsonl',
        line: completedEntry('agent-w1b', '2025-01-08T14:00:00.000Z', 'session-w1b'),
      },
      {
        file: 'session-w3a.jsonl',
        line: completedEntry('agent-w3a', '2025-01-20T11:30:00.000Z', 'session-w3a'),
      },
      {
        file: 'session-w5a.jsonl',
        line: incompleteEntry('agent-w5a', '2025-02-03T08:00:00.000Z', 'session-w5a'),
      },
    ];

    const projectDir = join(projectsRoot, '-home-encoded');
    mkdirSync(projectDir, { recursive: true });

    for (const { file, line } of runs) {
      writeFileSync(join(projectDir, file), line, 'utf8');
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

  async function registerAndClear(): Promise<void> {
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;
  }

  it('per-run view: shows all four runs ordered oldest to newest', async () => {
    await registerAndClear();
    expect(await invoke(['trend', 'test-agent'])).toBe(0);
    const report = out.join('\n');

    // All four timestamps should be present.
    expect(report).toContain('2025-01-06');
    expect(report).toContain('2025-01-08');
    expect(report).toContain('2025-01-20');
    expect(report).toContain('2025-02-03');

    // Oldest must appear before the newest.
    const idxFirst = report.indexOf('2025-01-06');
    const idxLast = report.indexOf('2025-02-03');
    expect(idxFirst).toBeGreaterThanOrEqual(0);
    expect(idxLast).toBeGreaterThan(idxFirst);

    // Completed runs should show their telemetry.
    expect(report).toContain('2000ms');
    expect(report).toContain('1500');
    expect(report).toContain('8');
    expect(report).toContain('completed');

    // The incomplete run should be tagged.
    expect(report).toContain('[incomplete]');
  });

  it('--bucket week: produces at least 2 week buckets with correct YYYY-Www keys', async () => {
    await registerAndClear();
    expect(await invoke(['trend', 'test-agent', '--bucket', 'week'])).toBe(0);
    const report = out.join('\n');

    // The header row should appear.
    expect(report).toContain('bucket');
    expect(report).toContain('runs');

    // Jan 6 (Mon) and Jan 8 (Wed) 2025 are both in ISO week 2025-W02.
    // Jan 20 (Mon) 2025 is in ISO week 2025-W04.
    // Feb 3 (Mon) 2025 is in ISO week 2025-W06.
    expect(report).toContain('2025-W02');
    expect(report).toContain('2025-W04');

    // W02 bucket row should come before W04.
    const idxW02 = report.indexOf('2025-W02');
    const idxW04 = report.indexOf('2025-W04');
    expect(idxW02).toBeGreaterThanOrEqual(0);
    expect(idxW04).toBeGreaterThan(idxW02);
  });

  it('--since: filters to only runs on/after the given date', async () => {
    await registerAndClear();
    // Filter to 2025-01-15 and later — should exclude the two W01 runs.
    expect(await invoke(['trend', 'test-agent', '--since', '2025-01-15'])).toBe(0);
    const report = out.join('\n');

    expect(report).not.toContain('2025-01-06');
    expect(report).not.toContain('2025-01-08');
    expect(report).toContain('2025-01-20');
    expect(report).toContain('2025-02-03');
  });

  it('--last 2: keeps only the 2 most-recent runs', async () => {
    await registerAndClear();
    expect(await invoke(['trend', 'test-agent', '--last', '2'])).toBe(0);
    const report = out.join('\n');

    // The two oldest runs should be excluded.
    expect(report).not.toContain('2025-01-06');
    expect(report).not.toContain('2025-01-08');

    // The two most-recent runs should be present.
    expect(report).toContain('2025-01-20');
    expect(report).toContain('2025-02-03');
  });
});
