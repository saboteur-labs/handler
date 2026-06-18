import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: source commands (Req 5)', () => {
  let dir: string;
  let registryPath: string;
  let repo: string;
  let home: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-')));
    registryPath = join(dir, 'sources.json');
    repo = join(dir, 'repo');
    home = join(dir, 'home');
    mkdirSync(repo);
    mkdirSync(home);
    out = [];
    err = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, {
      registryPath,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });

  it('reports when no sources are registered', async () => {
    expect(await invoke(['source', 'list'])).toBe(0);
    expect(out.join('\n')).toMatch(/No agent sources registered/);
  });

  it('registers a repo source and lists it', async () => {
    expect(await invoke(['source', 'register', repo])).toBe(0);
    expect(out.join('\n')).toMatch(/Registered/);

    out.length = 0;
    expect(await invoke(['source', 'list'])).toBe(0);
    const listing = out.join('\n');
    expect(listing).toContain('repo');
    expect(listing).toContain(repo);
  });

  it('persists a registration across CLI invocations', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;
    await invoke(['source', 'list']);
    expect(out.join('\n')).toContain(repo);
  });

  it('registers the user-level source with --user', async () => {
    expect(await invoke(['source', 'register', '--user', home])).toBe(0);
    out.length = 0;
    await invoke(['source', 'list']);
    const listing = out.join('\n');
    expect(listing).toContain('user');
    expect(listing).toContain(home);
  });

  it('exits non-zero with a message for a non-existent path', async () => {
    expect(await invoke(['source', 'register', join(dir, 'nope')])).toBe(1);
    expect(err.join('\n')).toMatch(/Not a directory/);
  });

  it('exits non-zero when neither a path nor --user is given', async () => {
    expect(await invoke(['source', 'register'])).toBe(1);
    expect(err.join('\n')).toMatch(/Provide a repo path/);
  });
});
