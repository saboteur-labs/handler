/**
 * `handler show <agent>` command (spec Req 11).
 *
 * Thin wrapper: ingests lazily, resolves the named agent (listing sources when
 * the name is ambiguous across them), then prints its aggregated metrics and
 * per-run history. Metrics and grouping live in core (`aggregateMetrics`,
 * `summarizeAgents`); this layer only formats. Cost is reported as tokens.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import {
  aggregateMetrics,
  type AgentSummary,
  ingest,
  type Run,
  type Score,
  type ScoreBand,
  scoreRun,
  ScoreStore,
  SourceRegistry,
  summarizeAgents,
} from '../../core/index';
import type { CliContext } from './source';

export function registerShowCommand(program: Command, ctx: CliContext): void {
  program
    .command('show <agent>')
    .description("Show an agent's run history and metrics")
    .action((name: string) => {
      const registry = new SourceRegistry(ctx.registryPath);
      const runs = ingest({
        sources: registry.list(),
        projectsRoot: ctx.projectsRoot,
        storePath: ctx.storePath,
      });

      const matches = summarizeAgents(runs).filter((agent) => agent.name === name);
      if (matches.length === 0) {
        ctx.out(`No runs found for agent "${name}".`);
        return;
      }
      const [agent, ...others] = matches;
      if (others.length > 0 || agent === undefined) {
        printAmbiguous(ctx, name, matches);
        return;
      }
      printAgent(ctx, agent, runs, new ScoreStore(ctx.scoreStorePath));
    });
}

function printAmbiguous(ctx: CliContext, name: string, matches: readonly AgentSummary[]): void {
  ctx.out(`Multiple agents named "${name}" — specify a source:`);
  for (const match of matches) {
    ctx.out(`  ${match.sourceType.padEnd(4)}  ${match.sourcePath}`);
  }
}

function printAgent(
  ctx: CliContext,
  agent: AgentSummary,
  allRuns: readonly Run[],
  scoreStore: ScoreStore,
): void {
  const runs = allRuns.filter((run) => run.identityKey === agent.identityKey);
  const metrics = aggregateMetrics(runs);

  ctx.out(`${chalk.bold(agent.name)}  (${agent.sourceType} ${agent.sourcePath})`);
  ctx.out(
    `  ${metrics.invocationCount} run(s) · ${metrics.completedCount} completed, ${metrics.incompleteCount} incomplete`,
  );
  const avg =
    metrics.averageDurationMs !== undefined
      ? `, avg ${Math.round(metrics.averageDurationMs)}ms`
      : '';
  ctx.out(
    `  ${metrics.totalTokens} tokens · ${metrics.totalToolUseCount} tool uses · total ${metrics.totalDurationMs}ms${avg}`,
  );
  if (metrics.lastUsed !== undefined) {
    ctx.out(`  last used ${metrics.lastUsed}`);
  }
  const tools = Object.entries(metrics.toolStats);
  if (tools.length > 0) {
    ctx.out(`  tools: ${tools.map(([tool, count]) => `${tool} ${count}`).join(', ')}`);
  }

  ctx.out('  runs:');
  for (const run of runs) {
    ctx.out(`    ${formatRun(run)}`);
    ctx.out(`      ${formatScore(scoreRun(run, scoreStore))}`);
  }
}

const BAND_COLOR: Record<ScoreBand, (s: string) => string> = {
  pass: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
};

/** One-line score: band, composite, and the checks that didn't pass. */
function formatScore(score: Score | null): string {
  if (score === null) {
    return chalk.dim('score: unscored (no sub-transcript)');
  }
  const band = BAND_COLOR[score.band](score.band.toUpperCase());
  const flagged = score.breakdown.filter((c) => c.status === 'warn' || c.status === 'fail');
  const detail =
    flagged.length > 0 ? ` — ${flagged.map((c) => `${c.label}: ${c.detail}`).join('; ')}` : '';
  return `score: ${band} ${score.composite}${detail}`;
}

function formatRun(run: Run): string {
  const duration = run.totalDurationMs !== undefined ? `${run.totalDurationMs}ms` : '—';
  const tokens = run.totalTokens !== undefined ? `${run.totalTokens} tok` : '—';
  const tags = run.tags.length > 0 ? ` ${chalk.yellow(`[${run.tags.join(', ')}]`)}` : '';
  return `${run.runId}  ${run.status ?? 'unknown'}  ${duration}  ${tokens}  ${run.timestamp ?? ''}${tags}`;
}
