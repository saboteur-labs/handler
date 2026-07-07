/**
 * `tools` category static checks (feature-static-assessment FR-9, FR-10, FR-11).
 *
 * `tools/spawn-loop` is fleet-aware (it builds the whole fleet's `Agent(...)`
 * spawn graph); `tools/redundant-wildcard` and `tools/over-broad` are
 * single-agent checks that ignore `fleet`. All three are pure — no store
 * reads/writes, no file I/O, no network/LLM calls.
 */
import type { Finding, StaticCheck } from '../check';
import type { ParsedDefinition } from '../parse';

/** The plain tool-wildcard token, granting every non-spawn tool. */
const WILDCARD_TOOL = '*';

/** The wildcard spawn target, present in `spawnTargets` for an `Agent(*)` grant. */
const WILDCARD_SPAWN_TARGET = '*';

/**
 * Default `maxTools` threshold for `tools/over-broad` when policy `options`
 * does not configure one (FR-11). Chosen as a reasonable ceiling for a
 * hand-authored tool list before it likely represents over-broad access
 * rather than a deliberately scoped one; configurable via policy `options`.
 */
export const DEFAULT_MAX_TOOLS = 10;

/** True for any `Agent(...)` grant token, including the wildcard form. */
function isSpawnGrantToken(token: string): boolean {
  return /^Agent\(.*\)$/.test(token);
}

/**
 * Build the fleet-wide spawn graph: definition name -> outgoing spawn-target
 * names, excluding the wildcard target `'*'` (a wildcard spawn grant means
 * "may spawn anything" and does not name a specific agent, so it cannot
 * participate in a concrete cycle or count as a self-spawn edge). Agents
 * without a `name` are skipped as graph nodes (they cannot be a spawn target
 * by name, and cannot meaningfully be checked as a source either).
 *
 * Spawn targets reference agents by bare name, so the graph is keyed by name.
 * When two definitions share a name (the same-name-across-sources case the
 * fleet checks also handle), their edge lists are MERGED (deduped union)
 * rather than one silently overwriting the other — a conservative choice that
 * cannot miss a real self-spawn/cycle (at worst it over-reports for a
 * genuinely ambiguous same-name pair, which is itself a `duplicate-definition`
 * smell).
 */
function buildSpawnGraph(
  fleet: readonly ParsedDefinition[],
): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, string[]>();
  for (const def of fleet) {
    if (def.name === undefined) {
      continue;
    }
    const edges = [...def.scope.spawnTargets].filter((target) => target !== WILDCARD_SPAWN_TARGET);
    const existing = graph.get(def.name);
    if (existing === undefined) {
      graph.set(def.name, [...edges]);
    } else {
      for (const edge of edges) {
        if (!existing.includes(edge)) {
          existing.push(edge);
        }
      }
    }
  }
  return graph;
}

/**
 * Find a path from `start` back to itself following outgoing spawn edges
 * (length >= 2, i.e. at least one hop), or `null` if `start` does not
 * participate in any cycle. A node participates in a cycle if and only if it
 * can reach itself again via one or more edges, so this single search covers
 * both self-spawns (`path.length === 2` with both ends equal to `start`) and
 * longer cycles. Deterministic DFS with a global "seen" set (excluding
 * `start`, which we want to revisit) — safe on a finite, possibly cyclic
 * graph.
 */
function findCyclePath(
  graph: ReadonlyMap<string, readonly string[]>,
  start: string,
): readonly string[] | null {
  const stack: { readonly node: string; readonly path: readonly string[] }[] = (
    graph.get(start) ?? []
  ).map((next) => ({ node: next, path: [start, next] }));
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      break;
    }
    if (current.node === start) {
      return current.path;
    }
    if (seen.has(current.node)) {
      continue;
    }
    seen.add(current.node);
    for (const next of graph.get(current.node) ?? []) {
      stack.push({ node: next, path: [...current.path, next] });
    }
  }
  return null;
}

/**
 * `tools/spawn-loop` (error): fires when `agent` participates in a cycle in
 * the fleet-wide `Agent(...)` spawn graph, or self-spawns (grants itself as a
 * spawn target). Since `runChecks` calls `check.run(agent, fleet)` once per
 * agent, this check's contract is per-agent-call: each cycle member gets its
 * own finding when it is the `agent` argument, rather than one global finding
 * per cycle.
 */
export const spawnLoopCheck: StaticCheck = {
  id: 'tools/spawn-loop',
  category: 'tools',
  severity: 'error',
  run: (agent, fleet): Finding[] => {
    if (agent.name === undefined) {
      return [];
    }
    const graph = buildSpawnGraph(fleet);
    const path = findCyclePath(graph, agent.name);
    if (path === null) {
      return [];
    }
    const isSelfSpawn = path.length === 2 && path[0] === path[1];
    const message = isSelfSpawn
      ? `self-spawn: "${agent.name}" grants itself as a spawn target (Agent(${agent.name}))`
      : `spawn cycle: ${path.join(' -> ')}`;
    return [{ check: 'tools/spawn-loop', severity: 'error', message }];
  },
};

