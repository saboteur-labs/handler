/**
 * Tests for `handler gui` command (V1 Feature 6, Task 9).
 *
 * The gui command starts the HTTP server, prints the URL, and blocks until
 * SIGINT/SIGTERM. Tests cover: command registration, the missing-assets error
 * path, and the --port option.
 *
 * Because the command calls `process.exit()` and blocks on signals, these
 * tests mock the relevant dependencies.
 */
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Must be declared before any imports of the modules being mocked.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

vi.mock('../../core/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/index')>();
  return {
    ...actual,
    startGuiServer: vi.fn(),
  };
});

import { existsSync } from 'node:fs';
import { startGuiServer } from '../../core/index';

import type { CliContext } from './source';
import { registerGuiCommand } from './gui';

const mockExistsSync = vi.mocked(existsSync);
const mockStartGuiServer = vi.mocked(startGuiServer);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(lines: string[] = []): CliContext {
  return {
    out: (line) => lines.push(line),
    readStdin: async () => '',
    runEditor: () => 0,
  };
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent Commander from calling process.exit
  return program;
}

function makeFakeHandle(url = 'http://127.0.0.1:4242') {
  return {
    url,
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handler gui command (V1 Feature 6, Task 9)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    // Default: signals immediately resolve (SIGINT handler called right away)
    vi.spyOn(process, 'once').mockImplementation((event, handler) => {
      if (event === 'SIGINT') {
        (handler as () => void)();
      }
      return process;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockExistsSync.mockReset();
    mockStartGuiServer.mockReset();
  });

  describe('command registration', () => {
    it('registers the gui command on the program', () => {
      const program = makeProgram();
      registerGuiCommand(program, makeCtx());

      const names = program.commands.map((c) => c.name());
      expect(names).toContain('gui');
    });

    it('registers the --port option', () => {
      const program = makeProgram();
      registerGuiCommand(program, makeCtx());

      const guiCmd = program.commands.find((c) => c.name() === 'gui');
      expect(guiCmd).toBeDefined();
      const optionNames = guiCmd!.options.map((o) => o.long);
      expect(optionNames).toContain('--port');
    });

    it('defaults port to 4242', () => {
      const program = makeProgram();
      registerGuiCommand(program, makeCtx());

      const guiCmd = program.commands.find((c) => c.name() === 'gui');
      expect(guiCmd).toBeDefined();
      const portOpt = guiCmd!.options.find((o) => o.long === '--port');
      expect(portOpt?.defaultValue).toBe('4242');
    });
  });

  describe('missing assets path', () => {
    it('prints an error message when the assets directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const lines: string[] = [];
      const program = makeProgram();
      registerGuiCommand(program, makeCtx(lines));

      await program.parseAsync(['gui'], { from: 'user' });

      expect(lines.join('\n')).toContain('GUI assets not built');
      expect(lines.join('\n')).toContain('npm run build:gui');
    });

    it('exits with code 1 when the assets directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const program = makeProgram();
      registerGuiCommand(program, makeCtx());

      await program.parseAsync(['gui'], { from: 'user' });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not call startGuiServer when assets are missing', async () => {
      mockExistsSync.mockReturnValue(false);

      const program = makeProgram();
      registerGuiCommand(program, makeCtx());

      await program.parseAsync(['gui'], { from: 'user' });

      expect(mockStartGuiServer).not.toHaveBeenCalled();
    });
  });

  describe('happy path (mocked server)', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it('calls startGuiServer with the default port 4242', async () => {
      const handle = makeFakeHandle();
      mockStartGuiServer.mockResolvedValue(handle);

      const program = makeProgram();
      registerGuiCommand(program, makeCtx());
      await program.parseAsync(['gui'], { from: 'user' });

      expect(mockStartGuiServer).toHaveBeenCalledWith(
        4242,
        expect.stringContaining('gui'),
        expect.anything(),
      );
    });

    it('prints the server URL in the expected format', async () => {
      const handle = makeFakeHandle('http://127.0.0.1:4242');
      mockStartGuiServer.mockResolvedValue(handle);

      const lines: string[] = [];
      const program = makeProgram();
      registerGuiCommand(program, makeCtx(lines));
      await program.parseAsync(['gui'], { from: 'user' });

      expect(lines.join('\n')).toContain('handler GUI: http://127.0.0.1:4242');
    });

    it('passes the --port override to startGuiServer', async () => {
      const handle = makeFakeHandle('http://127.0.0.1:9000');
      mockStartGuiServer.mockResolvedValue(handle);

      const program = makeProgram();
      registerGuiCommand(program, makeCtx());
      await program.parseAsync(['gui', '--port', '9000'], { from: 'user' });

      expect(mockStartGuiServer).toHaveBeenCalledWith(9000, expect.anything(), expect.anything());
    });

    it('closes the server after the signal resolves', async () => {
      const handle = makeFakeHandle();
      mockStartGuiServer.mockResolvedValue(handle);

      const program = makeProgram();
      registerGuiCommand(program, makeCtx());
      await program.parseAsync(['gui'], { from: 'user' });

      expect(handle.close).toHaveBeenCalled();
    });

    it('exits with code 0 after clean shutdown', async () => {
      const handle = makeFakeHandle();
      mockStartGuiServer.mockResolvedValue(handle);

      const program = makeProgram();
      registerGuiCommand(program, makeCtx());
      await program.parseAsync(['gui'], { from: 'user' });

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('resolves assetsDir ending with "gui"', async () => {
      const handle = makeFakeHandle();
      mockStartGuiServer.mockResolvedValue(handle);

      const program = makeProgram();
      registerGuiCommand(program, makeCtx());
      await program.parseAsync(['gui'], { from: 'user' });

      const [, assetsDir] = mockStartGuiServer.mock.calls[0]!;
      expect(assetsDir).toMatch(/gui$/);
    });
  });
});
