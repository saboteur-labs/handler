/**
 * `handler diff <agent>` command (feature-6 Req 6).
 *
 * Thin wrapper: ingests lazily, resolves the named agent (listing sources when
 * the name is ambiguous), then prints the before/after metric impact of each
 * change to its definition. All correlation lives in core
 * (`definitionChangeDeltas`); this layer only formats.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import {
  type AgentSummary,
  type DefinitionChangeDelta,
  definitionChangeDeltas,
  ingest,
  type Run,
  type SideAggregate,
  ScoreStore,
  SourceRegistry,
  summarizeAgents,
} from '../../core/index';
import { decimal, percent, signed, signedPercent } from '../format';
import type { CliContext } from './source';

export function registerDiffCommand(program: Command, ctx: CliContext): void {
  program
    .command('diff <agent>')
    .description("Show the metric impact of each change to an agent's definition")
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
        ctx.out(`Multiple agents named "${name}" — specify a source:`);
        for (const match of matches) {
          ctx.out(`  ${match.sourceType.padEnd(4)}  ${match.sourcePath}`);
        }
        return;
      }
      printDiff(ctx, agent, runs, new ScoreStore(ctx.scoreStorePath));
    });
}

function printDiff(
  ctx: CliContext,
  agent: AgentSummary,
  allRuns: readonly Run[],
  scoreStore: ScoreStore,
): void {
  const runs = allRuns.filter((run) => run.identityKey === agent.identityKey);
  const deltas = definitionChangeDeltas(runs, scoreStore);

  ctx.out(`${chalk.bold(agent.name)}  (${agent.sourceType} ${agent.sourcePath})`);
  if (deltas.length === 0) {
    ctx.out('  no definition changes');
    return;
  }

  deltas.forEach((delta, index) => {
    ctx.out(`  ${chalk.cyan(`definition change ${index + 1}`)}:`);
    ctx.out(`    before: ${formatSide(delta.beforeAggregate)}`);
    ctx.out(`    after:  ${formatSide(delta.afterAggregate)}`);
    ctx.out(`    delta:  ${formatDelta(delta)}`);
  });
}

/** Absolute aggregate for one definition version. */
function formatSide(side: SideAggregate): string {
  return [
    `${side.runCount} run(s), ${side.scoredRunCount} scored`,
    `composite ${decimal(side.meanComposite)}`,
    `terminal ${percent(side.terminalSuccessRate)}`,
    `tool-errors ${side.toolErrorCount}`,
    `${side.tokenTotal} tok`,
  ].join(' · ');
}

/** Signed before→after delta line, with a low-confidence indicator. */
function formatDelta(delta: DefinitionChangeDelta): string {
  const parts = [
    `composite ${signed(delta.compositeDelta)}`,
    `terminal ${signedPercent(delta.terminalSuccessRateDelta)}`,
    `tool-errors ${signed(delta.toolErrorCountDelta)}`,
    `tokens ${signed(delta.tokenTotalDelta)}`,
  ];
  const confidence = delta.lowConfidence ? chalk.yellow(' [low confidence]') : '';
  return `${parts.join(' · ')}${confidence}`;
}
