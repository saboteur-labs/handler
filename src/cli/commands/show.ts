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
  type DefinitionChangeDelta,
  definitionChangeDeltas,
  ingest,
  NoteStore,
  type Run,
  type Score,
  type RunTelemetrySummary,
  type ScoreBand,
  scoreRun,
  ScoreStore,
  SourceRegistry,
  summarizeAgents,
  TIER_C_VERSION,
  type TierCResult,
  TierCStore,
  tierBForRun,
  type TierBResult,
  TierBStore,
} from '../../core/index';
import { signed, signedPercent } from '../format';
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
      printAgent(
        ctx,
        agent,
        runs,
        new ScoreStore(ctx.scoreStorePath),
        new TierBStore(ctx.tierBStorePath),
        new TierCStore(ctx.tierCStorePath),
      );
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
  tierBStore: TierBStore,
  tierCStore: TierCStore,
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

  const note = new NoteStore(ctx.noteStorePath).get(agent.identityKey);
  if (note !== undefined) {
    ctx.out(`  ${chalk.bold('note:')} ${note.body.replace(/\n/g, '\n  ')}`);
  }

  // A "definition changed" marker is shown before the first run of each new
  // definition version, carrying the before/after metric delta.
  const markerByRunId = new Map<string, DefinitionChangeDelta>();
  for (const delta of definitionChangeDeltas(runs, scoreStore)) {
    const firstAfter = delta.after.runs[0];
    if (firstAfter !== undefined) {
      markerByRunId.set(firstAfter.runId, delta);
    }
  }

  ctx.out('  runs:');
  for (const run of [...runs].sort(byTimestamp)) {
    const marker = markerByRunId.get(run.runId);
    if (marker !== undefined) {
      ctx.out(`    ${formatDefinitionChange(marker)}`);
    }
    ctx.out(`    ${formatRun(run)}`);
    ctx.out(`      ${formatScore(scoreRun(run, scoreStore))}`);
    ctx.out(`      ${formatTierB(tierBForRun(run, runs, tierBStore))}`);
    const tierCResult = tierCStore.get(run.identityKey, run.runId, TIER_C_VERSION);
    if (tierCResult !== undefined) {
      ctx.out(`      ${formatTierC(tierCResult)}`);
    }
    const telemetry = run.telemetry === undefined ? undefined : formatTelemetry(run.telemetry);
    if (telemetry !== undefined) {
      ctx.out(`      ${chalk.dim(telemetry)}`);
    }
  }
}

/** One-line per-run telemetry, or `undefined` when there is nothing to show. */
function formatTelemetry(telemetry: RunTelemetrySummary): string | undefined {
  const parts: string[] = [];
  if (telemetry.turns.length > 0) {
    const tokens = telemetry.turns.reduce(
      (acc, turn) => ({
        input: acc.input + turn.usage.inputTokens,
        output: acc.output + turn.usage.outputTokens,
        cacheRead: acc.cacheRead + turn.usage.cacheReadTokens,
      }),
      { input: 0, output: 0, cacheRead: 0 },
    );
    parts.push(`tokens in ${tokens.input} / out ${tokens.output} / cache-read ${tokens.cacheRead}`);
  }
  if (telemetry.latency !== undefined) {
    parts.push(`latency p50 ${telemetry.latency.p50Ms}ms p95 ${telemetry.latency.p95Ms}ms`);
  }
  if (telemetry.stopReason !== undefined) {
    parts.push(`stop ${telemetry.stopReason}`);
  }
  if (telemetry.filesEdited.length > 0) {
    parts.push(`edits ${telemetry.filesEdited.length}`);
  }
  if (telemetry.retryLoops > 0) {
    parts.push(`retries ${telemetry.retryLoops}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Order runs chronologically; runs without a timestamp sort last. */
function byTimestamp(a: Run, b: Run): number {
  if (a.timestamp === b.timestamp) {
    return 0;
  }
  if (a.timestamp === undefined) {
    return 1;
  }
  if (b.timestamp === undefined) {
    return -1;
  }
  return a.timestamp < b.timestamp ? -1 : 1;
}

/** One-line definition-change marker with the before/after deltas. */
function formatDefinitionChange(delta: DefinitionChangeDelta): string {
  const parts = [
    `composite ${signed(delta.compositeDelta)}`,
    `terminal ${signedPercent(delta.terminalSuccessRateDelta)}`,
    `tool-errors ${signed(delta.toolErrorCountDelta)}`,
    `tokens ${signed(delta.tokenTotalDelta)}`,
  ];
  const confidence = delta.lowConfidence ? chalk.yellow(' [low confidence]') : '';
  return `${chalk.cyan('── definition changed ──')} ${parts.join(' · ')}${confidence}`;
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

/** One-line Tier B reference-relative score section. */
function formatTierB(result: TierBResult): string {
  const label = chalk.cyan('Tier B:');
  if (result.status === 'insufficient-history') {
    return `${label} ${chalk.dim('insufficient history')}`;
  }

  const flags = result.flags ?? [];
  const flagParts = flags.map((flag) => {
    let statusStr: string;
    if (flag.status === 'outlier') {
      statusStr = chalk.yellow('outlier');
    } else if (flag.status === 'within') {
      statusStr = 'within';
    } else {
      statusStr = chalk.dim('n/a');
    }
    return `${flag.dimension} ${statusStr}`;
  });

  let contractStr: string;
  const contract = result.contract;
  if (contract === undefined || contract.status === 'not-applicable') {
    contractStr = `contract ${chalk.dim('n/a')}`;
  } else if (contract.status === 'pass') {
    contractStr = `contract ${chalk.green('pass')}`;
  } else {
    contractStr = `contract ${chalk.red('fail')}`;
  }

  return `${label} ${[...flagParts, contractStr].join(' · ')}`;
}

/** One-line Tier C (judged quality) section for a run that has an annotation. */
function formatTierC(result: TierCResult): string {
  const label = chalk.magenta('Tier C (judged quality):');
  const verdict = result.label === 'pass' ? chalk.green(result.label) : chalk.red(result.label);
  return `${label} ${verdict} — ${result.reasoning}`;
}

function formatRun(run: Run): string {
  const duration = run.totalDurationMs !== undefined ? `${run.totalDurationMs}ms` : '—';
  const tokens = run.totalTokens !== undefined ? `${run.totalTokens} tok` : '—';
  const tags = run.tags.length > 0 ? ` ${chalk.yellow(`[${run.tags.join(', ')}]`)}` : '';
  return `${run.runId}  ${run.status ?? 'unknown'}  ${duration}  ${tokens}  ${run.timestamp ?? ''}${tags}`;
}
