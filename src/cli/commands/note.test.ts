import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: note commands (Req 20)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let projectsRoot: string;
  let notePath: string;
  let repo: string;
  let home: string;
  let out: string[];

  function completed(agentType: string, agentId: string, cwd: string): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      timestamp: '2026-06-17T10:00:00.000Z',
      toolUseResult: { status: 'completed', agentId, agentType, totalTokens: 1 },
    });
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-note-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    projectsRoot = join(dir, 'projects');
    notePath = join(dir, 'notes.json');
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
      completed('reviewer', 'agent-1', repo),
      'utf8',
    );

    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (
    args: string[],
    opts: { stdin?: string; runEditor?: (filePath: string) => number } = {},
  ): Promise<number> =>
    run(args, {
      registryPath,
      storePath,
      projectsRoot,
      noteStorePath: notePath,
      readStdin: () => Promise.resolve(opts.stdin ?? ''),
      runEditor: opts.runEditor,
      out: (line) => out.push(line),
    });

  it('reports no note before one is set', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['note', 'show', 'reviewer'])).toBe(0);
    expect(out.join('\n')).toMatch(/no note/i);
  });

  it('sets a note via --body and reads it back', async () => {
    await invoke(['source', 'register', repo]);
    expect(await invoke(['note', 'set', 'reviewer', '--body', 'widen the tool scope'])).toBe(0);
    out.length = 0;
    expect(await invoke(['note', 'show', 'reviewer'])).toBe(0);
    expect(out.join('\n')).toContain('widen the tool scope');
  });

  it('reads the note body from stdin when --body is omitted', async () => {
    await invoke(['source', 'register', repo]);
    expect(await invoke(['note', 'set', 'reviewer'], { stdin: 'from stdin' })).toBe(0);
    out.length = 0;
    await invoke(['note', 'show', 'reviewer']);
    expect(out.join('\n')).toContain('from stdin');
  });

  it('overwrites a prior note on re-set', async () => {
    await invoke(['source', 'register', repo]);
    await invoke(['note', 'set', 'reviewer', '--body', 'first']);
    await invoke(['note', 'set', 'reviewer', '--body', 'second']);
    out.length = 0;
    await invoke(['note', 'show', 'reviewer']);
    const report = out.join('\n');
    expect(report).toContain('second');
    expect(report).not.toContain('first');
  });

  it('saves the edited contents when the editor exits cleanly', async () => {
    await invoke(['source', 'register', repo]);
    const editor = (filePath: string): number => {
      writeFileSync(filePath, 'edited in $EDITOR\n', 'utf8');
      return 0;
    };
    expect(await invoke(['note', 'edit', 'reviewer'], { runEditor: editor })).toBe(0);
    out.length = 0;
    await invoke(['note', 'show', 'reviewer']);
    expect(out.join('\n')).toContain('edited in $EDITOR');
  });

  it('pre-loads the current note into the editor', async () => {
    await invoke(['source', 'register', repo]);
    await invoke(['note', 'set', 'reviewer', '--body', 'preexisting']);
    let seen = '';
    const editor = (filePath: string): number => {
      seen = readFileSync(filePath, 'utf8');
      return 0;
    };
    await invoke(['note', 'edit', 'reviewer'], { runEditor: editor });
    expect(seen).toContain('preexisting');
  });

  it('leaves the prior note intact when the editor exits non-zero', async () => {
    await invoke(['source', 'register', repo]);
    await invoke(['note', 'set', 'reviewer', '--body', 'keep me']);
    const before = readFileSync(notePath, 'utf8');
    const abort = (filePath: string): number => {
      writeFileSync(filePath, 'discard this', 'utf8');
      return 1;
    };
    await invoke(['note', 'edit', 'reviewer'], { runEditor: abort });
    expect(readFileSync(notePath, 'utf8')).toBe(before);
    out.length = 0;
    await invoke(['note', 'show', 'reviewer']);
    expect(out.join('\n')).toContain('keep me');
  });

  it('does not rewrite the note when the content is unchanged', async () => {
    await invoke(['source', 'register', repo]);
    await invoke(['note', 'set', 'reviewer', '--body', 'stable']);
    const before = readFileSync(notePath, 'utf8');
    // Editor exits cleanly but the user changed nothing (a trailing newline added
    // by the editor must not count as a change).
    const noop = (filePath: string): number => {
      writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}\n`, 'utf8');
      return 0;
    };
    await invoke(['note', 'edit', 'reviewer'], { runEditor: noop });
    expect(readFileSync(notePath, 'utf8')).toBe(before);
  });

  it('edits from an empty starting note', async () => {
    await invoke(['source', 'register', repo]);
    const editor = (filePath: string): number => {
      expect(readFileSync(filePath, 'utf8')).toBe('');
      writeFileSync(filePath, 'first note', 'utf8');
      return 0;
    };
    expect(await invoke(['note', 'edit', 'reviewer'], { runEditor: editor })).toBe(0);
    out.length = 0;
    await invoke(['note', 'show', 'reviewer']);
    expect(out.join('\n')).toContain('first note');
  });

  it('reports unknown agents non-zero', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;
    expect(await invoke(['note', 'show', 'ghost'])).toBe(1);
    expect(out.join('\n')).toMatch(/ghost/);
  });

  it('reports ambiguous agents without writing, exiting non-zero', async () => {
    const projectDir = join(projectsRoot, '-encoded-2');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 's.jsonl'), completed('reviewer', 'agent-2', home), 'utf8');

    await invoke(['source', 'register', repo]);
    await invoke(['source', 'register', '--user', home]);
    out.length = 0;

    expect(await invoke(['note', 'set', 'reviewer', '--body', 'x'])).toBe(1);
    const report = out.join('\n');
    expect(report).toMatch(/[Mm]ultiple agents named "reviewer"/);
    expect(report).toContain(repo);
    expect(report).toContain(home);
  });
});
