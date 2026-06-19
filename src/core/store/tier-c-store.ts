/**
 * Versioned Tier C annotation store.
 *
 * Persists Tier C (judged quality) scoring results as annotations keyed by
 * `(identityKey, runId, tierCVersion)`. Storing the Tier C version means a
 * rubric change adds a new annotation rather than overwriting the old one,
 * preserving prior results. Mirrors `TierBStore`: versioned
 * `{version:1, annotations:[…]}` envelope via `json-store`; a wrong-version
 * or corrupt file degrades to empty rather than throwing.
 *
 * This store is completely separate from Tier A (ScoreStore) and Tier B
 * (TierBStore) — it never reads or writes those paths.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TierCResult } from '../scoring/tier-c';
import { readJsonFile, writeJsonFile } from './json-store';

export interface TierCAnnotation {
  readonly identityKey: string;
  readonly runId: string;
  readonly result: TierCResult;
}

interface TierCStoreFile {
  readonly version: number;
  readonly annotations: TierCAnnotation[];
}

/**
 * Tier C store schema version. Controls the file envelope version; separate
 * from `TIER_C_VERSION` which keys individual annotations. Bump when the stored
 * annotation shape changes.
 */
export const TIER_C_STORE_VERSION = 1;

/** Default Tier C store location: `~/.handler/tier-c.json`. */
export function defaultTierCStorePath(): string {
  return process.env['HANDLER_TIERC'] ?? join(homedir(), '.handler', 'tier-c.json');
}

export class TierCStore {
  private readonly filePath: string;
  private readonly annotations: TierCAnnotation[];

  constructor(filePath: string = defaultTierCStorePath()) {
    this.filePath = filePath;
    let raw: unknown;
    try {
      raw = readJsonFile<unknown>(filePath, null);
    } catch {
      raw = null;
    }
    this.annotations = extractAnnotations(raw);
  }

  /**
   * Add an annotation. Re-adding the same `(identityKey, runId, tierCVersion)`
   * is a no-op.
   */
  add(annotation: TierCAnnotation): void {
    if (
      this.get(annotation.identityKey, annotation.runId, annotation.result.rubricVersion) !==
      undefined
    ) {
      return;
    }
    this.annotations.push(annotation);
    this.persist();
  }

  /**
   * The Tier C result for a run under a specific tierCVersion, or `undefined`
   * when absent.
   */
  get(identityKey: string, runId: string, tierCVersion: string): TierCResult | undefined {
    return this.annotations.find(
      (a) =>
        a.identityKey === identityKey &&
        a.runId === runId &&
        a.result.rubricVersion === tierCVersion,
    )?.result;
  }

  /** All stored annotations, in insertion order. */
  list(): TierCAnnotation[] {
    return [...this.annotations];
  }

  private persist(): void {
    const file: TierCStoreFile = { version: TIER_C_STORE_VERSION, annotations: this.annotations };
    writeJsonFile(this.filePath, file);
  }
}

function extractAnnotations(raw: unknown): TierCAnnotation[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const file = raw as { version?: unknown; annotations?: unknown };
  if (file.version !== TIER_C_STORE_VERSION || !Array.isArray(file.annotations)) {
    return [];
  }
  return file.annotations.filter(isAnnotation);
}

function isAnnotation(value: unknown): value is TierCAnnotation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const result = candidate.result;
  return (
    typeof candidate.identityKey === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof result === 'object' &&
    result !== null &&
    typeof (result as Record<string, unknown>).rubricVersion === 'string'
  );
}
