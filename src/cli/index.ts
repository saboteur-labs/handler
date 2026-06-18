/**
 * handler CLI (thin client over `src/core`).
 *
 * `run` builds and executes the Commander program and returns a process exit
 * code. The error boundary lives here: core throws or returns, and this layer
 * turns a thrown error into a concise stderr message and a non-zero exit —
 * core never calls `process.exit`.
 */
import chalk from 'chalk';
import { Command, CommanderError } from 'commander';

import { VERSION } from '../core/index';
import type { CliContext } from './commands/source';
import { registerSourceCommand } from './commands/source';

export interface RunOptions {
  readonly registryPath?: string;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
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
  const ctx: CliContext = { out, registryPath: options.registryPath };

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
