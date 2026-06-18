/**
 * Versioned score-annotation store (spec Req 12).
 *
 * Persists deterministic scores as annotations keyed by `(runId,
 * rubricVersion)`. Storing the rubric version means a rubric change adds a new
 * annotation rather than overwriting the old one, so prior scores survive — and
 * scoring can skip a run already scored under the current rubric. Mirrors
 * `RunStore`: versioned `{version:1, annotations:[…]}` envelope via `json-store`,
 * read once per instance, structurally-invalid file degrades to empty.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Score } from '../scoring/rubric';
import { readJsonFile, writeJsonFile } from './json-store';

export interface ScoreAnnotation {
  readonly runId: string;
  readonly score: Score;
}

interface ScoreStoreFile {
  readonly version: number;
  readonly annotations: ScoreAnnotation[];
}

/**
 * Score-store schema version. Like the run store, this is a regenerable cache;
 * a store written under a different version is discarded rather than migrated.
 * Bump when the stored annotation shape changes (the per-score rubric is
 * versioned separately via `RUBRIC_VERSION`).
 */
export const SCORE_STORE_VERSION = 1;

/** Default score-store location: `~/.handler/scores.json`. */
export function defaultScoreStorePath(): string {
  return join(homedir(), '.handler', 'scores.json');
}

export class ScoreStore {
  private readonly filePath: string;
  private readonly annotations: ScoreAnnotation[];

  constructor(filePath: string = defaultScoreStorePath()) {
    this.filePath = filePath;
    this.annotations = extractAnnotations(readJsonFile<unknown>(filePath, null));
  }

  /** Add an annotation. Re-adding the same `(runId, rubricVersion)` is a no-op. */
  add(annotation: ScoreAnnotation): void {
    if (this.get(annotation.runId, annotation.score.rubricVersion) !== undefined) {
      return;
    }
    this.annotations.push(annotation);
    this.persist();
  }

  /** The score for a run under a rubric version, or `undefined` when absent. */
  get(runId: string, rubricVersion: number): Score | undefined {
    return this.annotations.find(
      (a) => a.runId === runId && a.score.rubricVersion === rubricVersion,
    )?.score;
  }

  /** All stored annotations, in insertion order. */
  list(): ScoreAnnotation[] {
    return [...this.annotations];
  }

  private persist(): void {
    const file: ScoreStoreFile = { version: SCORE_STORE_VERSION, annotations: this.annotations };
    writeJsonFile(this.filePath, file);
  }
}

function extractAnnotations(raw: unknown): ScoreAnnotation[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const file = raw as { version?: unknown; annotations?: unknown };
  // Discard a store written under a different schema — it is a rebuildable cache.
  if (file.version !== SCORE_STORE_VERSION || !Array.isArray(file.annotations)) {
    return [];
  }
  return file.annotations.filter(isAnnotation);
}

function isAnnotation(value: unknown): value is ScoreAnnotation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const score = candidate.score;
  return (
    typeof candidate.runId === 'string' &&
    typeof score === 'object' &&
    score !== null &&
    typeof (score as Record<string, unknown>).rubricVersion === 'number'
  );
}
