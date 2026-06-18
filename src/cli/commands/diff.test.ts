import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: diff command (Req 6)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let projectsRoot: string;
  let repo: string;
  let out: string[];

  function completed(agentId: string): string {
    return JSON.stringify({
      type: 'user',
      cwd: repo,
      sessionId: 'session',
      timestamp: '2026-06-17T10:00:00.000Z',
      toolUseResult: {
        status: 'completed',
        agentId,
        agentType: 'reviewer',
        totalDurationMs: 1000,
        totalTokens: 500,
        totalToolUseCount: 3,
        toolStats: { readCount: 2 },
      },
    });
  }

  function writeTranscript(...agentIds: string[]): void {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'session.jsonl'), agentIds.map(completed).join('\n'), 'utf8');
  }

  function writeSidechain(agentId: string): void {
    const subDir = join(projectsRoot, '-encoded', 'session', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, `agent-${agentId}.jsonl`),
      JSON.stringify({
        type: 'user',
        cwd: repo,
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] },
      }),
      'utf8',
    );
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

    writeTranscript('agent-1');
    writeSidechain('agent-1');
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
    expect(await invoke(['diff', 'ghost'])).toBe(0);
    expect(out.join('\n')).toMatch(/No runs found for agent "ghost"/);
  });

  it('reports no definition changes for a single-version agent', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['diff', 'reviewer'])).toBe(0);
    expect(out.join('\n')).toMatch(/no definition changes/i);
  });

  it('lists a definition change with before/after aggregates and the delta', async () => {
    await invoke(['source', 'register', repo]);
    await invoke(['diff', 'reviewer']); // ingest agent-1 under the original definition

    writeFileSync(join(repo, '.claude', 'agents', 'reviewer.md'), 'revised body', 'utf8');
    writeTranscript('agent-1', 'agent-9');
    writeSidechain('agent-9');

    out.length = 0;
    expect(await invoke(['diff', 'reviewer'])).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/definition change 1/);
    expect(report).toMatch(/before:/);
    expect(report).toMatch(/after:/);
    expect(report).toMatch(/delta:/);
    expect(report).toMatch(/composite/);
    expect(report).toMatch(/low confidence/); // one run per side
  });
});
