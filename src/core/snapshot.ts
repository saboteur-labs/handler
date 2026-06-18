/**
 * Definition snapshot loader (spec Req 9).
 *
 * handler snapshots an agent's definition *content* at the time of each run so
 * history survives renames, edits, and deletions — a path reference would
 * break the moment the source file changes. This reads the current content of
 * `<source.agentsDir>/<name>.md`; a missing file yields `null`, the orphan
 * signal that lets a run be kept-and-tagged rather than dropped (Req 6).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSource } from './sources/source';

/**
 * Return the content of the agent definition named `name` in `source`, or
 * `null` when no such file exists (orphan). Non-ENOENT read errors propagate —
 * a permissions problem is not an orphan.
 */
export function loadDefinitionSnapshot(source: AgentSource, name: string): string | null {
  const file = join(source.agentsDir, `${name}.md`);
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (isNotFound(err)) {
      return null;
    }
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
