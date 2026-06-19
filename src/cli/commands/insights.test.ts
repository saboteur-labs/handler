/**
 * Tests for `handler insights` command (V1 Feature 4, Task 4).
 *
 * Drives each output section through the CLI action. The command itself must
 * hold no classification logic — it only calls classifyRoster from core.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RUBRIC_VERSION } from '../../core/index';
import { run } from '../index';

describe('handler CLI: insights command', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let scoreStorePath: string;
  let tierBStorePath: string;
  let projectsRoot: string;
  let repo: string;
  let out: string[];

  /** Build a completed-run JSONL entry. */
  function completedEntry(
    agentType: string,
    agentId: string,
    cwd: string,
    timestamp = '2024-01-15T10:00:00.000Z',
    toolStats: Record<string, number> = {},
  ): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      timestamp,
      toolUseResult: {
        status: 'completed',
        agentId,
        agentType,
        totalDurationMs: 1000,
        totalTokens: 2000,
        totalToolUseCount: 5,
        toolStats,
      },
    });
  }

  /** Write a project JSONL file with the given lines. */
  function writeProject(subDir: string, lines: string[]): void {
    const projectDir = join(projectsRoot, subDir);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'session.jsonl'), lines.join('\n'), 'utf8');
  }

  /** Register the repo source. */
  const registerSource = (): Promise<number> =>
    run(['source', 'register', repo], {
      registryPath,
      storePath,
      scoreStorePath,
      tierBStorePath,
      projectsRoot,
      out: () => undefined,
    });

  /** Invoke insights, capturing output. */
  const invoke = (args: string[] = []): Promise<number> =>
    run(['insights', ...args], {
      registryPath,
      storePath,
      scoreStorePath,
      tierBStorePath,
      projectsRoot,
      out: (line) => out.push(line),
    });

  /** Write a Tier A score store with a single failing run. */
  function writeFailingScore(runId: string): void {
    const score = {
      runId,
      score: {
        rubricVersion: RUBRIC_VERSION,
        band: 'fail',
        composite: 20,
        breakdown: [
          {
            id: 'terminal-success',
            label: 'terminal success',
            status: 'fail',
            detail: 'failed',
          },
        ],
      },
    };
    writeFileSync(scoreStorePath, JSON.stringify({ version: 1, annotations: [score] }), 'utf8');
  }

  /** Write a Tier B store with an outlier result for a run. */
  function writeTierBOutlier(runId: string): void {
    const annotation = {
      runId,
      result: {
        tierBVersion: 1,
        status: 'applicable',
        flags: [
          {
            dimension: 'tokens',
            status: 'outlier',
            value: 99999,
            referenceMedian: 1000,
            factor: 99.9,
          },
        ],
        contract: undefined,
      },
    };
    writeFileSync(
      tierBStorePath,
      JSON.stringify({ version: 1, annotations: [annotation] }),
      'utf8',
    );
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-insights-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    scoreStorePath = join(dir, 'scores.json');
    tierBStorePath = join(dir, 'tier-b.json');
    projectsRoot = join(dir, 'projects');
    repo = join(dir, 'repo');

    const agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'my-agent.md'), 'definition body', 'utf8');

    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 1. Empty roster (no definitions and no runs) prints a clear "no agents" message
  it('prints a clear message when no agents are found', async () => {
    // Remove the seeded definition so the registered source is genuinely empty:
    // no runs and no definitions to enumerate.
    rmSync(join(repo, '.claude', 'agents', 'my-agent.md'));
    await registerSource();
    const code = await invoke();
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/no agents/i);
  });

  // 2. Agents with runs but no issues appear in Healthy section
  it('shows healthy agents in the Healthy section', async () => {
    writeProject('-encoded', [
      completedEntry('my-agent', 'agent-1', repo, new Date().toISOString()),
    ]);
    await registerSource();
    out.length = 0;
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/healthy/i);
    expect(report).toContain('my-agent');
  });

  // 3. No-history section for zero-run agents (Req 7, Task 6)
  it('shows a No history section for agents with a definition but zero runs', async () => {
    // The source has a my-agent definition (written in beforeEach) but no runs.
    // The CLI enumerates registered-source definitions and merges them with the
    // run-derived roster, so a defined-but-unrun agent reaches the no-history
    // bucket instead of being dropped.
    await registerSource();
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/no history/i);
    expect(report).toContain('my-agent');
  });

  // 4. Failing agents show in Failing section
  it('shows failing agents in the Failing section', async () => {
    writeProject('-encoded', [completedEntry('my-agent', 'agent-1', repo)]);
    writeFailingScore('agent-1');
    await registerSource();
    out.length = 0;
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/failing/i);
    expect(report).toContain('my-agent');
  });

  // 5. Unused agents (no runs within recency window) show in Unused section
  it('shows unused agents in the Unused section when all runs are old', async () => {
    // Use a very old timestamp so agent is outside any recency window
    writeProject('-encoded', [
      completedEntry('my-agent', 'agent-1', repo, '2020-01-01T00:00:00.000Z'),
    ]);
    await registerSource();
    out.length = 0;
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/unused/i);
    expect(report).toContain('my-agent');
  });

  // 6. Expensive agents (Tier B outlier) show in Expensive section
  it('shows expensive agents in the Expensive section when Tier B has outlier', async () => {
    writeProject('-encoded', [
      completedEntry('my-agent', 'agent-1', repo, new Date().toISOString()),
    ]);
    // We need to figure out what the identity key looks like for this agent
    // It's ["repo", "<repo-path>", "my-agent"]
    writeTierBOutlier('agent-1');
    await registerSource();
    out.length = 0;
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/expensive/i);
    expect(report).toContain('my-agent');
  });

  // 7. Multi-category agents appear in each applicable section
  it('shows multi-category agents in all applicable sections', async () => {
    // Old run (unused) + failing score => both unused and failing
    writeProject('-encoded', [
      completedEntry('my-agent', 'agent-1', repo, '2020-01-01T00:00:00.000Z'),
    ]);
    writeFailingScore('agent-1');
    await registerSource();
    out.length = 0;
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    // my-agent should appear in BOTH unused and failing sections
    expect(report).toMatch(/unused/i);
    expect(report).toMatch(/failing/i);
    // Count occurrences of 'my-agent' in the output
    const occurrences = (report.match(/my-agent/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  // 8. Low-confidence assessments are visibly marked
  it('marks low-confidence assessments with (low confidence) label', async () => {
    // A single run (below minRuns=3) that is old (unused) → low confidence
    writeProject('-encoded', [
      completedEntry('my-agent', 'agent-1', repo, '2020-01-01T00:00:00.000Z'),
    ]);
    await registerSource();
    out.length = 0;
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/low confidence/i);
  });

  // 9. Command exits 0 in all cases (read-only, no crash)
  it('always exits with code 0', async () => {
    await registerSource();
    expect(await invoke()).toBe(0);
  });

  // 10. Multiple agents: sections render correctly
  it('renders multiple agents across sections correctly', async () => {
    // Add a second agent definition
    writeFileSync(join(repo, '.claude', 'agents', 'other-agent.md'), 'body', 'utf8');

    const now = new Date().toISOString();
    const old = '2020-01-01T00:00:00.000Z';
    writeProject('-encoded', [
      completedEntry('my-agent', 'agent-1', repo, now),
      completedEntry('other-agent', 'agent-2', repo, old),
    ]);
    await registerSource();
    out.length = 0;
    const code = await invoke();
    expect(code).toBe(0);
    const report = out.join('\n');
    // my-agent is recent => healthy, other-agent is old => unused
    expect(report).toMatch(/healthy/i);
    expect(report).toContain('my-agent');
    expect(report).toMatch(/unused/i);
    expect(report).toContain('other-agent');
  });
});
