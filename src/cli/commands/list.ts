/**
 * `handler list` command (spec Req 10).
 *
 * Thin wrapper: ingests runs from the transcripts (lazy-on-read), then prints
 * one line per distinct agent the user authored, with its run count. All logic
 * lives in core (`ingest`, `summarizeAgents`).
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import { ingest, SourceRegistry, summarizeAgents } from '../../core/index';
import type { CliContext } from './source';

export function registerListCommand(program: Command, ctx: CliContext): void {
  program
    .command('list')
    .description('List your agents and how many runs each has')
    .action(() => {
      const registry = new SourceRegistry(ctx.registryPath);
      const runs = ingest({
        sources: registry.list(),
        projectsRoot: ctx.projectsRoot,
        storePath: ctx.storePath,
      });
      const agents = summarizeAgents(runs);
      if (agents.length === 0) {
        ctx.out('No agent runs found.');
        return;
      }
      for (const agent of agents) {
        const count = `${agent.runCount} run${agent.runCount === 1 ? '' : 's'}`;
        ctx.out(`${agent.sourceType.padEnd(4)}  ${chalk.bold(agent.name)}  ${count}`);
      }
    });
}
