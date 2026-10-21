/**
 * Regenerable ingest extraction cache (subagent-run-capture FR-36).
 *
 * Ingest used to re-parse every transcript on every read. This cache records,
 * per transcript file, what ingest extracts from it: the latest task-notification
 * status per agentId, the legacy `toolUseResult` run summaries, and (for
 * sidechain files) the first cwd/sessionId/timestamp facts. An entry is reused
 * only while the file's size and mtimeMs are unchanged. Like the run store it is
 * disposable: a missing, corrupt or wrong-version file degrades to empty and the
 * next ingest simply re-parses. It sits beside the run store so a test (or an
 * embedder) that relocates the run store relocates the cache with it.
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { RawRun } from '../transcripts/extract';
import { readJsonFile, writeJsonFile } from './json-store';
import { defaultRunStorePath } from './run-store';

/** Cache schema version; a file under any other version is discarded. */
export const INGEST_CACHE_VERSION = 1;

/** First facts found in a sidechain file (mirrors `TranscriptFacts`). */
export interface CachedFacts {
  readonly cwd?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly timestamp?: string | undefined;
}

/** Everything ingest extracts from one transcript file. */
export interface CachedFile {
  readonly size: number;
  readonly mtimeMs: number;
  /** `[agentId, latest status in this file]`, in first-seen order. */
  readonly statuses: readonly (readonly [string, string])[];
  /** Legacy run summaries from `extractRuns`, in entry order. */
  readonly runs: readonly RawRun[];
  /** Present for sidechain files only. */
  readonly facts?: CachedFacts;
}

interface IngestCacheFile {
  readonly version: number;
  readonly files: Record<string, CachedFile>;
}

/** Cache location for a given run-store path: `ingest-cache.json` beside it. */
export function ingestCachePathFor(runStorePath: string = defaultRunStorePath()): string {
  return join(dirname(runStorePath), 'ingest-cache.json');
}

/** Default cache location: `~/.handler/ingest-cache.json`. */
export function defaultIngestCachePath(): string {
  return join(homedir(), '.handler', 'ingest-cache.json');
}

export class IngestCache {
  private files: Record<string, CachedFile>;
  private dirty = false;

  constructor(private readonly filePath: string) {
    this.files = loadFiles(filePath);
  }

  /** The cached extraction for `path`, only when its size and mtime still match. */
  get(path: string, size: number, mtimeMs: number): CachedFile | undefined {
    const hit = this.files[path];
    return hit !== undefined && hit.size === size && hit.mtimeMs === mtimeMs ? hit : undefined;
  }

  /** The cached entry for `path` regardless of freshness (for reading facts). */
  peek(path: string): CachedFile | undefined {
    return this.files[path];
  }

  set(path: string, entry: CachedFile): void {
    this.files[path] = entry;
    this.dirty = true;
  }

  /** Drop entries for files not in `existing`. */
  prune(existing: ReadonlySet<string>): void {
    for (const path of Object.keys(this.files)) {
      if (!existing.has(path)) {
        delete this.files[path];
        this.dirty = true;
      }
    }
  }

  /** Write the cache if anything changed. Failure to write is never fatal. */
  save(): void {
    if (!this.dirty) return;
    try {
      const file: IngestCacheFile = { version: INGEST_CACHE_VERSION, files: this.files };
      writeJsonFile(this.filePath, file);
      this.dirty = false;
    } catch {
      // The cache is an optimisation; an unwritable location must not fail ingest.
    }
  }
}

function loadFiles(filePath: string): Record<string, CachedFile> {
  let raw: unknown;
  try {
    raw = readJsonFile<unknown>(filePath, null);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null) return {};
  const file = raw as { version?: unknown; files?: unknown };
  if (file.version !== INGEST_CACHE_VERSION) return {};
  if (typeof file.files !== 'object' || file.files === null || Array.isArray(file.files)) return {};
  const files: Record<string, CachedFile> = {};
  for (const [path, entry] of Object.entries(file.files as Record<string, unknown>)) {
    if (isCachedFile(entry)) files[path] = entry;
  }
  return files;
}

function isCachedFile(value: unknown): value is CachedFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.size === 'number' &&
    typeof v.mtimeMs === 'number' &&
    Array.isArray(v.statuses) &&
    Array.isArray(v.runs)
  );
}
