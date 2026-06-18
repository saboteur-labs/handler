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
});
