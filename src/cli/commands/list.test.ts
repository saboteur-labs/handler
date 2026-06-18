import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: list command (Req 10)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let projectsRoot: string;
  let repo: string;
  let out: string[];

  function taskEntry(agentType: string, agentId: string, cwd: string): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      timestamp: '2026-06-17T10:00:00.000Z',
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

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    projectsRoot = join(dir, 'projects');
    repo = join(dir, 'repo');

    const agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'reviewer.md'), 'definition body', 'utf8');

    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [taskEntry('reviewer', 'agent-1', repo), taskEntry('Explore', 'agent-2', repo)].join('\n'),
      'utf8',
    );

    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, { registryPath, storePath, projectsRoot, out: (line) => out.push(line) });

  it('reports when there are no agent runs', async () => {
    expect(await invoke(['list'])).toBe(0);
    expect(out.join('\n')).toMatch(/No agent runs found/);
  });

  it('lists user-authored agents with run counts and excludes built-ins', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['list'])).toBe(0);
    const listing = out.join('\n');
    expect(listing).toContain('reviewer');
    expect(listing).toContain('1 run');
    expect(listing).not.toContain('Explore');
  });
});
