/**
 * Agent roster summaries (spec Req 10).
 *
 * Groups attributed runs by agent identity so the CLI can list each agent the
 * user authored with a run count. Identity components are recovered from the
 * `identityKey` (the pinned `["type","path","name"]` contract), so summaries
 * stay distinct for identically-named agents in different sources.
 */
import type { SourceType } from './sources/source';
import type { Run } from './run';

export interface AgentSummary {
  readonly identityKey: string;
  readonly name: string;
  readonly sourceType: SourceType;
  readonly sourcePath: string;
  readonly runCount: number;
}

/** One summary per distinct agent, sorted by name then source path. */
export function summarizeAgents(runs: readonly Run[]): AgentSummary[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    counts.set(run.identityKey, (counts.get(run.identityKey) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([identityKey, runCount]) => {
      const [sourceType, sourcePath, name] = JSON.parse(identityKey) as [
        SourceType,
        string,
        string,
      ];
      return { identityKey, name, sourceType, sourcePath, runCount };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.sourcePath.localeCompare(b.sourcePath));
}
