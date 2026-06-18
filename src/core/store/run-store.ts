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
  readonly version: 1;
  readonly runs: Run[];
}

const STORE_VERSION = 1;

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

  /** All stored runs, in insertion order. */
  list(): Run[] {
    return [...this.runs];
  }

  /** Runs belonging to one agent, by its `identityKey`. */
  forAgent(identityKey: string): Run[] {
    return this.runs.filter((run) => run.identityKey === identityKey);
  }

  private persist(): void {
    const file: RunStoreFile = { version: STORE_VERSION, runs: this.runs };
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
  const runs = (raw as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) {
    return [];
  }
  return runs.filter(isRun);
}

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.identityKey === 'string' && typeof candidate.runId === 'string';
}
