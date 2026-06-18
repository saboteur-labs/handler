/**
 * `handler note` commands (spec Reqs 20, 21).
 *
 * Thin wrappers over the core note store. `note set` writes one freeform note
 * per agent (supplied via `--body` or piped on stdin); `note show` reads it
 * back. The note keys on the agent identity (Req 8) resolved from attributed
 * runs, so it survives a renamed, edited, or deleted definition (Req 21). All
 * resolution/persistence lives in core; this layer parses args and formats.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import type { AgentIdentity, AgentSummary } from '../../core/index';
import {
  identityKey,
  ingest,
  NoteStore,
  resolveAgentByName,
  SourceRegistry,
} from '../../core/index';
import type { CliContext } from './source';

interface SetOptions {
  readonly body?: string;
}

export function registerNoteCommand(program: Command, ctx: CliContext): void {
  const note = program.command('note').description('Manage freeform notes on your agents');

  note
    .command('set <agent>')
    .description("Set an agent's note (from --body, or piped on stdin)")
    .option('-b, --body <text>', 'note body; if omitted, read from stdin')
    .action(async (name: string, options: SetOptions) => {
      const identity = resolveOrThrow(ctx, name);
      const body = options.body ?? (await ctx.readStdin()).replace(/\r?\n$/, '');
      new NoteStore(ctx.noteStorePath).set(identityKey(identity), body);
      ctx.out(chalk.green(`Saved note for ${name}.`));
    });

  note
    .command('show <agent>')
    .description("Show an agent's note")
    .action((name: string) => {
      const identity = resolveOrThrow(ctx, name);
      const stored = new NoteStore(ctx.noteStorePath).get(identityKey(identity));
      ctx.out(stored === undefined ? `${name}: no note` : stored.body);
    });
}

/**
 * Resolve an agent name to a single identity, or print CLI guidance and throw
 * so the command exits non-zero (Req 6) — without writing anything.
 */
function resolveOrThrow(ctx: CliContext, name: string): AgentIdentity {
  const registry = new SourceRegistry(ctx.registryPath);
  const runs = ingest({
    sources: registry.list(),
    projectsRoot: ctx.projectsRoot,
    storePath: ctx.storePath,
  });
  const result = resolveAgentByName(runs, name);

  if (result.kind === 'found') {
    return result.identity;
  }
  if (result.kind === 'ambiguous') {
    printAmbiguous(ctx, name, result.matches);
    throw new Error(`Agent "${name}" is ambiguous — specify a source.`);
  }
  ctx.out(`No runs found for agent "${name}".`);
  throw new Error(`Unknown agent "${name}".`);
}

function printAmbiguous(ctx: CliContext, name: string, matches: readonly AgentSummary[]): void {
  ctx.out(`Multiple agents named "${name}" — specify a source:`);
  for (const match of matches) {
    ctx.out(`  ${match.sourceType.padEnd(4)}  ${match.sourcePath}`);
  }
}
