/**
 * `handler reset` — clear handler's local stores.
 *
 * Thin wrapper over core's `planReset`/`executeReset`. The split matters here:
 * the plan is rendered to the user (which files, how big, what is lost) *before*
 * the confirmation prompt, so nobody confirms a deletion they haven't seen. All
 * scoping and deletion logic lives in core.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import type { ResetPaths, ResetPlan, ResetScope, ResetTarget } from '../../core/index';
import { executeReset, planReset } from '../../core/index';
import type { CliContext } from './source';

interface ResetOptions {
  readonly scores?: boolean;
  readonly all?: boolean;
  readonly yes?: boolean;
  readonly dryRun?: boolean;
  readonly backup?: string;
}

/** What each scope leaves behind, shown under the plan. */
const SCOPE_SUMMARY: Record<ResetScope, string> = {
  scores: 'Run history, notes, sources, and judge annotations are kept.',
  derived: 'Notes, sources, and judge annotations are kept.',
  all: 'Everything handler stores locally is removed.',
};

export function registerResetCommand(program: Command, ctx: CliContext): void {
  program
    .command('reset')
    .description("Clear handler's local stores (defaults to the regenerable ones)")
    .option('--scores', 'clear only the score annotations, keeping attributed run history')
    .option('--all', 'clear every store, including notes, sources, and judge annotations')
    .option('-y, --yes', 'skip the confirmation prompt')
    .option('-n, --dry-run', 'print the plan without deleting anything')
    .option('--backup <dir>', 'copy each file to <dir> before deleting it')
    .action(async (options: ResetOptions) => {
      const scope = resolveScope(options);
      const plan = planReset({ scope, paths: resetPaths(ctx) });
      const present = plan.targets.filter((target) => target.exists);

      printPlan(ctx, plan, present);

      if (present.length === 0) {
        ctx.out('Nothing to clear.');
        return;
      }
      if (options.dryRun === true) {
        ctx.out(chalk.dim('Dry run — nothing was deleted.'));
        return;
      }
      if (options.yes !== true && !(await ctx.confirm(`Delete ${present.length} file(s)?`))) {
        ctx.out('Aborted — nothing was deleted.');
        return;
      }

      const outcome = executeReset(
        plan,
        options.backup === undefined ? {} : { backupDir: options.backup },
      );

      if (outcome.backupDir !== undefined) {
        ctx.out(chalk.dim(`Backed up ${outcome.backedUp.length} file(s) to ${outcome.backupDir}`));
      }
      ctx.out(chalk.green(`Cleared ${outcome.deleted.length} file(s).`));
      ctx.out(nextStep(scope));
    });
}

/** `--scores` and `--all` name different scopes; asking for both is a mistake. */
function resolveScope(options: ResetOptions): ResetScope {
  if (options.scores === true && options.all === true) {
    throw new Error('Use either --scores or --all, not both.');
  }
  if (options.all === true) {
    return 'all';
  }
  return options.scores === true ? 'scores' : 'derived';
}

/**
 * Map the CLI's per-store path overrides onto core's reset paths, so a test (or
 * an embedder) pointing handler at a sandbox resets that sandbox, not `~`.
 * Unset entries fall through to each store's own default inside core.
 */
function resetPaths(ctx: CliContext): ResetPaths {
  return {
    runs: ctx.storePath,
    scores: ctx.scoreStorePath,
    tierB: ctx.tierBStorePath,
    tierC: ctx.tierCStorePath,
    anchors: ctx.anchorStorePath,
    notes: ctx.noteStorePath,
    sources: ctx.registryPath,
    conventions: ctx.conventionsPath,
    config: ctx.userConfigPath,
  };
}

function printPlan(ctx: CliContext, plan: ResetPlan, present: readonly ResetTarget[]): void {
  ctx.out(chalk.bold(`handler reset — scope: ${plan.scope}`));
  ctx.out('');

  const width = Math.max(...plan.targets.map((target) => fileLabel(target).length));
  for (const target of plan.targets) {
    const name = fileLabel(target).padEnd(width);
    if (!target.exists) {
      ctx.out(chalk.dim(`  ${name}  ${'absent'.padStart(8)}  ${target.label}`));
      continue;
    }
    ctx.out(`  ${name}  ${bytes(target.sizeBytes).padStart(8)}  ${target.label}`);
  }
  ctx.out('');
  ctx.out(SCOPE_SUMMARY[plan.scope]);

  const authored = present.filter((target) => !target.derived);
  if (authored.length > 0) {
    ctx.out(
      chalk.yellow(
        `Warning: ${authored.length} of these cannot be regenerated — ` +
          `${authored.map((target) => fileLabel(target)).join(', ')}. Consider --backup <dir>.`,
      ),
    );
  }
  ctx.out('');
}

/** What to do next, so a fresh store repopulates without guesswork. */
function nextStep(scope: ResetScope): string {
  if (scope === 'all') {
    return chalk.dim(
      'Next: `handler source register --user` (or a repo path), then `handler list`.',
    );
  }
  return chalk.dim('Next: `handler list` re-ingests from your transcripts and re-scores.');
}

/** Basename of a target's path — the store's identity as the user sees it. */
function fileLabel(target: ResetTarget): string {
  return target.path.split(/[\\/]/).pop() ?? target.path;
}

function bytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}
