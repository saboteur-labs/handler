/**
 * Run → agent-identity resolution (spec Req 8, with Reqs 3 & 4).
 *
 * Attribution disambiguation: among registered repo sources whose root is an
 * ancestor of the run's recorded `cwd`, the nearest (deepest) wins; with no
 * repo match, fall back to the user-level source. Built-in/plugin names are
 * excluded entirely (Req 3) and resolve to null.
 */
import { isAbsolute, relative } from 'node:path';

import { isBuiltinAgent } from './denylist';
import { agentIdentity, type AgentIdentity } from './identity';
import { normalizePath } from './paths';
import type { AgentSource } from './sources/source';

/**
 * Resolve a run's agent `name` and recorded `cwd` to a single agent identity, or
 * `null` when the name is a built-in/plugin agent (excluded) or no source
 * matches. `sources` is the registered set (e.g. `registry.list()`).
 */
export function resolveAgent(
  name: string,
  cwd: string,
  sources: readonly AgentSource[],
): AgentIdentity | null {
  if (isBuiltinAgent(name)) {
    return null;
  }
  const target = normalizePath(cwd);
  const nearestRepo = sources
    .filter((source) => source.type === 'repo' && isWithin(source.root, target))
    .reduce<AgentSource | null>(
      (nearest, source) =>
        nearest === null || source.root.length > nearest.root.length ? source : nearest,
      null,
    );
  const matched = nearestRepo ?? sources.find((source) => source.type === 'user') ?? null;
  return matched ? agentIdentity(matched, name) : null;
}

/** True when `descendant` is `ancestor` or lies within its subtree. */
function isWithin(ancestor: string, descendant: string): boolean {
  const rel = relative(ancestor, descendant);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
