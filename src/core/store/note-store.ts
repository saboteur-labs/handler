/**
 * Versioned per-agent note store (spec Reqs 20, 21).
 *
 * Persists one freeform note per agent, keyed on the serialized `identityKey`
 * (Req 8) rather than a path or filename — which is exactly why a note survives
 * a renamed, edited, or deleted definition (Req 21). One editable note per
 * agent: `set` upserts (re-setting overwrites the body). Mirrors `ScoreStore`:
 * a versioned `{version:1, notes:[…]}` envelope via `json-store`, read once per
 * instance, structurally-invalid file degrades to empty. No network calls.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { readJsonFile, writeJsonFile } from './json-store';

export interface Note {
  /** Serialized agent identity (see `identityKey`). */
  readonly identityKey: string;
  readonly body: string;
  /** ISO-8601 timestamp of the last `set`. */
  readonly updatedAt: string;
}

interface NoteStoreFile {
  readonly version: number;
  readonly notes: Note[];
}

/**
 * Note-store schema version. Like the run/score stores, this is a regenerable
 * cache; a store written under a different version is discarded rather than
 * migrated. Bump when the stored note shape changes.
 */
export const NOTE_STORE_VERSION = 1;

/** Default note-store location: `~/.handler/notes.json`. */
export function defaultNotePath(): string {
  return join(homedir(), '.handler', 'notes.json');
}

export class NoteStore {
  private readonly filePath: string;
  private readonly notes: Note[];

  constructor(filePath: string = defaultNotePath()) {
    this.filePath = filePath;
    this.notes = extractNotes(readJsonFile<unknown>(filePath, null));
  }

  /** Set (upsert) the note for an agent. Re-setting overwrites the prior body. */
  set(identityKey: string, body: string): void {
    const updatedAt = new Date().toISOString();
    const existing = this.notes.find((n) => n.identityKey === identityKey);
    if (existing === undefined) {
      this.notes.push({ identityKey, body, updatedAt });
    } else {
      const index = this.notes.indexOf(existing);
      this.notes[index] = { identityKey, body, updatedAt };
    }
    this.persist();
  }

  /** The note for an agent, or `undefined` when it has none. */
  get(identityKey: string): Note | undefined {
    return this.notes.find((n) => n.identityKey === identityKey);
  }

  /** All stored notes, in insertion order. */
  list(): Note[] {
    return [...this.notes];
  }

  private persist(): void {
    const file: NoteStoreFile = { version: NOTE_STORE_VERSION, notes: this.notes };
    writeJsonFile(this.filePath, file);
  }
}

function extractNotes(raw: unknown): Note[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const file = raw as { version?: unknown; notes?: unknown };
  // Discard a store written under a different schema — it is a rebuildable cache.
  if (file.version !== NOTE_STORE_VERSION || !Array.isArray(file.notes)) {
    return [];
  }
  return file.notes.filter(isNote);
}

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.identityKey === 'string' &&
    typeof candidate.body === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}
