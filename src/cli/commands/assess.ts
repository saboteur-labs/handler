/**
 * `handler assess` command family (feature-static-assessment FR-1, FR-21,
 * FR-22, FR-23).
 *
 * Thin wrapper: builds `StaticAssessOptions` from `CliContext` and CLI flags,
 * calls the core `assess()` orchestrator, and renders its report. All check
 * logic lives in core (`src/core/assess/`) — this layer only formats output
 * and decides the process exit code from the ALREADY-COMPUTED report; it
 * never runs, selects, or reasons about individual checks beyond passing a
 * `categories` filter through to core.
 *
 * Bare `assess` runs every category; `assess tools`/`assess prompt`/
 * `assess fleet` each run exactly one, matching the `source`/`note`
 * subcommand-group style. Category scoping is done by filtering which check
 * descriptors `assess()` runs (via `StaticAssessOptions.categories`), never
 * by narrowing the fleet — fleet-level checks always see every sibling
 * definition regardless of which category was requested.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

import type {
  Category,
  Finding,
  Severity,
  StaticAssessReport,
  SuppressedSummary,
} from '../../core/index';
import { assess, reportTripsThreshold, SourceRegistry } from '../../core/index';
import { compareBySeverity, formatFinding } from '../format';
import type { CliContext } from './source';

const CATEGORIES: readonly Category[] = ['tools', 'prompt', 'fleet'];
const SEVERITIES: readonly Severity[] = ['error', 'warn', 'info'];

interface AssessCommandOptions {
  readonly all?: boolean;
  readonly failOn?: string;
}

/** Attach the two flags shared by every `assess`/`assess <category>` invocation. */
function withAssessOptions(command: Command): Command {
  return command
    .option('--all', 'also show suppressed findings')
    .option('--fail-on <severity>', 'minimum severity that triggers a non-zero exit', 'error');
}

export function registerAssessCommand(program: Command, ctx: CliContext): void {
  const assessCommand = withAssessOptions(
    program
      .command('assess')
      .description('Statically assess your agent definitions (tools/prompt/fleet checks)'),
  ).action((options: AssessCommandOptions) => {
    runAssess(ctx, undefined, options);
  });

  for (const category of CATEGORIES) {
    withAssessOptions(
      assessCommand.command(category).description(`Run only the ${category} category checks`),
    ).action((options: AssessCommandOptions) => {
      runAssess(ctx, category, options);
    });
  }
}

/**
 * Shared handler for the bare `assess` command and each `assess <category>`
 * subcommand: builds options, calls core `assess()`, renders the report, and
 * sets the process exit code from `--fail-on`.
 */
function runAssess(
  ctx: CliContext,
  category: Category | undefined,
  options: AssessCommandOptions,
): void {
  const failOn = validateFailOn(options.failOn ?? 'error');
  const registry = new SourceRegistry(ctx.registryPath);
  const report = assess({
    sources: registry.list(),
    userConfigPath: ctx.userConfigPath,
    categories: category === undefined ? undefined : [category],
  });

  printReport(report, ctx.out, options.all ?? false);

  // Domain decision (core); the CLI only maps it to a process exit code, via
  // the run-scoped exit-code channel rather than the global `process.exitCode`.
  if (reportTripsThreshold(report, failOn)) {
    ctx.setExitCode(1);
  }
}

function validateFailOn(value: string): Severity {
  if ((SEVERITIES as readonly string[]).includes(value)) {
    return value as Severity;
  }
  throw new Error(`Invalid --fail-on "${value}". Use one of: ${SEVERITIES.join(', ')}.`);
}

function printReport(
  report: StaticAssessReport,
  out: (line: string) => void,
  showAll: boolean,
): void {
  if (report.agents.length === 0) {
    out('No agent definitions assessed.');
  }
  for (const agent of report.agents) {
    out(`${agent.identity.sourceType.padEnd(4)}  ${chalk.bold(agent.identity.name)}`);
    if (agent.orphan) {
      out('  definition not found (orphan) — skipped');
      continue;
    }
    if (agent.findings.length === 0) {
      out(chalk.green('  no findings'));
    }
    printFindings(agent.findings, out, false);
    if (showAll) {
      printFindings(agent.suppressedFindings, out, true);
    }
  }
  out(suppressedFooter(report.suppressedSummary));
}

function printFindings(
  findings: readonly Finding[],
  out: (line: string) => void,
  suppressed: boolean,
): void {
  const ordered = [...findings].sort(compareBySeverity);
  for (const finding of ordered) {
    for (const line of formatFinding(finding, suppressed)) {
      out(line);
    }
  }
}

function suppressedFooter(summary: SuppressedSummary): string {
  if (summary.count === 0) {
    return chalk.dim('suppressed: 0');
  }
  return chalk.dim(`suppressed: ${summary.count} (${summary.checkIds.join(', ')})`);
}
