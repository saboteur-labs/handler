/**
 * Tests for `handler import-runlog` (subagent-run-capture FR-25, FR-31, FR-32).
 * Temp home, registry, store, and runlogs root only; never the real `~/.claude`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyCaptureFixtures } from '../../core/__fixtures__/capture/fixtures';
import { RunStore } from '../../core/store/run-store';
import { run } from '../index';

describe('handler CLI: import-runlog', () => {
  let dir: string;
  let home: string;
  let registryPath: string;
  let storePath: string;
  let runlogsRoot: string;
  let out: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-import-runlog-cli-'));
    home = join(dir, 'home');
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    const agents = join(home, '.claude', 'agents');
    mkdirSync(agents, { recursive: true });
    for (const name of ['code-reviewer', 'test-writer']) {
      writeFileSync(join(agents, `${name}.md`), `---\nname: ${name}\n---\nbody ${name}\n`);
    }
    runlogsRoot = copyCaptureFixtures(join(dir, 'fx')).runlogsRoot;
    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, { registryPath, storePath, out: (line) => out.push(line) });

  const registerUser = async (): Promise<void> => {
    await invoke(['source', 'register', '--user', home]);
    out.length = 0;
  };

  it('imports from --root and prints imported, skipped-empty, and skipped-malformed counts', async () => {
    await registerUser();

    expect(await invoke(['import-runlog', '--root', runlogsRoot])).toBe(0);

    const text = out.join('\n');
    expect(text).toMatch(/imported\D+3/i);
    expect(text).toMatch(/empty[^\n]*\D1\b/i);
    expect(text).toMatch(/malformed[^\n]*\D1\b/i);
    expect(new RunStore(storePath).list()).toHaveLength(3);
  });

  it('exits 0 and imports nothing when the root has no runlogs', async () => {
    await registerUser();
    const empty = join(dir, 'empty-runlogs');
    mkdirSync(empty);

    expect(await invoke(['import-runlog', '--root', empty])).toBe(0);
    expect(out.join('\n')).toMatch(/imported\D+0/i);
  });

  it('states the cache limitation in --help', async () => {
    expect(await invoke(['import-runlog', '--help'])).toBe(0);

    const help = out.join('\n').replace(/\s+/g, ' ');
    expect(help).toContain('--root <dir>');
    expect(help).toMatch(/regenerable cache/i);
    expect(help).toMatch(/version bump/i);
    expect(help).toContain('reset');
    expect(help).toMatch(/derived/);
    expect(help).toMatch(/re-running import-runlog/i);
  });
});
