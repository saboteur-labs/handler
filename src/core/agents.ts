/**
 * Agent roster summaries (spec Req 10).
 *
 * Groups attributed runs by agent identity so the CLI can list each agent the
 * user authored with a run count. Identity components are recovered from the
 * `identityKey` (the pinned `["type","path","name"]` contract), so summaries
 * stay distinct for identically-named agents in different sources.
 */
import type { AgentIdentity } from './identity';
import type { SourceType } from './sources/source';
import type { Run } from './run';

export interface AgentSummary {
  readonly identityKey: string;
  readonly name: string;
  readonly sourceType: SourceType;
  readonly sourcePath: string;
  readonly runCount: number;
}

/** Optional disambiguator when a name matches more than one source. */
export interface SourceFilter {
  readonly type?: SourceType;
  readonly path?: string;
}

/**
 * Outcome of resolving a CLI-supplied agent name to a single identity.
 * `ambiguous` carries the candidate summaries so the CLI can list sources;
 * `unknown` means no attributed run names the agent.
 */
export type AgentResolution =
  | { readonly kind: 'found'; readonly identity: AgentIdentity; readonly summary: AgentSummary }
  | { readonly kind: 'ambiguous'; readonly matches: AgentSummary[] }
  | { readonly kind: 'unknown' };

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

/**
 * Resolve a CLI-supplied agent `name` (optionally narrowed by `source`) to a
 * single agent identity, working over the attributed runs rather than live
 * definition files — so an agent whose definition was renamed or deleted still
 * resolves as long as it has history (Req 21). Returns `ambiguous` when the
 * name matches multiple sources and `unknown` when nothing matches, leaving the
 * CLI to format the guidance (Req 6).
 */
export function resolveAgentByName(
  runs: readonly Run[],
  name: string,
  source?: SourceFilter,
): AgentResolution {
  const matches = summarizeAgents(runs).filter(
    (agent) =>
      agent.name === name &&
      (source?.type === undefined || agent.sourceType === source.type) &&
      (source?.path === undefined || agent.sourcePath === source.path),
  );

  if (matches.length === 0) {
    return { kind: 'unknown' };
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', matches };
  }
  const [summary] = matches as [AgentSummary];
  const identity: AgentIdentity = {
    sourceType: summary.sourceType,
    sourcePath: summary.sourcePath,
    name: summary.name,
  };
  return { kind: 'found', identity, summary };
}
