/**
 * Agent source model (spec Req 4).
 *
 * handler resolves run names against a configurable set of agent sources. The
 * MVP supports two: the user-level source (`~/.claude/agents`) and per-repo
 * sources (`<repo>/.claude/agents`). A source is anchored at a normalized
 * `root` (home dir or repo root) from which the conventional agents folder is
 * derived. The `root` is the `normalized-source-path` component of agent
 * identity (Req 8) and the value the cwd-nearest-ancestor rule (Task 6)
 * compares against.
 */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normalizePath } from '../paths';

export type SourceType = 'user' | 'repo';

export interface AgentSource {
  readonly type: SourceType;
  /** Normalized anchor: home dir for `user`, repo root for `repo`. */
  readonly root: string;
  /** Conventional agent-definitions folder, `<root>/.claude/agents`. */
  readonly agentsDir: string;
}

function agentsDirFor(root: string): string {
  return join(root, '.claude', 'agents');
}

/** The user-level source. Defaults to the current user's home directory. */
export function userSource(home: string = homedir()): AgentSource {
  const root = normalizePath(home);
  return { type: 'user', root, agentsDir: agentsDirFor(root) };
}

/** A per-repo source anchored at the repository root. */
export function repoSource(repoRoot: string): AgentSource {
  const root = normalizePath(repoRoot);
  return { type: 'repo', root, agentsDir: agentsDirFor(root) };
}

/**
 * The `*.md` definition stems in a source's agents dir; empty when the dir is
 * absent or unreadable (a source that has not been populated yet). Includes
 * builtin/plugin names — callers apply the user-authored-only denylist.
 */
export function enumerateDefinitionNames(source: AgentSource): string[] {
  let entries: string[];
  try {
    entries = readdirSync(source.agentsDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.slice(0, -'.md'.length));
}
