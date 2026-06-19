/**
 * `handler anchor <agent> <runId> --score <s> --reasoning <text>` command.
 *
 * Allows the user to mark a specific run as a ground-truth calibration example
 * (anchor) for the Tier C LLM judge. Anchors are ONLY created by this explicit
 * command — never automatically by ingestion or scoring.
 *
 * Thin wrapper: resolves agent by name, finds the run, captures its definition
 * snapshot and output, and delegates persistence to `AnchorStore`. All logic
 * lives in core; this layer only parses args and formats output.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import type { AgentSummary } from '../../core/index';
import {
  AnchorStore,
  extractRunOutput,
  ingest,
  resolveAgentByName,
  SourceRegistry,
} from '../../core/index';
import type { TierCAnchor } from '../../core/scoring/tier-c';
import type { CliContext } from './source';

interface AnchorOptions {
  readonly score: 'pass' | 'fail';
  readonly reasoning: string;
}

export function registerAnchorCommand(program: Command, ctx: CliContext): void {
  program
    .command('anchor <agent> <runId>')
    .description('Mark a run as a ground-truth calibration anchor for the Tier C judge')
    .requiredOption('--score <verdict>', 'Quality verdict: "pass" or "fail"')
    .requiredOption('--reasoning <text>', 'Explanation for this verdict')
    .action((agentName: string, runId: string, options: AnchorOptions) => {
      if (options.score !== 'pass' && options.score !== 'fail') {
        ctx.out(chalk.red(`Invalid --score "${options.score}". Use "pass" or "fail".`));
        throw new Error(`Invalid score value: "${options.score}"`);
      }

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

      const definitionSnapshot = targetRun.definitionSnapshot ?? '';
      const runOutput = extractRunOutput(targetRun) ?? '';

      const anchor: TierCAnchor = {
        identityKey: targetRun.identityKey,
        runId: targetRun.runId,
        definitionSnapshot,
        runOutput,
        score: options.score,
        reasoning: options.reasoning,
        createdAt: new Date().toISOString(),
      };

      new AnchorStore(ctx.anchorStorePath).add(anchor);

      ctx.out(chalk.green(`Anchor saved for ${agentName} / ${runId} (${options.score}).`));
    });
}

function printAmbiguous(ctx: CliContext, name: string, matches: readonly AgentSummary[]): void {
  ctx.out(`Multiple agents named "${name}" — specify a source:`);
  for (const match of matches) {
    ctx.out(`  ${match.sourceType.padEnd(4)}  ${match.sourcePath}`);
  }
}
