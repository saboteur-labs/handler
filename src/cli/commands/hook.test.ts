/**
 * Tests for `handler hook enable` and `handler hook disable` commands (V1 Feature 5, Task 5).
 *
 * Both commands hold no business logic — they only format and print static
 * text. Neither reads from nor writes to any store.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: hook commands (V1 Feature 5 Req 8)', () => {
  function invoke(args: string[]): Promise<{ code: number; output: string }> {
    const lines: string[] = [];
    return run(args, {
      out: (line) => lines.push(line),
    }).then((code) => ({ code, output: lines.join('\n') }));
  }

  describe('hook enable', () => {
    it('exits with code 0', async () => {
      const { code } = await invoke(['hook', 'enable']);
      expect(code).toBe(0);
    });

    it('prints SubagentStop in the output', async () => {
      const { output } = await invoke(['hook', 'enable']);
      expect(output).toContain('SubagentStop');
    });

    it('prints handler-hook in the output', async () => {
      const { output } = await invoke(['hook', 'enable']);
      expect(output).toContain('handler-hook');
    });

    it('includes copy-paste instruction in the output', async () => {
      const { output } = await invoke(['hook', 'enable']);
      // Should instruct the developer to add this to their Claude Code hooks config
      expect(output.toLowerCase()).toMatch(/add|copy|paste|settings\.json/);
    });

    it('does not throw', async () => {
      await expect(invoke(['hook', 'enable'])).resolves.toBeDefined();
    });
  });

  describe('hook disable', () => {
    it('exits with code 0', async () => {
      const { code } = await invoke(['hook', 'disable']);
      expect(code).toBe(0);
    });

    it('prints removal instructions in the output', async () => {
      const { output } = await invoke(['hook', 'disable']);
      // Should instruct the developer how to remove/disable the hook
      expect(output.toLowerCase()).toMatch(/remove|delete|disable/);
    });

    it('references SubagentStop in the removal instructions', async () => {
      const { output } = await invoke(['hook', 'disable']);
      expect(output).toContain('SubagentStop');
    });

    it('references handler-hook in the removal instructions', async () => {
      const { output } = await invoke(['hook', 'disable']);
      expect(output).toContain('handler-hook');
    });

    it('does not throw', async () => {
      await expect(invoke(['hook', 'disable'])).resolves.toBeDefined();
    });
  });

  describe('print-only (FR-21): never installs the hook', () => {
    const cliDir = join(import.meta.dirname ?? __dirname, '..');

    it('hook enable/disable write no settings.json under a temp HOME or cwd', async () => {
      const home = mkdtempSync(join(tmpdir(), 'handler-hook-home-'));
      const prevHome = process.env.HOME;
      const prevCwd = process.cwd();
      try {
        process.env.HOME = home;
        process.chdir(home);
        await invoke(['hook', 'enable']);
        await invoke(['hook', 'disable']);
        expect(readdirSync(home, { recursive: true })).toEqual([]);
        expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false);
      } finally {
        process.chdir(prevCwd);
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
        rmSync(home, { recursive: true, force: true });
      }
    });

    it.each(['commands/hook.ts', 'hook-handler.ts'])(
      '%s has no filesystem-write path to a settings file',
      (file) => {
        const src = readFileSync(join(cliDir, file), 'utf8');
        expect(src).not.toMatch(/writeFile|appendFile|copyFile|rename\(|mkdir|createWriteStream/);
        expect(src).not.toMatch(/node:fs/);
      },
    );
  });
});
