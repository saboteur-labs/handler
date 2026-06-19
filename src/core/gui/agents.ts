/**
 * GUI core API — agent roster.
 *
 * `listAgents` returns the typed data the GUI agent-list endpoint serializes.
 * It is a pure function over its `runs` input — no I/O, no stores. The GUI
 * server passes already-ingested runs so data-access stays in the call site.
 *
 * All agent-enumeration logic is delegated to `summarizeAgents`; this module
 * only maps the summary fields to the `AgentListEntry` shape and derives
 * `lastRunDate` from the per-agent runs.
 */
import type { Run } from '../run';
import type { SourceType } from '../sources/source';
import { summarizeAgents } from '../agents';

export interface AgentListEntry {
  readonly name: string;
  readonly sourceType: SourceType;
  readonly sourcePath: string;
  readonly identityKey: string;
  /** ISO timestamp of the most recent run, or null when no run has a timestamp. */
  readonly lastRunDate: string | null;
}

/**
 * Return a list of all distinct agents that appear in `runs`, sorted by name.
 *
 * Each entry carries the agent identity fields and the timestamp of the most
 * recent run. Agents with no timestamped runs get `lastRunDate: null`.
 */
export function listAgents(runs: readonly Run[]): AgentListEntry[] {
  const summaries = summarizeAgents(runs);

  return summaries.map((summary) => {
    const agentRuns = runs.filter((r) => r.identityKey === summary.identityKey);
    const lastRunDate = latestTimestamp(agentRuns);

    return {
      name: summary.name,
      sourceType: summary.sourceType,
      sourcePath: summary.sourcePath,
      identityKey: summary.identityKey,
      lastRunDate: lastRunDate ?? null,
    };
  });
}

function latestTimestamp(runs: readonly Run[]): string | undefined {
  let latest: string | undefined;
  for (const { timestamp } of runs) {
    if (timestamp !== undefined && (latest === undefined || timestamp > latest)) {
      latest = timestamp;
    }
  }
  return latest;
}
