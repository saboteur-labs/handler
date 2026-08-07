/**
 * handler CLI (thin client over `src/core`).
 *
 * `run` builds and executes the Commander program and returns a process exit
 * code. The error boundary lives here: core throws or returns, and this layer
 * turns a thrown error into a concise stderr message and a non-zero exit —
 * core never calls `process.exit`.
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import chalk from 'chalk';
import { Command, CommanderError } from 'commander';

import type { JudgeClient } from '../core/index';
import { VERSION } from '../core/index';
import { registerAnchorCommand } from './commands/anchor';
import { registerAssessCommand } from './commands/assess';
import { registerConventionsCommand } from './commands/conventions';
import { registerGuiCommand } from './commands/gui';
import { registerDiffCommand } from './commands/diff';
import { registerHookCommand } from './commands/hook';
import { registerInsightsCommand } from './commands/insights';
import { registerJudgeCommand } from './commands/judge';
import { registerListCommand } from './commands/list';
import { registerNoteCommand } from './commands/note';
import { registerResetCommand } from './commands/reset';
import { registerShowCommand } from './commands/show';
import type { CliContext } from './commands/source';
import { registerSourceCommand } from './commands/source';
import { registerTranscriptCommand } from './commands/transcript';
import { registerTrendCommand } from './commands/trend';

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
  /** Tier B store location; defaults to the core default. */
  readonly tierBStorePath?: string;
  /** Anchor store location; defaults to the core default. */
  readonly anchorStorePath?: string;
  /** Tier C annotation store location; defaults to the core default. */
  readonly tierCStorePath?: string;
  /**
   * User-level check-suppression config path; defaults to `~/.handler/config.json`.
   * Each repo source's own `<root>/.handler/config.json` is resolved inside
   * core from the source root — the CLI passes no per-repo path.
   */
  readonly userConfigPath?: string;
  /**
   * Injectable LLM judge client for Tier C invocation. When undefined, the
   * command will construct a `DefaultJudgeClient` from the environment.
   */
  readonly judgeClient?: JudgeClient;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** Reads all of stdin to a string; defaults to draining `process.stdin`. */
  readonly readStdin?: () => Promise<string>;
  /** Opens `$EDITOR` on a file; defaults to spawning the user's editor. */
  readonly runEditor?: (filePath: string) => number;
  /** Confirms a destructive action; defaults to a y/N prompt on the terminal. */
  readonly confirm?: (question: string) => Promise<boolean>;
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

/**
 * Ask a y/N question on the terminal, defaulting to no. A non-TTY stdin is
 * answered "no" rather than prompting: a piped or scripted run has nobody to
 * answer, and silence must never destroy data — those callers pass `--yes`.
 */
async function confirm(question: string): Promise<boolean> {
  if (process.stdin.isTTY !== true) {
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
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
  // Run-scoped exit-code holder. A command signals "succeeded but non-zero"
  // (e.g. `assess`'s `--fail-on`) via `ctx.setExitCode`; `run()` returns this
  // and never touches the global `process.exitCode`, so the signal can't leak
  // across invocations or clobber a caller-set code.
  let exitCode = 0;
  const ctx: CliContext = {
    out,
    setExitCode: (code: number) => {
      exitCode = code;
    },
    registryPath: options.registryPath,
    projectsRoot: options.projectsRoot,
    storePath: options.storePath,
    scoreStorePath: options.scoreStorePath,
    conventionsPath: options.conventionsPath,
    noteStorePath: options.noteStorePath,
    tierBStorePath: options.tierBStorePath,
    anchorStorePath: options.anchorStorePath,
    tierCStorePath: options.tierCStorePath,
    userConfigPath: options.userConfigPath,
    judgeClient: options.judgeClient,
    readStdin: options.readStdin ?? readStdin,
    runEditor: options.runEditor ?? runEditor,
    confirm: options.confirm ?? confirm,
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
  registerDiffCommand(program, ctx);
  registerConventionsCommand(program, ctx);
  registerAssessCommand(program, ctx);
  registerNoteCommand(program, ctx);
  registerTranscriptCommand(program, ctx);
  registerTrendCommand(program, ctx);
  registerAnchorCommand(program, ctx);
  registerJudgeCommand(program, ctx);
  registerInsightsCommand(program, ctx);
  registerHookCommand(program, ctx);
  registerGuiCommand(program, ctx);
  registerResetCommand(program, ctx);

  try {
    await program.parseAsync([...argv], { from: 'user' });
    // A command action may have called `ctx.setExitCode` (e.g. `assess`'s
    // `--fail-on`) to signal a non-zero exit for a normally-completed run, as
    // distinct from the thrown-error path below. Every other command leaves it
    // at the initial `0`.
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already wrote any message via configureOutput above.
      return NORMAL_EXIT_CODES.has(error.code) || error.exitCode === 0 ? 0 : 1;
    }
    err(chalk.red(error instanceof Error ? error.message : String(error)));
    return 1;
  }
}
