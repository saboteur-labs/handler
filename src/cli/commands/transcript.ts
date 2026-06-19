/**
 * `handler transcript <agent> <runId>` command (Feature 8, Reqs 48–52).
 *
 * Locates the stored run for the named agent, resolves the sidechain path,
 * calls `readTranscript`, and renders structured output to stdout. All parsing
 * and transcript logic lives in core; this layer only formats output.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import {
  type AgentSummary,
  ingest,
  readTranscript,
  resolveAgentByName,
  type Run,
  type RunTranscript,
  SourceRegistry,
} from '../../core/index';
import type { CliContext } from './source';

interface TranscriptOptions {
  readonly latest?: boolean;
  readonly full?: boolean;
}

export function registerTranscriptCommand(program: Command, ctx: CliContext): void {
  program
    .command('transcript [agent] [runId]')
    .description('Show the full turn-by-turn transcript of an agent run')
    .option('--latest', 'Use the most-recent run of the named agent')
    .option('--full', 'Disable tool-output truncation')
    .action(
      (agentArg: string | undefined, runIdArg: string | undefined, options: TranscriptOptions) => {
        // When --latest is used, the positional may be just the agent name (runId optional).
        const agentName = agentArg;
        if (agentName === undefined) {
          ctx.out('Usage: handler transcript <agent> [runId] [--latest] [--full]');
          throw new Error('Missing agent name.');
        }

        const registry = new SourceRegistry(ctx.registryPath);
        const runs = ingest({
          sources: registry.list(),
          projectsRoot: ctx.projectsRoot,
          storePath: ctx.storePath,
        });

        const resolution = resolveAgentByName(runs, agentName);

        if (resolution.kind === 'unknown') {
          ctx.out(`No runs found for agent "${agentName}".`);
          throw new Error(`Unknown agent "${agentName}".`);
        }
        if (resolution.kind === 'ambiguous') {
          printAmbiguous(ctx, agentName, resolution.matches);
          throw new Error(`Agent "${agentName}" is ambiguous — specify a source.`);
        }

        const agentRuns = runs.filter((r) => r.identityKey === resolution.summary.identityKey);

        let targetRun: Run | undefined;

        if (options.latest === true) {
          // Select the most-recent run by timestamp descending; epoch 0 for undefined.
          targetRun = [...agentRuns].sort((a, b) => {
            const ta = a.timestamp !== undefined ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp !== undefined ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
          })[0];

          if (targetRun === undefined) {
            ctx.out(`No runs found for agent "${agentName}".`);
            throw new Error(`No runs for agent "${agentName}".`);
          }
        } else {
          const runId = runIdArg;
          if (runId === undefined) {
            ctx.out('Usage: handler transcript <agent> <runId> [--latest] [--full]');
            throw new Error('Missing runId.');
          }
          targetRun = agentRuns.find((r) => r.runId === runId);
          if (targetRun === undefined) {
            ctx.out(`Run "${runId}" not found for agent "${agentName}".`);
            throw new Error(`Unknown run "${runId}" for agent "${agentName}".`);
          }
        }

        // Check sidechain availability: runs tagged incomplete or with no sidechainPath.
        const sidechainPath = targetRun.sidechainPath;
        if (targetRun.tags.includes('incomplete') || sidechainPath === undefined) {
          const status = targetRun.status ?? 'unavailable';
          ctx.out(`No transcript available for this run (status: ${status}).`);
          throw new Error(`No transcript available for run "${targetRun.runId}".`);
        }

        const transcript = readTranscript(
          sidechainPath,
          options.full === true ? { full: true } : undefined,
        );

        printTranscript(ctx, targetRun, transcript, options.full === true);
      },
    );
}

function printAmbiguous(ctx: CliContext, name: string, matches: readonly AgentSummary[]): void {
  ctx.out(`Multiple agents named "${name}" — specify a source:`);
  for (const match of matches) {
    ctx.out(`  ${match.sourceType.padEnd(4)}  ${match.sourcePath}`);
  }
}

function printTranscript(
  ctx: CliContext,
  run: Run,
  transcript: RunTranscript,
  full: boolean,
): void {
  // (a) Header
  const timestamp = run.timestamp ?? '—';
  const status = run.status ?? 'unknown';
  ctx.out(`${chalk.bold(run.agentName)}  run ${chalk.cyan(run.runId)}  ${timestamp}  ${status}`);

  // (b) Task prompt
  ctx.out('');
  ctx.out(chalk.bold('Task prompt'));
  ctx.out(transcript.taskPrompt ?? '(no task prompt)');

  // (c) Turns
  if (transcript.turns.length > 0) {
    ctx.out('');
  }

  for (const turn of transcript.turns) {
    // Assistant text blocks as prose
    for (const text of turn.textBlocks) {
      if (text.trim().length > 0) {
        ctx.out(text);
      }
    }

    // Tool calls with results
    for (const toolCall of turn.toolCalls) {
      ctx.out('');
      ctx.out(chalk.yellow(`[tool] ${toolCall.name}`));
      ctx.out(JSON.stringify(toolCall.input, null, 2));

      if (toolCall.result === undefined) {
        ctx.out(chalk.dim('(no result)'));
      } else {
        const errorPrefix = toolCall.result.isError ? chalk.red('[error] ') : '';
        const truncatedSuffix = toolCall.result.truncated && !full ? chalk.dim(' [truncated]') : '';
        ctx.out(`${errorPrefix}${toolCall.result.content}${truncatedSuffix}`);
      }
    }
  }

  // (d) Footer
  ctx.out('');
  ctx.out(`Stop reason: ${transcript.stopReason ?? 'unknown'}`);
}
