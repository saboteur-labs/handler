import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: reset', () => {
  let dir: string;
  let runsPath: string;
  let scorePath: string;
  let tierBPath: string;
  let tierCPath: string;
  let notePath: string;
  let registryPath: string;
  let anchorPath: string;
  let conventionsPath: string;
  let userConfigPath: string;
  let out: string[];
  let asked: string[];

  const all = (): string[] => [
    runsPath,
    scorePath,
    tierBPath,
    tierCPath,
    notePath,
    registryPath,
    anchorPath,
    conventionsPath,
    userConfigPath,
  ];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-reset-cli-'));
    runsPath = join(dir, 'runs.json');
    scorePath = join(dir, 'scores.json');
    tierBPath = join(dir, 'tier-b.json');
    tierCPath = join(dir, 'tier-c.json');
    notePath = join(dir, 'notes.json');
    registryPath = join(dir, 'sources.json');
    anchorPath = join(dir, 'anchors.json');
    conventionsPath = join(dir, 'conventions.json');
    userConfigPath = join(dir, 'config.json');
    for (const path of all()) {
      writeFileSync(path, '{}\n', 'utf8');
    }
    out = [];
    asked = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[], answer = true): Promise<number> =>
    run(['reset', ...args], {
      storePath: runsPath,
      scoreStorePath: scorePath,
      tierBStorePath: tierBPath,
      tierCStorePath: tierCPath,
      noteStorePath: notePath,
      registryPath,
      anchorStorePath: anchorPath,
      conventionsPath,
      userConfigPath,
      confirm: (question: string) => {
        asked.push(question);
        return Promise.resolve(answer);
      },
      out: (line) => out.push(line),
    });

  it('clears the derived stores by default, keeping authored state', async () => {
    const code = await invoke(['--yes']);

    expect(code).toBe(0);
    expect(existsSync(runsPath)).toBe(false);
    expect(existsSync(scorePath)).toBe(false);
    expect(existsSync(tierBPath)).toBe(false);
    expect(existsSync(notePath)).toBe(true);
    expect(existsSync(registryPath)).toBe(true);
    expect(existsSync(tierCPath)).toBe(true);
  });

  it('--scores keeps attributed run history', async () => {
    await invoke(['--scores', '--yes']);

    expect(existsSync(scorePath)).toBe(false);
    expect(existsSync(tierBPath)).toBe(false);
    expect(existsSync(runsPath)).toBe(true);
  });

  it('--all clears every store', async () => {
    await invoke(['--all', '--yes']);

    for (const path of all()) {
      expect(existsSync(path)).toBe(false);
    }
  });

  it('rejects mutually exclusive scope flags without deleting anything', async () => {
    const code = await invoke(['--scores', '--all', '--yes']);

    expect(code).toBe(1);
    expect(existsSync(scorePath)).toBe(true);
  });

  it('prompts before deleting and honours a refusal', async () => {
    const code = await invoke([], false);

    expect(code).toBe(0);
    expect(asked).toHaveLength(1);
    expect(existsSync(runsPath)).toBe(true);
    expect(out.join('\n')).toMatch(/nothing was deleted/i);
  });

  it('deletes when the prompt is accepted', async () => {
    await invoke([], true);

    expect(asked).toHaveLength(1);
    expect(existsSync(runsPath)).toBe(false);
  });

  it('skips the prompt with --yes', async () => {
    await invoke(['--yes']);

    expect(asked).toEqual([]);
  });

  it('lists each targeted file with what is lost before prompting', async () => {
    await invoke(['--all'], false);

    const text = out.join('\n');
    expect(text).toContain('notes.json');
    expect(text).toContain('per-agent notes');
    expect(text).toContain('runs.json');
  });

  it('warns that authored state is at stake only when the scope includes it', async () => {
    await invoke(['--all'], false);
    const wide = out.join('\n');
    out = [];
    await invoke([], false);
    const narrow = out.join('\n');

    expect(wide).toMatch(/cannot be regenerated/i);
    expect(narrow).not.toMatch(/cannot be regenerated/i);
  });

  it('--dry-run reports the plan and deletes nothing, without prompting', async () => {
    const code = await invoke(['--all', '--dry-run']);

    expect(code).toBe(0);
    expect(asked).toEqual([]);
    expect(out.join('\n')).toMatch(/dry run/i);
    for (const path of all()) {
      expect(existsSync(path)).toBe(true);
    }
  });

  it('--backup copies the files aside before deleting them', async () => {
    const backupDir = join(dir, 'backup');
    await invoke(['--all', '--yes', '--backup', backupDir]);

    expect(existsSync(join(backupDir, 'notes.json'))).toBe(true);
    expect(existsSync(notePath)).toBe(false);
    expect(out.join('\n')).toContain(backupDir);
  });

  it('reports there is nothing to clear when every target is absent', async () => {
    for (const path of all()) {
      rmSync(path);
    }

    const code = await invoke([]);

    expect(code).toBe(0);
    expect(asked).toEqual([]);
    expect(out.join('\n')).toMatch(/nothing to clear/i);
  });

  it('tells the user what happens next after a derived reset', async () => {
    await invoke(['--yes']);

    expect(out.join('\n')).toMatch(/handler list/);
  });
});
