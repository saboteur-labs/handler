/**
 * `handler insights` command (V1 Feature 4, Task 4).
 *
 * Thin wrapper: ingests runs, builds the classifier input from the run store,
 * score store, and Tier B store, then delegates entirely to `classifyRoster`
 * from core. This file holds NO classification logic — it only wires data and
 * formats output.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import {
  type AgentDescriptor,
  type AgentInsight,
  classifyRoster,
  type ClassifierInput,
  enumerateAgentDescriptors,
  ingest,
  type InsightsResult,
  type Run,
  ScoreStore,
  SourceRegistry,
  summarizeAgents,
  TierBStore,
} from '../../core/index';
import type { CliContext } from './source';

export function registerInsightsCommand(program: Command, ctx: CliContext): void {
  program
    .command('insights')
    .description('Show a categorized summary of all known agents (unused, failing, expensive)')
    .action(() => {
      const registry = new SourceRegistry(ctx.registryPath);
      const sources = registry.list();
      const runs = ingest({
        sources,
        projectsRoot: ctx.projectsRoot,
        storePath: ctx.storePath,
      });

      // Merge run-derived agents with defined-but-unrun agents so the latter
      // reach the classifier's no-history bucket (Req 7). Dedupe on identity.
      const agents = mergeRoster(summarizeAgents(runs), enumerateAgentDescriptors(sources));

      if (agents.length === 0) {
        ctx.out('No agents found.');
        return;
      }

      // Build runsByIdentityKey
      const runsByIdentityKey = buildRunsByIdentityKey(runs);

      // Build scoresByRunId from ScoreStore
      const scoreStore = new ScoreStore(ctx.scoreStorePath);
      const scoresByRunId = buildScoresByRunId(scoreStore);

      // Build tierBAnnotationsByIdentityKey from TierBStore
      const tierBStore = new TierBStore(ctx.tierBStorePath);
      const tierBAnnotationsByIdentityKey = buildTierBAnnotationsByIdentityKey(tierBStore, runs);

      const input: ClassifierInput = {
        agents,
        runsByIdentityKey,
        scoresByRunId,
        tierBAnnotationsByIdentityKey,
      };

      const result = classifyRoster(input);
      printInsights(ctx, result);
    });
}

// ---------------------------------------------------------------------------
// Data-assembly helpers (no classification logic)
// ---------------------------------------------------------------------------

/**
 * Union of run-derived agents and defined-but-unrun agents, deduped on
 * `identityKey`. Run-derived entries win (they carry a run count); definition
 * descriptors only contribute agents not already present, so a defined agent
 * with zero runs reaches the classifier and lands in its no-history bucket.
 */
function mergeRoster(
  runDerived: readonly AgentDescriptor[],
  defined: readonly AgentDescriptor[],
): AgentDescriptor[] {
  const byKey = new Map<string, AgentDescriptor>();
  for (const agent of runDerived) {
    byKey.set(agent.identityKey, agent);
  }
  for (const agent of defined) {
    if (!byKey.has(agent.identityKey)) {
      byKey.set(agent.identityKey, agent);
    }
  }
  return [...byKey.values()];
}

/** Group all runs by agent identity key. */
function buildRunsByIdentityKey(runs: readonly Run[]): ReadonlyMap<string, readonly Run[]> {
  const map = new Map<string, Run[]>();
  for (const run of runs) {
    const existing = map.get(run.identityKey);
    if (existing !== undefined) {
      existing.push(run);
    } else {
      map.set(run.identityKey, [run]);
    }
  }
  return map;
}

/** Build a runId → Score map from the score store. */
function buildScoresByRunId(
  scoreStore: ScoreStore,
): ReadonlyMap<string, import('../../core/index').Score> {
  const map = new Map<string, import('../../core/index').Score>();
  for (const annotation of scoreStore.list()) {
    map.set(annotation.runId, annotation.score);
  }
  return map;
}

/** Build an identityKey → TierBAnnotation[] map from the Tier B store. */
function buildTierBAnnotationsByIdentityKey(
  tierBStore: TierBStore,
  runs: readonly Run[],
): ReadonlyMap<string, readonly import('../../core/index').TierBAnnotation[]> {
  // Index runs by runId so we can look up their identityKey
  const identityKeyByRunId = new Map<string, string>();
  for (const run of runs) {
    identityKeyByRunId.set(run.runId, run.identityKey);
  }

  const map = new Map<string, import('../../core/index').TierBAnnotation[]>();
  for (const annotation of tierBStore.list()) {
    const identityKey = identityKeyByRunId.get(annotation.runId);
    if (identityKey === undefined) {
      continue;
    }
    const existing = map.get(identityKey);
    if (existing !== undefined) {
      existing.push(annotation);
    } else {
      map.set(identityKey, [annotation]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/** Print the full categorized roster. */
function printInsights(ctx: CliContext, result: InsightsResult): void {
  const unused = result.agents.filter((a) => a.categories.includes('unused'));
  const failing = result.agents.filter((a) => a.categories.includes('failing'));
  const expensive = result.agents.filter((a) => a.categories.includes('expensive'));
  const healthy = result.agents.filter((a) => a.categories.length === 0);

  printSection(ctx, chalk.yellow('Unused agents'), unused);
  printSection(ctx, chalk.red('Failing agents'), failing);
  printSection(ctx, chalk.magenta('Expensive agents'), expensive);

  if (result.noHistory.length > 0) {
    ctx.out('');
    ctx.out(chalk.dim(`No history (${result.noHistory.length})`));
    for (const agent of result.noHistory) {
      ctx.out(`  ${agent.name}`);
    }
  }

  printSection(ctx, chalk.green('Healthy agents'), healthy);
}

/** Print a named section if there are agents in it. */
function printSection(ctx: CliContext, label: string, agents: readonly AgentInsight[]): void {
  if (agents.length === 0) {
    return;
  }
  ctx.out('');
  ctx.out(`${label} (${agents.length})`);
  for (const agent of agents) {
    const confidence = agent.lowConfidence ? chalk.dim(' (low confidence)') : '';
    ctx.out(`  ${agent.name}${confidence}`);
  }
}
