/**
 * handler CLI (thin client over `src/core`).
 *
 * `run` builds and executes the Commander program and returns a process exit
 * code. The error boundary lives here: core throws or returns, and this layer
 * turns a thrown error into a concise stderr message and a non-zero exit —
 * core never calls `process.exit`.
 */
import { spawnSync } from 'node:child_process';

import chalk from 'chalk';
import { Command, CommanderError } from 'commander';

import { VERSION } from '../core/index';
import { registerConventionsCommand } from './commands/conventions';
import { registerListCommand } from './commands/list';
import { registerNoteCommand } from './commands/note';
import { registerShowCommand } from './commands/show';
import type { CliContext } from './commands/source';
import { registerSourceCommand } from './commands/source';

export interface RunOptions {
  readonly registryPath?: string;
  /** Transcripts root for ingestion; defaults to the core default. */
  readonly projectsRoot?: string;
  /** Run-store location; defaults to the core default. */
  readonly storePath?: string;
  /** Score-store location; defaults to the core default. */
  readonly scoreStorePath?: string;
  /** Conventions-artifact location; defaults to the core default. */
  readonly conventionsPath?: string;
  /** Note-store location; defaults to the core default. */
  readonly noteStorePath?: string;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** Reads all of stdin to a string; defaults to draining `process.stdin`. */
  readonly readStdin?: () => Promise<string>;
  /** Opens `$EDITOR` on a file; defaults to spawning the user's editor. */
  readonly runEditor?: (filePath: string) => number;
}

/** Drain `process.stdin` to a string, for piping a note body in (`note set`). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Open the user's editor on `filePath` and return its exit code. Goes through a
 * shell so `EDITOR`/`VISUAL` values carrying args (e.g. `code --wait`) work;
 * the path is quoted for spaces. Falls back to `vi`.
 */
function runEditor(filePath: string): number {
  const editor = process.env.VISUAL ?? process.env.EDITOR ?? 'vi';
  const result = spawnSync(`${editor} "${filePath}"`, { stdio: 'inherit', shell: true });
  return result.status ?? 1;
}

/** Commander error codes that are normal terminations (help / version output). */
const NORMAL_EXIT_CODES = new Set([
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
]);

export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const ctx: CliContext = {
    out,
    registryPath: options.registryPath,
    projectsRoot: options.projectsRoot,
    storePath: options.storePath,
    scoreStorePath: options.scoreStorePath,
    conventionsPath: options.conventionsPath,
    noteStorePath: options.noteStorePath,
    readStdin: options.readStdin ?? readStdin,
    runEditor: options.runEditor ?? runEditor,
  };

  const program = new Command();
  program
    .name('handler')
    .description('Observability and evaluation for the Claude Code subagents you author')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (str) => out(str.replace(/\n$/, '')),
      writeErr: (str) => err(str.replace(/\n$/, '')),
    });

  registerSourceCommand(program, ctx);
  registerListCommand(program, ctx);
  registerShowCommand(program, ctx);
  registerConventionsCommand(program, ctx);
  registerNoteCommand(program, ctx);

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already wrote any message via configureOutput above.
      return NORMAL_EXIT_CODES.has(error.code) || error.exitCode === 0 ? 0 : 1;
    }
    err(chalk.red(error instanceof Error ? error.message : String(error)));
    return 1;
  }
}
