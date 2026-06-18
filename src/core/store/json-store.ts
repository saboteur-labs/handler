/**
 * Minimal JSON file persistence.
 *
 * The MVP's source registry (and, later, Feature 2's run store) persist small
 * documents to local JSON files. This is the single persistence boundary —
 * keep it narrow so the backing implementation (e.g. SQLite) can change without
 * touching callers. Synchronous: the CLI runs one command and exits.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Read and parse JSON from `filePath`. Returns `fallback` when the file does not
 * exist (normal first-run). Throws on a corrupt/unreadable file rather than
 * silently discarding data.
 */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) {
      return fallback;
    }
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Corrupt JSON store at ${filePath}: ${(err as Error).message}`);
  }
}

/** Serialize `data` as pretty JSON to `filePath`, creating parent directories. */
export function writeJsonFile(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
