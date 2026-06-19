/**
 * Versioned Tier B annotation store.
 *
 * Persists Tier B (reference-relative) scoring results as annotations keyed by
 * `(runId, tierBVersion)`. Storing the Tier B version means a scoring logic
 * change adds a new annotation rather than overwriting the old one, preserving
 * prior results. Mirrors `ScoreStore`: versioned `{version:1, annotations:[…]}`
 * envelope via `json-store`; a wrong-version or corrupt file degrades to empty
 * rather than throwing.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TierBResult } from '../scoring/tier-b';
import { readJsonFile, writeJsonFile } from './json-store';

export interface TierBAnnotation {
  readonly runId: string;
  readonly result: TierBResult;
}

interface TierBStoreFile {
  readonly version: number;
  readonly annotations: TierBAnnotation[];
}

/**
 * Tier B store schema version. Controls the file envelope version; separate
 * from `TIER_B_VERSION` which keys individual annotations. Bump when the stored
 * annotation shape changes.
 */
export const TIER_B_STORE_VERSION = 1;

/** Default Tier B store location: `~/.handler/tier-b.json`. */
export function defaultTierBStorePath(): string {
  return join(homedir(), '.handler', 'tier-b.json');
}

export class TierBStore {
  private readonly filePath: string;
  private readonly annotations: TierBAnnotation[];

  constructor(filePath: string = defaultTierBStorePath()) {
    this.filePath = filePath;
    let raw: unknown;
    try {
      raw = readJsonFile<unknown>(filePath, null);
    } catch {
      raw = null;
    }
    this.annotations = extractAnnotations(raw);
  }

  /** Add an annotation. Re-adding the same `(runId, tierBVersion)` is a no-op. */
  add(annotation: TierBAnnotation): void {
    if (this.get(annotation.runId, annotation.result.tierBVersion) !== undefined) {
      return;
    }
    this.annotations.push(annotation);
    this.persist();
  }

  /** The Tier B result for a run under a specific tierBVersion, or `undefined` when absent. */
  get(runId: string, tierBVersion: number): TierBResult | undefined {
    return this.annotations.find((a) => a.runId === runId && a.result.tierBVersion === tierBVersion)
      ?.result;
  }

  /** All stored annotations, in insertion order. */
  list(): TierBAnnotation[] {
    return [...this.annotations];
  }

  private persist(): void {
    const file: TierBStoreFile = { version: TIER_B_STORE_VERSION, annotations: this.annotations };
    writeJsonFile(this.filePath, file);
  }
}

function extractAnnotations(raw: unknown): TierBAnnotation[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const file = raw as { version?: unknown; annotations?: unknown };
  if (file.version !== TIER_B_STORE_VERSION || !Array.isArray(file.annotations)) {
    return [];
  }
  return file.annotations.filter(isAnnotation);
}

function isAnnotation(value: unknown): value is TierBAnnotation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const result = candidate.result;
  return (
    typeof candidate.runId === 'string' &&
    typeof result === 'object' &&
    result !== null &&
    typeof (result as Record<string, unknown>).tierBVersion === 'number'
  );
}
