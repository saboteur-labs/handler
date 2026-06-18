/**
 * End-to-end integration test for Tier B output in `handler show <agent>` (V1 Feature 2, Task 8).
 *
 * Seeds fixture JSONL transcript data for four agent scenarios and exercises the
 * full pipeline: ingestion, Tier B reference/outlier/contract scoring, and CLI
 * output rendering via `run()`. Each scenario uses a separate agent definition.
 *
 * Scenarios:
 *   1. thin-agent  — fewer than 5 prior runs → "insufficient history"
 *   2. busy-agent  — ≥5 prior runs; scored run has 5× median tokens → "outlier"
 *   3. json-agent  — ≥5 prior runs; definition declares "return JSON"; scored run has valid JSON sidechain → "pass"
 *   4. plain-agent — ≥5 prior runs; no contract markers in definition → "n/a"
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler show: Tier B end-to-end integration', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let scoreStorePath: string;
  let tierBStorePath: string;
  let projectsRoot: string;
  let agentsHome: string;
  let projectDir: string;

  /**
   * Build a completed `toolUseResult` transcript entry with configurable metrics.
   */
  function completedEntry(opts: {
    agentId: string;
    agentType: string;
    sessionId: string;
    timestamp: string;
    cwd: string;
    totalTokens?: number;
    totalDurationMs?: number;
  }): string {
    return JSON.stringify({
      type: 'user',
      cwd: opts.cwd,
      sessionId: opts.sessionId,
      timestamp: opts.timestamp,
      toolUseResult: {
        status: 'completed',
        agentId: opts.agentId,
        agentType: opts.agentType,
        totalDurationMs: opts.totalDurationMs ?? 2000,
        totalTokens: opts.totalTokens ?? 1000,
        totalToolUseCount: 5,
        toolStats: { readCount: 3, editCount: 1 },
      },
    });
  }

  /**
   * Write a single-entry transcript file and return the transcript path.
   */
  function writeTranscript(fileName: string, line: string): string {
    const filePath = join(projectDir, fileName);
    writeFileSync(filePath, line, 'utf8');
    return filePath;
  }

  /**
   * Write a sidechain sub-transcript for contract checking.
   * The sidechain lives at: <projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl
   */
  function writeSidechain(sessionId: string, agentId: string, content: string): void {
    const sidechainDir = join(projectDir, sessionId, 'subagents');
    mkdirSync(sidechainDir, { recursive: true });
    writeFileSync(
      join(sidechainDir, `agent-${agentId}.jsonl`),
      JSON.stringify({ type: 'assistant', message: { content } }),
      'utf8',
    );
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-tier-b-e2e-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    scoreStorePath = join(dir, 'scores.json');
    tierBStorePath = join(dir, 'tier-b.json');
    projectsRoot = join(dir, 'projects');

    // Agent home directory: holds agent definitions under .claude/agents/
    agentsHome = join(dir, 'home');
    const agentsDir = join(agentsHome, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    // Scenario 1: thin-agent — no contract, no special content
    writeFileSync(join(agentsDir, 'thin-agent.md'), 'A minimal agent with few runs.', 'utf8');

    // Scenario 2: busy-agent — no contract markers
    writeFileSync(
      join(agentsDir, 'busy-agent.md'),
      'A busy agent with consistent token usage.',
      'utf8',
    );

    // Scenario 3: json-agent — declares JSON contract
    writeFileSync(
      join(agentsDir, 'json-agent.md'),
      'This agent must return JSON for all outputs.',
      'utf8',
    );

    // Scenario 4: plain-agent — no contract markers
    writeFileSync(
      join(agentsDir, 'plain-agent.md'),
      'A plain agent without any output contract.',
      'utf8',
    );

    // Single project directory — cwd in transcript entries points to agentsHome
    // so the nearest-ancestor resolution attributes runs to the user source.
    projectDir = join(projectsRoot, 'project-encoded');
    mkdirSync(projectDir, { recursive: true });

    // -----------------------------------------------------------------------
    // Scenario 1: thin-agent — only 3 runs (fewer than DEFAULT_MIN_RUNS = 5)
    // Runs are ordered oldest → newest; the last run is the "scored" run.
    // -----------------------------------------------------------------------
    const thinBase = '2025-01-';
    for (let i = 1; i <= 3; i++) {
      const ts = `2025-01-${String(i).padStart(2, '0')}T10:00:00.000Z`;
      const agentId = `thin-run-${i}`;
      const sessionId = `thin-session-${i}`;
      writeTranscript(
        `thin-${i}.jsonl`,
        completedEntry({
          agentId,
          agentType: 'thin-agent',
          sessionId,
          timestamp: ts,
          cwd: agentsHome,
        }),
      );
    }
    void thinBase;

    // -----------------------------------------------------------------------
    // Scenario 2: busy-agent — 5 prior runs at 1000 tokens each, then a
    // scored run at 5000 tokens (5× the median → outlier).
    // -----------------------------------------------------------------------
    for (let i = 1; i <= 5; i++) {
      const ts = `2025-02-${String(i).padStart(2, '0')}T10:00:00.000Z`;
      const agentId = `busy-prior-${i}`;
      const sessionId = `busy-prior-session-${i}`;
      writeTranscript(
        `busy-prior-${i}.jsonl`,
        completedEntry({
          agentId,
          agentType: 'busy-agent',
          sessionId,
          timestamp: ts,
          cwd: agentsHome,
          totalTokens: 1000,
          totalDurationMs: 2000,
        }),
      );
    }
    // The scored run: 5× token count, normal duration
    writeTranscript(
      'busy-scored.jsonl',
      completedEntry({
        agentId: 'busy-scored-run',
        agentType: 'busy-agent',
        sessionId: 'busy-scored-session',
        timestamp: '2025-02-10T10:00:00.000Z',
        cwd: agentsHome,
        totalTokens: 5000,
        totalDurationMs: 2000,
      }),
    );

    // -----------------------------------------------------------------------
    // Scenario 3: json-agent — 5 prior runs, then a scored run with a sidechain
    // containing valid JSON output.
    // -----------------------------------------------------------------------
    for (let i = 1; i <= 5; i++) {
      const ts = `2025-03-${String(i).padStart(2, '0')}T10:00:00.000Z`;
      const agentId = `json-prior-${i}`;
      const sessionId = `json-prior-session-${i}`;
      writeTranscript(
        `json-prior-${i}.jsonl`,
        completedEntry({
          agentId,
          agentType: 'json-agent',
          sessionId,
          timestamp: ts,
          cwd: agentsHome,
        }),
      );
    }
    // Scored run with valid JSON sidechain
    const jsonScoredSessionId = 'json-scored-session';
    const jsonScoredAgentId = 'json-scored-run';
    writeTranscript(
      'json-scored.jsonl',
      completedEntry({
        agentId: jsonScoredAgentId,
        agentType: 'json-agent',
        sessionId: jsonScoredSessionId,
        timestamp: '2025-03-10T10:00:00.000Z',
        cwd: agentsHome,
      }),
    );
    writeSidechain(jsonScoredSessionId, jsonScoredAgentId, '{"result": "ok"}');

    // -----------------------------------------------------------------------
    // Scenario 4: plain-agent — 5 prior runs, then a scored run. No contract.
    // -----------------------------------------------------------------------
    for (let i = 1; i <= 5; i++) {
      const ts = `2025-04-${String(i).padStart(2, '0')}T10:00:00.000Z`;
      const agentId = `plain-prior-${i}`;
      const sessionId = `plain-prior-session-${i}`;
      writeTranscript(
        `plain-prior-${i}.jsonl`,
        completedEntry({
          agentId,
          agentType: 'plain-agent',
          sessionId,
          timestamp: ts,
          cwd: agentsHome,
        }),
      );
    }
    writeTranscript(
      'plain-scored.jsonl',
      completedEntry({
        agentId: 'plain-scored-run',
        agentType: 'plain-agent',
        sessionId: 'plain-scored-session',
        timestamp: '2025-04-10T10:00:00.000Z',
        cwd: agentsHome,
      }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, {
      registryPath,
      storePath,
      scoreStorePath,
      tierBStorePath,
      projectsRoot,
      out: (line) => lines.push(line),
    });

  let lines: string[] = [];

  async function registerAndClear(): Promise<void> {
    lines = [];
    await invoke(['source', 'register', '--user', agentsHome]);
    lines = [];
  }

  async function showAgent(name: string): Promise<string> {
    lines = [];
    await invoke(['show', name]);
    return lines.join('\n');
  }

  it('shows insufficient history for an agent with fewer than 5 runs', async () => {
    await registerAndClear();
    const output = await showAgent('thin-agent');

    expect(output).toContain('thin-agent');
    // Tier A score line must still appear
    expect(output).toContain('score:');
    // Tier B section must appear, but degraded
    expect(output).toContain('Tier B:');
    expect(output).toContain('insufficient history');
  });

  it('flags a token outlier when a run exceeds 2× the median', async () => {
    await registerAndClear();
    const output = await showAgent('busy-agent');

    expect(output).toContain('busy-agent');
    expect(output).toContain('score:');
    expect(output).toContain('Tier B:');
    // The scored run at 5000 tokens should be flagged as an outlier
    expect(output).toContain('outlier');
  });

  it('reports contract pass for a JSON-contract agent with valid JSON output', async () => {
    await registerAndClear();
    const output = await showAgent('json-agent');

    expect(output).toContain('json-agent');
    expect(output).toContain('score:');
    expect(output).toContain('Tier B:');
    // The scored run has a valid JSON sidechain → contract pass
    expect(output).toContain('pass');
  });

  it('reports contract n/a for an agent without a declared contract', async () => {
    await registerAndClear();
    const output = await showAgent('plain-agent');

    expect(output).toContain('plain-agent');
    expect(output).toContain('score:');
    expect(output).toContain('Tier B:');
    // No contract in definition → not-applicable
    expect(output).toContain('n/a');
  });
});
