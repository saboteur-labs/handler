/**
 * Append-only run store (spec Reqs 7, 9; supports 10, 11).
 *
 * Persists attributed `Run` records keyed by `(identityKey, runId)`. Ingestion
 * is idempotent: re-adding a run already present is a no-op, so re-reading the
 * same transcripts never duplicates history. Mirrors `SourceRegistry`: the file
 * is read once per instance, stored under a versioned envelope, and a
 * structurally-invalid file degrades to empty rather than throwing.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Run } from '../run';
import { readJsonFile, writeJsonFile } from './json-store';

interface RunStoreFile {
  readonly version: number;
  readonly runs: Run[];
}

/**
 * Run-store schema version. The store is a regenerable cache rebuilt from
 * transcripts, so a store written under a different version is discarded rather
 * than migrated. Bump this whenever the stored `Run` shape changes (it became
 * 2 when runs gained `cwd`/`sessionId`/`sidechainPath` for scoring, and 3 when
 * they gained per-run `telemetry`). Bumped to 5 to cover: (4) the upsert-capable
 * RunStore baseline required by the SubagentStop hook, and (5) the `source` field
 * (`'hook' | 'transcript' | undefined`) added to `Run` in the hook ingestion task.
 * Bumped to 6 to cover the `parentAgentId?: string` field added to `Run` for
 * nested subagent capture (V1 Feature 7).
 * The bump is also the backfill trigger: a stale store is discarded and the next
 * ingest rebuilds it from transcripts with the new fields populated for every run
 * whose sub-transcript still exists.
 */
export const RUN_STORE_VERSION = 6;

/** Default run-store location: `~/.handler/runs.json`. */
export function defaultRunStorePath(): string {
  return join(homedir(), '.handler', 'runs.json');
}

export class RunStore {
  private readonly filePath: string;
  private readonly runs: Run[];

  constructor(filePath: string = defaultRunStorePath()) {
    this.filePath = filePath;
    this.runs = extractRuns(readJsonFile<unknown>(filePath, null));
  }

  /** Append a run. Re-adding the same `(identityKey, runId)` is a no-op. */
  add(run: Run): void {
    if (this.runs.some((existing) => isSameRun(existing, run))) {
      return;
    }
    this.runs.push(run);
    this.persist();
  }

  /**
   * Insert or replace a run. If a record with the same `(identityKey, runId)`
   * already exists it is replaced in-place (preserving array order); otherwise
   * the run is appended. Unlike `add`, an existing record is always overwritten.
   */
  upsert(run: Run): void {
    const index = this.runs.findIndex((existing) => isSameRun(existing, run));
    if (index === -1) {
      this.runs.push(run);
    } else {
      this.runs[index] = run;
    }
    this.persist();
  }

  /** All stored runs, in insertion order. */
  list(): Run[] {
    return [...this.runs];
  }

  /** Runs belonging to one agent, by its `identityKey`. */
  forAgent(identityKey: string): Run[] {
    return this.runs.filter((run) => run.identityKey === identityKey);
  }

  /** Look up a single run by `(identityKey, runId)`, or `undefined` if absent. */
  forRun(identityKey: string, runId: string): Run | undefined {
    return this.runs.find((run) => run.identityKey === identityKey && run.runId === runId);
  }

  private persist(): void {
    const file: RunStoreFile = { version: RUN_STORE_VERSION, runs: this.runs };
    writeJsonFile(this.filePath, file);
  }
}

function isSameRun(a: Run, b: Run): boolean {
  return a.identityKey === b.identityKey && a.runId === b.runId;
}

function extractRuns(raw: unknown): Run[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const file = raw as { version?: unknown; runs?: unknown };
  // Discard a store written under a different schema — it is a rebuildable cache.
  if (file.version !== RUN_STORE_VERSION || !Array.isArray(file.runs)) {
    return [];
  }
  return file.runs.filter(isRun);
}

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.identityKey === 'string' && typeof candidate.runId === 'string';
}
