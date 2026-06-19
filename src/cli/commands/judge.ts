/**
 * `handler judge <agent> <runId>` command (v1 Feature 3, Task 8).
 *
 * The explicit, opt-in entry point for Tier C judged-quality scoring. This
 * command is the trust boundary: it MUST print a pre-flight warning and require
 * user confirmation BEFORE any data leaves the machine. Aborting makes zero
 * network calls and writes nothing to any store.
 *
 * Flow:
 *   1. Look up agent and run (error clearly if not found).
 *   2. Print a clear WARNING that run output and definition content will be
 *      transmitted to an external LLM. Show what will be sent.
 *   3. Prompt for confirmation ("y/N"). Default is N.
 *      `--yes` / `--confirm` skip the interactive prompt for non-interactive use.
 *   4. On abort: print "Aborted. No data transmitted." — ZERO network calls,
 *      ZERO store writes.
 *   5. On confirmation: retrieve anchors from `AnchorStore`, call `judgeRun`,
 *      then print the Tier C result.
 *   6. On judge failure: print the error, exit non-zero, no annotation written.
 *
 * The CLI holds NO logic — it resolves inputs and delegates to `judgeRun` from
 * core. The `JudgeClient` is always injected from `CliContext.judgeClient` so
 * tests use a fake and no real API calls are made in the test suite.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import type { AgentSummary } from '../../core/index';
import {
  AnchorStore,
  DefaultJudgeClient,
  ingest,
  judgeRun,
  resolveAgentByName,
  SourceRegistry,
  TierCStore,
} from '../../core/index';
import type { CliContext } from './source';

interface JudgeOptions {
  readonly yes?: boolean;
  readonly confirm?: boolean;
}

export function registerJudgeCommand(program: Command, ctx: CliContext): void {
  program
    .command('judge <agent> <runId>')
    .description(
      'Invoke the Tier C LLM judge on a specific run (opt-in; prints a pre-flight warning)',
    )
    .option('--yes', 'Skip the interactive confirmation prompt')
    .option('--confirm', 'Alias for --yes; skip the interactive confirmation prompt')
    .action(async (agentName: string, runId: string, options: JudgeOptions) => {
      // ------------------------------------------------------------------
      // Step 1: Look up agent and run
      // ------------------------------------------------------------------
      const registry = new SourceRegistry(ctx.registryPath);
      const runs = ingest({
        sources: registry.list(),
        projectsRoot: ctx.projectsRoot,
        storePath: ctx.storePath,
      });

      const result = resolveAgentByName(runs, agentName);

      if (result.kind === 'ambiguous') {
        printAmbiguous(ctx, agentName, result.matches);
        throw new Error(`Agent "${agentName}" is ambiguous — specify a source.`);
      }
      if (result.kind === 'unknown') {
        ctx.out(`No runs found for agent "${agentName}".`);
        throw new Error(`Unknown agent "${agentName}".`);
      }

      const agentRuns = runs.filter((r) => r.identityKey === result.summary.identityKey);
      const targetRun = agentRuns.find((r) => r.runId === runId);

      if (targetRun === undefined) {
        ctx.out(`No run "${runId}" found for agent "${agentName}".`);
        throw new Error(`Unknown run "${runId}" for agent "${agentName}".`);
      }

      // ------------------------------------------------------------------
      // Step 2: Print the pre-flight warning (MUST fire before ANY judge call)
      // ------------------------------------------------------------------
      const definitionPreview =
        targetRun.definitionSnapshot !== null
          ? targetRun.definitionSnapshot.slice(0, 120)
          : '(no definition snapshot)';

      ctx.out(chalk.yellow('WARNING: Tier C judge invocation'));
      ctx.out(
        chalk.yellow(
          'This will transmit run output and agent definition content to an external LLM.',
        ),
      );
      ctx.out('The following data will be sent:');
      ctx.out(`  Agent:      ${agentName}`);
      ctx.out(`  Run ID:     ${runId}`);
      ctx.out(
        `  Definition: ${definitionPreview}${(targetRun.definitionSnapshot?.length ?? 0) > 120 ? '…' : ''}`,
      );
      ctx.out('');

      // ------------------------------------------------------------------
      // Step 3: Confirmation — --yes/--confirm flag skips interactive prompt
      // ------------------------------------------------------------------
      const skipPrompt = (options.yes ?? false) || (options.confirm ?? false);
      let confirmed = skipPrompt;

      if (!skipPrompt) {
        ctx.out('Proceed? [y/N] ');
        const input = (await ctx.readStdin()).trim().toLowerCase();
        confirmed = input === 'y' || input === 'yes';
      }

      // ------------------------------------------------------------------
      // Step 4: Abort path — ZERO network calls, ZERO store writes
      // ------------------------------------------------------------------
      if (!confirmed) {
        ctx.out('Aborted. No data transmitted.');
        return;
      }

      // ------------------------------------------------------------------
      // Step 5: Retrieve anchors and call judgeRun (via injectable client)
      // ------------------------------------------------------------------
      const anchorStore = new AnchorStore(ctx.anchorStorePath);
      const anchors = anchorStore.getByAgent(targetRun.identityKey);

      const tierCStore = new TierCStore(ctx.tierCStorePath);
      const judgeClient = ctx.judgeClient ?? new DefaultJudgeClient();

      const tierCResult = await judgeRun(targetRun, anchors, judgeClient, tierCStore);

      // ------------------------------------------------------------------
      // Step 6: Print Tier C result (only reached on success)
      // ------------------------------------------------------------------
      const labelColor = tierCResult.label === 'pass' ? chalk.green : chalk.red;
      ctx.out('');
      ctx.out(chalk.bold('Tier C (judged quality):'));
      ctx.out(`  Label:     ${labelColor(tierCResult.label)}`);
      ctx.out(`  Reasoning: ${tierCResult.reasoning}`);
    });
}

function printAmbiguous(ctx: CliContext, name: string, matches: readonly AgentSummary[]): void {
  ctx.out(`Multiple agents named "${name}" — specify a source:`);
  for (const match of matches) {
    ctx.out(`  ${match.sourceType.padEnd(4)}  ${match.sourcePath}`);
  }
}
