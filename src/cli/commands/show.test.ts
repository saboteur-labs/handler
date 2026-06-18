import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: show command (Req 11)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let projectsRoot: string;
  let repo: string;
  let home: string;
  let out: string[];

  function entry(toolUseResult: Record<string, unknown>, cwd: string): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      timestamp: '2026-06-17T10:00:00.000Z',
      toolUseResult,
    });
  }

  /** Write a sidechain transcript for a run so it can be scored. */
  function writeSidechain(agentId: string, ...blocks: unknown[]): void {
    const subDir = join(projectsRoot, '-encoded', 'session', 'subagents');
    mkdirSync(subDir, { recursive: true });
    const entries = blocks.map((content) => ({ type: 'user', cwd: repo, message: { content } }));
    writeFileSync(
      join(subDir, `agent-${agentId}.jsonl`),
      entries.map((e) => JSON.stringify(e)).join('\n'),
      'utf8',
    );
  }

  function completed(agentType: string, agentId: string, cwd: string): string {
    return entry(
      {
        status: 'completed',
        agentId,
        agentType,
        totalDurationMs: 1000,
        totalTokens: 500,
        totalToolUseCount: 3,
        toolStats: { readCount: 2 },
      },
      cwd,
    );
  }

  function interrupted(agentType: string, agentId: string, cwd: string): string {
    return entry({ agentId, agentType }, cwd); // no status/totals -> incomplete
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    projectsRoot = join(dir, 'projects');
    repo = join(dir, 'repo');
    home = join(dir, 'home');

    for (const root of [repo, home]) {
      const agentsDir = join(root, '.claude', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'reviewer.md'), 'definition body', 'utf8');
    }

    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [completed('reviewer', 'agent-1', repo), interrupted('reviewer', 'agent-2', repo)].join('\n'),
      'utf8',
    );
    writeSidechain('agent-1', [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }]);

    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, {
      registryPath,
      storePath,
      projectsRoot,
      scoreStorePath: join(dir, 'scores.json'),
      noteStorePath: join(dir, 'notes.json'),
      out: (line) => out.push(line),
    });

  it('reports when the agent has no runs', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['show', 'ghost'])).toBe(0);
    expect(out.join('\n')).toMatch(/No runs found for agent "ghost"/);
  });

  it('shows run history and metrics, flagging incomplete runs', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['show', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toContain('reviewer');
    expect(report).toContain('500 tokens'); // totals exclude the incomplete run
    expect(report).toContain('2026-06-17T10:00:00.000Z'); // last used
    expect(report).toContain('agent-1');
    expect(report).toContain('agent-2');
    expect(report).toContain('incomplete');
  });

  it('shows a deterministic score for a run with a sub-transcript', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['show', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/score:/);
    expect(report).toMatch(/\b(PASS|WARN|FAIL)\b/);
    // the interrupted run (agent-2) has no sidechain and is unscored
    expect(report).toMatch(/unscored/);
  });

  it('surfaces per-run telemetry (tokens, latency, edits, stop reason)', async () => {
    const subDir = join(projectsRoot, '-encoded', 'session', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, 'agent-agent-1.jsonl'),
      [
        {
          type: 'assistant',
          timestamp: '2026-06-17T10:00:00.000Z',
          message: {
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200 },
            model: 'claude-opus-4-8',
            stop_reason: 'end_turn',
            content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }],
          },
        },
        {
          type: 'assistant',
          timestamp: '2026-06-17T10:00:02.000Z',
          message: {
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: 'end_turn',
            content: [],
          },
        },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n'),
      'utf8',
    );

    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['show', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/latency p50 2000ms/);
    expect(report).toMatch(/edits 1/);
    expect(report).toMatch(/end_turn/);
    expect(report).toMatch(/in 110/); // summed input tokens
  });

  it('surfaces an agent note inline, and omits the line when there is none', async () => {
    await invoke(['source', 'register', repo]);

    // No note yet: the show output carries no note line.
    out.length = 0;
    await invoke(['show', 'reviewer']);
    expect(out.join('\n')).not.toMatch(/note:/);

    await invoke(['note', 'set', 'reviewer', '--body', 'remember to widen scope']);
    out.length = 0;
    await invoke(['show', 'reviewer']);
    const report = out.join('\n');
    expect(report).toMatch(/note:/);
    expect(report).toContain('remember to widen scope');
  });

  it('marks a definition change on the run timeline with the metric delta', async () => {
    await invoke(['source', 'register', repo]);
    // First show ingests agent-1 + agent-2 under the original definition.
    out.length = 0;
    await invoke(['show', 'reviewer']);

    // The author edits the definition, then a new run lands under the new one.
    writeFileSync(
      join(repo, '.claude', 'agents', 'reviewer.md'),
      'revised definition body',
      'utf8',
    );
    const projectDir = join(projectsRoot, '-encoded');
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [
        completed('reviewer', 'agent-1', repo),
        interrupted('reviewer', 'agent-2', repo),
        completed('reviewer', 'agent-9', repo),
      ].join('\n'),
      'utf8',
    );
    writeSidechain('agent-9', [{ type: 'tool_use', name: 'Read', input: { file_path: 'b.ts' } }]);

    out.length = 0;
    expect(await invoke(['show', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/definition changed/);
    expect(report).toMatch(/tokens/);
    expect(report).toMatch(/low confidence/); // one run per side
  });

  it('shows no definition-change marker when the definition never changed', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;
    await invoke(['show', 'reviewer']);
    expect(out.join('\n')).not.toMatch(/definition changed/);
  });

  it('lists the sources when the agent name is ambiguous', async () => {
    // A second run attributed to the user-level source (cwd under home).
    const projectDir = join(projectsRoot, '-encoded-2');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 's.jsonl'), completed('reviewer', 'agent-3', home), 'utf8');

    await invoke(['source', 'register', repo]);
    await invoke(['source', 'register', '--user', home]);
    out.length = 0;

    expect(await invoke(['show', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/[Mm]ultiple agents named "reviewer"/);
    expect(report).toContain(repo);
    expect(report).toContain(home);
  });

  describe('Tier B section in show output', () => {
    const invokeWithTierB = (args: string[]): Promise<number> =>
      run(args, {
        registryPath,
        storePath,
        projectsRoot,
        scoreStorePath: join(dir, 'scores.json'),
        noteStorePath: join(dir, 'notes.json'),
        tierBStorePath: join(dir, 'tier-b.json'),
        out: (line) => out.push(line),
      });

    it('shows "insufficient history" when there are not enough prior runs', async () => {
      // Only one run (agent-1) and one incomplete (agent-2) — insufficient for Tier B reference.
      await invokeWithTierB(['source', 'register', repo]);
      out.length = 0;

      expect(await invokeWithTierB(['show', 'reviewer'])).toBe(0);
      const report = out.join('\n');
      expect(report).toMatch(/Tier B:.*insufficient history/);
    });

    it('shows applicable Tier B flags and contract status when there is sufficient history', async () => {
      // Add history runs with earlier timestamps so they count as strictly-prior.
      // We lower the min-runs threshold to 3 so only 3 prior runs are needed.
      const projectDir = join(projectsRoot, '-encoded');
      for (let i = 10; i < 13; i++) {
        writeFileSync(
          join(projectDir, `session${i}.jsonl`),
          JSON.stringify({
            type: 'user',
            cwd: repo,
            sessionId: `session${i}`,
            timestamp: `2026-06-16T0${i - 10}:00:00.000Z`,
            toolUseResult: {
              status: 'completed',
              agentId: `agent-${i}`,
              agentType: 'reviewer',
              totalDurationMs: 1000,
              totalTokens: 500,
              totalToolUseCount: 3,
              toolStats: { readCount: 2 },
            },
          }),
          'utf8',
        );
      }

      await invokeWithTierB(['source', 'register', repo]);
      out.length = 0;

      const originalMinRuns = process.env['HANDLER_TIERB_MIN_RUNS'];
      process.env['HANDLER_TIERB_MIN_RUNS'] = '3';
      try {
        expect(await invokeWithTierB(['show', 'reviewer'])).toBe(0);
      } finally {
        if (originalMinRuns === undefined) {
          delete process.env['HANDLER_TIERB_MIN_RUNS'];
        } else {
          process.env['HANDLER_TIERB_MIN_RUNS'] = originalMinRuns;
        }
      }

      const report = out.join('\n');
      // The run on 2026-06-17 (agent-1) has 3 prior runs from 2026-06-16 — should be applicable.
      expect(report).toMatch(/Tier B:.*tokens/);
      expect(report).toMatch(/Tier B:.*duration/);
      expect(report).toMatch(/Tier B:.*contract/);
    });

    it('shows n/a for contract when contract is not-applicable', async () => {
      // Add history runs with earlier timestamps so they count as strictly-prior.
      const projectDir = join(projectsRoot, '-encoded');
      for (let i = 20; i < 22; i++) {
        writeFileSync(
          join(projectDir, `session${i}.jsonl`),
          JSON.stringify({
            type: 'user',
            cwd: repo,
            sessionId: `session${i}`,
            timestamp: `2026-06-15T0${i - 20}:00:00.000Z`,
            toolUseResult: {
              status: 'completed',
              agentId: `agent-${i}`,
              agentType: 'reviewer',
              totalDurationMs: 1000,
              totalTokens: 500,
              totalToolUseCount: 3,
              toolStats: { readCount: 2 },
            },
          }),
          'utf8',
        );
      }

      await invokeWithTierB(['source', 'register', repo]);
      out.length = 0;

      const originalMinRuns = process.env['HANDLER_TIERB_MIN_RUNS'];
      process.env['HANDLER_TIERB_MIN_RUNS'] = '2';
      try {
        expect(await invokeWithTierB(['show', 'reviewer'])).toBe(0);
      } finally {
        if (originalMinRuns === undefined) {
          delete process.env['HANDLER_TIERB_MIN_RUNS'];
        } else {
          process.env['HANDLER_TIERB_MIN_RUNS'] = originalMinRuns;
        }
      }

      const report = out.join('\n');
      // contract n/a because agent definition has no structured output declaration
      expect(report).toMatch(/contract n\/a|contract.*n\/a/);
    });

    it('shows Tier A score line unchanged alongside the Tier B section', async () => {
      await invokeWithTierB(['source', 'register', repo]);
      out.length = 0;

      expect(await invokeWithTierB(['show', 'reviewer'])).toBe(0);
      const report = out.join('\n');
      // Tier A score line is present
      expect(report).toMatch(/score:/);
      expect(report).toMatch(/\b(PASS|WARN|FAIL)\b/);
      // Tier B section is also present
      expect(report).toMatch(/Tier B:/);
    });
  });
});
