/**
 * Definition snapshot loader (spec Req 9).
 *
 * handler snapshots an agent's definition *content* at the time of each run so
 * history survives renames, edits, and deletions — a path reference would
 * break the moment the source file changes. This reads the current content of
 * the definition named `name`; a missing file yields `null`, the orphan signal
 * that lets a run be kept-and-tagged rather than dropped (Req 6).
 *
 * `.claude/agents` may organize definitions into subfolders (Claude Code
 * discovers them recursively), so this tries the flat `<agentsDir>/<name>.md`
 * first and falls back to searching subfolders for a `<name>.md` — the run's
 * identity name is the basename stem, not the subpath.
 */
import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSource } from './sources/source';

/**
 * Return the content of the agent definition named `name` in `source`, or
 * `null` when no such file exists (orphan). Non-ENOENT read errors propagate —
 * a permissions problem is not an orphan.
 */
export function loadDefinitionSnapshot(source: AgentSource, name: string): string | null {
  const flat = readOrUndefined(join(source.agentsDir, `${name}.md`));
  if (flat !== undefined) {
    return flat;
  }
  return findNestedDefinition(source.agentsDir, `${name}.md`) ?? null;
}

/** Read a file, returning `undefined` on ENOENT and rethrowing other errors. */
function readOrUndefined(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (isNotFound(err)) {
      return undefined;
    }
    throw err;
  }
}

/** Depth-first search `dir`'s subfolders for a file named `fileName`, returning its content. */
function findNestedDefinition(dir: string, fileName: string): string | undefined {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findNestedDefinition(join(dir, entry.name), fileName);
      if (found !== undefined) {
        return found;
      }
    } else if (entry.name === fileName) {
      const content = readOrUndefined(join(dir, entry.name));
      if (content !== undefined) {
        return content;
      }
    }
  }
  return undefined;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
