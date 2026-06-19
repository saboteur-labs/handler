/**
 * Versioned Tier C anchor store.
 *
 * Persists user-supplied `TierCAnchor` records keyed by `(identityKey, runId)`.
 * Anchors are human-created ground-truth calibration examples for the Tier C
 * LLM judge; they are NOT versioned by rubric (unlike `TierBStore` or
 * `ScoreStore`) because they represent user intent, not judge output.
 *
 * Keyed by `identityKey` (not a path) so anchors survive agent renames, edits,
 * and deletions — the same principle as `NoteStore`. Mirrors `TierBStore`:
 * a versioned `{version:1, anchors:[…]}` envelope via `json-store`; a
 * wrong-version or corrupt file degrades to empty rather than throwing.
 *
 * NEVER reads or writes Tier A scores, Tier B annotations, or Tier C
 * annotations — completely separate stores.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TierCAnchor } from '../scoring/tier-c';
import { readJsonFile, writeJsonFile } from './json-store';

interface AnchorStoreFile {
  readonly version: number;
  readonly anchors: TierCAnchor[];
}

/**
 * Anchor store schema version. Bump when the stored anchor shape changes.
 * Separate from `TIER_C_VERSION`, which keys judge results.
 */
export const ANCHOR_STORE_VERSION = 1;

/** Default anchor store location: `~/.handler/anchors.json`. */
export function defaultAnchorsPath(): string {
  return join(homedir(), '.handler', 'anchors.json');
}

export class AnchorStore {
  private readonly filePath: string;
  private readonly anchors: TierCAnchor[];

  constructor(filePath: string = defaultAnchorsPath()) {
    this.filePath = filePath;
    let raw: unknown;
    try {
      raw = readJsonFile<unknown>(filePath, null);
    } catch {
      raw = null;
    }
    this.anchors = extractAnchors(raw);
  }

  /** Add an anchor. Re-adding the same `(identityKey, runId)` is a no-op. */
  add(anchor: TierCAnchor): void {
    if (this.get(anchor.identityKey, anchor.runId) !== undefined) {
      return;
    }
    this.anchors.push(anchor);
    this.persist();
  }

  /** The anchor for a specific `(identityKey, runId)`, or `undefined` when absent. */
  get(identityKey: string, runId: string): TierCAnchor | undefined {
    return this.anchors.find((a) => a.identityKey === identityKey && a.runId === runId);
  }

  /**
   * All anchors for a given agent identity key, in insertion order.
   * This is how the Tier C judge prompt builder retrieves calibration examples.
   */
  getByAgent(identityKey: string): TierCAnchor[] {
    return this.anchors.filter((a) => a.identityKey === identityKey);
  }

  /** All stored anchors, in insertion order. */
  list(): TierCAnchor[] {
    return [...this.anchors];
  }

  private persist(): void {
    const file: AnchorStoreFile = { version: ANCHOR_STORE_VERSION, anchors: this.anchors };
    writeJsonFile(this.filePath, file);
  }
}

function extractAnchors(raw: unknown): TierCAnchor[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const file = raw as { version?: unknown; anchors?: unknown };
  if (file.version !== ANCHOR_STORE_VERSION || !Array.isArray(file.anchors)) {
    return [];
  }
  return file.anchors.filter(isAnchor);
}

function isAnchor(value: unknown): value is TierCAnchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.identityKey === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.definitionSnapshot === 'string' &&
    typeof candidate.runOutput === 'string' &&
    (candidate.score === 'pass' || candidate.score === 'fail') &&
    typeof candidate.reasoning === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}
