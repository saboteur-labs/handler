import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NOTE_STORE_VERSION, NoteStore } from './note-store';

const KEY = JSON.stringify(['user', '/home/me/.claude/agents', 'reviewer']);

describe('NoteStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-notes-'));
    file = join(dir, 'notes.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets a note and gets it back by identity key', () => {
    const store = new NoteStore(file);
    store.set(KEY, 'remember to widen the tool scope');
    expect(store.get(KEY)?.body).toBe('remember to widen the tool scope');
  });

  it('returns undefined for an agent with no note', () => {
    const store = new NoteStore(file);
    expect(store.get(KEY)).toBeUndefined();
  });

  it('overwrites the prior body and bumps updatedAt on re-set', () => {
    const store = new NoteStore(file);
    store.set(KEY, 'first');
    const first = store.get(KEY)?.updatedAt;
    store.set(KEY, 'second');
    const note = store.get(KEY);
    expect(note?.body).toBe('second');
    expect(first).toBeDefined();
    expect(note?.updatedAt).not.toBeUndefined();
    expect(Date.parse(note!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(first!));
  });

  it('reloads persisted notes in a fresh instance', () => {
    new NoteStore(file).set(KEY, 'persisted');
    expect(new NoteStore(file).get(KEY)?.body).toBe('persisted');
  });

  it('reads an absent file as empty without throwing', () => {
    const store = new NoteStore(file);
    expect(store.list()).toEqual([]);
  });

  it('tolerates a structurally-wrong store file by starting empty', () => {
    writeFileSync(file, JSON.stringify({ version: NOTE_STORE_VERSION, notes: 'nope' }), 'utf8');
    const store = new NoteStore(file);
    expect(store.list()).toEqual([]);
    store.set(KEY, 'fresh');
    expect(store.list()).toHaveLength(1);
  });

  it('discards a store written under a different schema version', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: NOTE_STORE_VERSION - 1,
        notes: [{ identityKey: KEY, body: 'old', updatedAt: new Date().toISOString() }],
      }),
      'utf8',
    );
    expect(new NoteStore(file).list()).toEqual([]);
  });
});
