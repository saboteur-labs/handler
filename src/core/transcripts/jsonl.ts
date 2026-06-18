/**
 * JSONL reader primitive (spec Reqs 1, 7).
 *
 * Claude Code transcripts are JSON Lines — one JSON object per line. This
 * reader is the lowest layer of ingestion: it turns a file into parsed
 * entries and nothing more. It carries no knowledge of transcript shapes and
 * never throws on bad input — a blank or malformed line is skipped so a single
 * corrupt entry can't abort a whole transcript. Shape guarding happens one
 * layer up (extraction), where missing/unexpected fields are handled
 * deliberately.
 */
import { readFileSync } from 'node:fs';

/**
 * Read and parse a `.jsonl` file into entries, one per valid line. Blank lines
 * are skipped, malformed lines are dropped, and a missing file yields `[]`.
 * Returns `unknown[]` by default so callers narrow shapes explicitly.
 */
export function readJsonl<T = unknown>(filePath: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) {
      return [];
    }
    throw err;
  }

  const entries: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip a malformed line rather than aborting the whole transcript.
    }
  }
  return entries;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
