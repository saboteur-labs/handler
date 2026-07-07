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
import type { Dirent } from 'node:fs';
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

/** Recursively collect `*.md` definition-file basename stems under `dir`. */
function collectDefinitionStems(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const stems: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Recurse into real subdirectories only — not symlinked dirs, which
      // could otherwise form a cycle.
      stems.push(...collectDefinitionStems(join(dir, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      // Any non-directory `.md`, including symlinks to definition files (a
      // broken symlink is enumerated here but resolves to an orphan on load).
      stems.push(entry.name.slice(0, -'.md'.length));
    }
  }
  return stems;
}

/**
 * The `*.md` definition stems in a source's agents dir; empty when the dir is
 * absent or unreadable (a source that has not been populated yet). Includes
 * builtin/plugin names — callers apply the user-authored-only denylist.
 *
 * Discovery is recursive: Claude Code finds `.claude/agents/**\/*.md`, so
 * definitions may live in organizational subfolders. Identity is the (basename)
 * name, so a stem appearing in more than one subfolder — itself a Claude Code
 * name collision — is deduped to a single entry.
 */
export function enumerateDefinitionNames(source: AgentSource): string[] {
  return [...new Set(collectDefinitionStems(source.agentsDir))];
}