/**
 * `tools/redundant-wildcard` (warn): fires when a wildcard grant is present
 * alongside one or more explicitly named grants "of the same family" (FR-10).
 *
 * Interpretation (judgment call): a definition's `tools:` list can carry two
 * independent families of grant — plain tool names (with `'*'` as that
 * family's wildcard) and `Agent(...)` spawn grants (with `Agent(*)` as that
 * family's wildcard). Within each family, a wildcard already covers every
 * named member of that same family, so any explicitly named member alongside
 * the family's wildcard is redundant. We deliberately do NOT build a finer
 * tool-family taxonomy (e.g. distinguishing "file tools" from "search
 * tools") — that would be a much larger, more speculative undertaking than
 * FR-10 calls for, and "any named grant alongside its family's wildcard is
 * redundant" is the simplest defensible reading of the requirement.
 */
export const redundantWildcardCheck: StaticCheck = {
  id: 'tools/redundant-wildcard',
  category: 'tools',
  severity: 'warn',
  run: (agent): Finding[] => {
    const granted = [...agent.scope.granted];
    const findings: Finding[] = [];

    const namedTools = granted.filter(
      (token) => token !== WILDCARD_TOOL && !isSpawnGrantToken(token),
    );
    if (granted.includes(WILDCARD_TOOL) && namedTools.length > 0) {
      findings.push({
        check: 'tools/redundant-wildcard',
        severity: 'warn',
        message: `wildcard tool grant (*) makes explicitly named tool grant(s) redundant: ${namedTools.join(', ')}`,
        suggestion:
          'remove the named tool grants, or replace the wildcard with only the tools actually needed',
      });
    }

    // Reason over the structured spawn targets (normalized: `Agent( * )` ->
    // `*`, `Agent(a, b)` -> a, b) rather than the raw granted token strings,
    // so whitespace/formatting variants of a wildcard spawn grant are caught.
    const namedSpawnTargets = [...agent.scope.spawnTargets].filter(
      (target) => target !== WILDCARD_SPAWN_TARGET,
    );
    if (agent.scope.spawnTargets.has(WILDCARD_SPAWN_TARGET) && namedSpawnTargets.length > 0) {
      findings.push({
        check: 'tools/redundant-wildcard',
        severity: 'warn',
        message: `wildcard spawn grant (Agent(*)) makes explicitly named spawn grant(s) redundant: ${namedSpawnTargets.join(', ')}`,
        suggestion:
          'remove the named Agent(...) grants, or replace Agent(*) with only the agents actually needed',
      });
    }

    return findings;
  },
};

/**
 * `tools/over-broad` (info): fires when `agent` grants a wildcard tool scope
 * (either family's wildcard), or when its granted-tool count exceeds a
 * configurable `maxTools` threshold read from policy `options` (falling back
 * to `DEFAULT_MAX_TOOLS` when absent or not a number).
 */
export const overBroadCheck: StaticCheck = {
  id: 'tools/over-broad',
  category: 'tools',
  severity: 'info',
  run: (agent, _fleet, options): Finding[] => {
    const granted = agent.scope.granted;
    const hasWildcard =
      granted.has(WILDCARD_TOOL) || agent.scope.spawnTargets.has(WILDCARD_SPAWN_TARGET);
    // Count only real tools — exclude the wildcard token and any `Agent(...)`
    // spawn grants, which are spawn breadth, not tool breadth (and have their
    // own `spawn-loop` check). Counting them here would misreport a
    // single-tool agent with many spawn grants as "over-broad".
    const toolCount = [...granted].filter(
      (token) => token !== WILDCARD_TOOL && !isSpawnGrantToken(token),
    ).length;
    const maxToolsOption = options?.maxTools;
    const maxTools = typeof maxToolsOption === 'number' ? maxToolsOption : DEFAULT_MAX_TOOLS;
    const exceedsMax = toolCount > maxTools;

    if (!hasWildcard && !exceedsMax) {
      return [];
    }

    const message = hasWildcard
      ? 'wildcard tool scope grants unrestricted access (over-broad)'
      : `grants ${toolCount} tools, exceeding the configured maximum of ${maxTools}`;
    return [{ check: 'tools/over-broad', severity: 'info', message }];
  },
};

/** The `tools` category's checks, in a stable registration order. */
export const TOOLS_CHECKS: readonly StaticCheck[] = [
  spawnLoopCheck,
  redundantWildcardCheck,
  overBroadCheck,
];
