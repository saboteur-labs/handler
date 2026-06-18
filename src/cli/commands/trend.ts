/**
 * `handler trend <agent>` command (v1 Feature 1, Task 4).
 *
 * Thin wrapper: ingests lazily, resolves the named agent (listing sources when
 * the name is ambiguous), then renders either a per-run series or bucketed
 * aggregates. All series building, windowing, and bucketing live in core;
 * this layer only formats output.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import {
  type AgentSummary,
  type BucketGranularity,
  type BucketRow,
  bucket,
  buildTrendSeries,
  filterLast,
  filterSince,
  ingest,
  ScoreStore,
  SourceRegistry,
  summarizeAgents,
  type TrendRow,
} from '../../core/index';
import type { CliContext } from './source';

const BAND_COLOR: Record<string, (s: string) => string> = {
  pass: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
};

export function registerTrendCommand(program: Command, ctx: CliContext): void {
  program
    .command('trend <agent>')
    .description("Show an agent's metrics and scores trended over time")
    .option('--bucket <granularity>', 'Aggregate into day or week buckets')
    .option('--since <date>', 'ISO date (inclusive lower bound)')
    .option('--last <n>', 'Keep N most-recent runs', parseInt)
    .action((name: string, options: { bucket?: string; since?: string; last?: number }) => {
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

      // Validate --bucket value before building series
      if (options.bucket !== undefined) {
        if (options.bucket !== 'day' && options.bucket !== 'week') {
          ctx.out(`Unknown bucket granularity "${options.bucket}". Use "day" or "week".`);
          return;
        }
      }

      const agentRuns = runs.filter((run) => run.identityKey === agent.identityKey);
      const scoreStore = new ScoreStore(ctx.scoreStorePath);
      let series = buildTrendSeries(agentRuns, scoreStore);

      if (options.since !== undefined) {
        series = filterSince(series, options.since);
      }
      if (options.last !== undefined) {
        series = filterLast(series, options.last);
      }

      if (series.length === 0) {
        ctx.out(`No runs found for agent "${name}".`);
        return;
      }

      if (options.bucket !== undefined) {
        printBuckets(ctx, bucket(series, options.bucket as BucketGranularity));
      } else {
        printSeries(ctx, series);
      }
    });
}

function printAmbiguous(ctx: CliContext, name: string, matches: readonly AgentSummary[]): void {
  ctx.out(`Multiple agents named "${name}" — specify a source:`);
  for (const match of matches) {
    ctx.out(`  ${match.sourceType.padEnd(4)}  ${match.sourcePath}`);
  }
}

function printSeries(ctx: CliContext, series: readonly TrendRow[]): void {
  ctx.out(
    `${'timestamp'.padEnd(26)} ${'score'.padEnd(6)} ${'band'.padEnd(5)} ${'duration'.padEnd(11)} ${'tokens'.padEnd(7)} ${'tools'.padEnd(6)} status`,
  );
  for (const row of series) {
    ctx.out(formatRow(row));
  }
}

function formatRow(row: TrendRow): string {
  const timestamp = row.missingTimestamp ? '—' : (row.timestamp ?? '—');
  const score = row.composite !== undefined ? String(row.composite) : '—';
  const band =
    row.band !== undefined ? (BAND_COLOR[row.band] ?? ((s: string) => s))(row.band) : '—';
  const duration = row.durationMs !== undefined ? `${row.durationMs}ms` : '—';
  const tokens = row.tokens !== undefined ? String(row.tokens) : '—';
  const tools = row.toolUseCount !== undefined ? String(row.toolUseCount) : '—';
  const status = row.incomplete ? 'incomplete' : 'completed';

  const tags: string[] = [];
  if (row.incomplete) {
    tags.push('[incomplete]');
  }
  if (row.missingTimestamp) {
    tags.push('[no-timestamp]');
  }
  const tagSuffix = tags.length > 0 ? `  ${tags.join(' ')}` : '';

  return `${timestamp.padEnd(26)} ${score.padEnd(6)} ${band.padEnd(5)} ${duration.padEnd(11)} ${tokens.padEnd(7)} ${tools.padEnd(6)} ${status}${tagSuffix}`;
}

function printBuckets(ctx: CliContext, rows: readonly BucketRow[]): void {
  ctx.out(
    `${'bucket'.padEnd(12)} ${'runs'.padEnd(5)} ${'score'.padEnd(6)} ${'tokens'.padEnd(9)} duration`,
  );
  for (const row of rows) {
    const score = row.medianComposite !== undefined ? String(row.medianComposite) : '—';
    const tokens = row.medianTokens !== undefined ? String(row.medianTokens) : '—';
    const duration = row.medianDurationMs !== undefined ? `${row.medianDurationMs}ms` : '—';
    ctx.out(
      `${row.bucket.padEnd(12)} ${String(row.count).padEnd(5)} ${score.padEnd(6)} ${tokens.padEnd(9)} ${duration}`,
    );
  }
}
