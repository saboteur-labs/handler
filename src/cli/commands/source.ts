/**
 * `handler source` commands (spec Req 5).
 *
 * Thin Commander wrappers over the core `SourceRegistry`. This layer parses
 * arguments, validates user input, and formats output; all behavior lives in
 * core so a future GUI can reuse it.
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

import chalk from 'chalk';
import type { Command } from 'commander';

import type { AgentSource } from '../../core/index';
import { repoSource, SourceRegistry, userSource } from '../../core/index';

export interface CliContext {
  readonly out: (line: string) => void;
  /** Registry file location; defaults to the core default when undefined. */
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
  /** Reads all of stdin to a string; used when a note body is piped in. */
  readonly readStdin: () => Promise<string>;
  /** Opens `$EDITOR` on `filePath`, returning its exit code (`note edit`). */
  readonly runEditor: (filePath: string) => number;
}

interface RegisterOptions {
  readonly user?: boolean;
}

export function registerSourceCommand(program: Command, ctx: CliContext): void {
  const source = program.command('source').description('Manage agent sources');

  source
    .command('register [path]')
    .description('Register an agent source: a repo root, or --user for the user-level source')
    .option('-u, --user', 'register the user-level source (~/.claude/agents)')
    .action((path: string | undefined, options: RegisterOptions) => {
      const registry = new SourceRegistry(ctx.registryPath);
      const built = buildSource(path, options.user ?? false);
      registry.register(built);
      ctx.out(chalk.green(`Registered ${built.type} source: ${built.root}`));
    });

  source
    .command('list')
    .description('List registered agent sources')
    .action(() => {
      const registry = new SourceRegistry(ctx.registryPath);
      const sources = registry.list();
      if (sources.length === 0) {
        ctx.out('No agent sources registered.');
        return;
      }
      for (const src of sources) {
        ctx.out(`${src.type.padEnd(4)}  ${src.root}`);
      }
    });
}

function buildSource(path: string | undefined, user: boolean): AgentSource {
  if (user) {
    const home = path ?? homedir();
    assertDirectory(home);
    return userSource(home);
  }
  if (path === undefined) {
    throw new Error('Provide a repo path, or use --user to register the user-level source.');
  }
  assertDirectory(path);
  return repoSource(path);
}

function assertDirectory(path: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Not a directory: ${path}`);
  }
}
