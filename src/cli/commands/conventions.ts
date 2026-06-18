/**
 * `handler conventions` command (spec Reqs 16-18).
 *
 * Thin wrapper: assesses every registered source's definitions against the
 * distilled conventions artifact and prints, per agent, its convention
 * violations (rule id + message) plus a header line for the conventions
 * staleness state. All logic lives in core (`assessConventions`); this layer
 * only formats. handler never invokes the sync skill — a stale header only
 * instructs the user to run it.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import type { ConventionsAssessment, StalenessState } from '../../core/index';
import { assessConventions, SourceRegistry } from '../../core/index';
import type { CliContext } from './source';

export function registerConventionsCommand(program: Command, ctx: CliContext): void {
  program
    .command('conventions')
    .description('Check your agent definitions against Anthropic subagent conventions')
    .action(() => {
      const registry = new SourceRegistry(ctx.registryPath);
      const assessment = assessConventions({
        sources: registry.list(),
        conventionsPath: ctx.conventionsPath,
      });
      printAssessment(assessment, ctx.out);
    });
}

function printAssessment(assessment: ConventionsAssessment, out: (line: string) => void): void {
  out(stalenessHeader(assessment.staleness));
  if (assessment.agents.length === 0) {
    out('No agent definitions assessed.');
    return;
  }
  for (const agent of assessment.agents) {
    out(`${agent.identity.sourceType.padEnd(4)}  ${chalk.bold(agent.identity.name)}`);
    if (agent.orphan) {
      out('  definition not found (orphan) — skipped');
      continue;
    }
    if (agent.violations.length === 0) {
      out(chalk.green('  no violations'));
    }
    for (const violation of agent.violations) {
      out(`  ${chalk.yellow(violation.rule)}  ${violation.message}`);
    }
    for (const smell of agent.smells) {
      out(chalk.dim(`  smell: ${smell}`));
    }
  }
}

/** The staleness header line; a stale state instructs the user to run the sync skill. */
function stalenessHeader(state: StalenessState): string {
  if (state === 'fresh') {
    return `conventions: ${chalk.green('fresh')}`;
  }
  return `conventions: ${chalk.yellow(`stale (${state})`)} — run the sync skill to refresh`;
}
