/**
 * Path normalization shared across the core (sources, identity, resolution).
 *
 * Normalization must be stable and done once: agent identity and the
 * cwd-nearest-ancestor rule (Reqs 4, 8) compare source paths, so two spellings
 * of the same location must reduce to a single canonical string.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolve `p` to a canonical absolute path: absolute (relative to the current
 * working directory), with `.`/`..` and trailing slashes collapsed, and
 * symlinks resolved when the path exists. For a path that does not exist,
 * symlinks cannot be resolved, so the lexically-resolved absolute path is
 * returned. Does not expand a leading `~` — callers pass real paths (the
 * user-level source derives home via `os.homedir()`).
 */
export function normalizePath(p: string): string {
  const absolute = resolve(p);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}
