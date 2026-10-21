/**
 * `handler import-runlog` — import runs from Claude Code's runlogs
 * (subagent-run-capture FR-25, FR-31, FR-32).
 *
 * Thin wrapper over core's `importRunlog`: parses `--root`, then formats the
 * returned counts. Malformed lines are counted by core, never fatal, so this
 * command exits 0 whenever core returns.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import { importRunlog, SourceRegistry } from '../../core/index';
import type { CliContext } from './source';

interface ImportRunlogOptions {
  readonly root?: string;
}

const HELP_NOTE = `
The run store is a regenerable cache. A later handler version bump, or
\`handler reset\` at the default \`derived\` scope, drops runlog-imported runs;
they return only by re-running import-runlog while the runlogs still exist.`;

export function registerImportRunlogCommand(program: Command, ctx: CliContext): void {
  program
    .command('import-runlog')
    .description('Import subagent runs from Claude Code runlogs into the run store')
    .option('--root <dir>', 'runlogs directory to read (default: ~/.claude/runlogs)')
    .addHelpText('after', HELP_NOTE)
    .action((options: ImportRunlogOptions) => {
      const registry = new SourceRegistry(ctx.registryPath);
      const result = importRunlog({
        sources: registry.list(),
        storePath: ctx.storePath,
        ...(options.root === undefined ? {} : { runlogsRoot: options.root }),
      });
      ctx.out(chalk.green(`Imported ${result.imported} run${result.imported === 1 ? '' : 's'}.`));
      ctx.out(`Skipped (empty agent_type): ${result.skippedEmptyAgentType}`);
      ctx.out(`Skipped (malformed): ${result.skippedMalformed}`);
    });
}
