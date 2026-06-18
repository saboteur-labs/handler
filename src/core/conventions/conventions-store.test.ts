import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConventionsArtifact } from './conventions-store';
import {
  CONVENTIONS_STORE_VERSION,
  loadConventions,
  loadConventionsWithDefault,
} from './conventions-store';

function artifact(overrides: Partial<ConventionsArtifact> = {}): ConventionsArtifact {
  return {
    version: CONVENTIONS_STORE_VERSION,
    sourceHash: 'abc123',
    lastSynced: '2026-06-01T00:00:00.000Z',
    rules: {
      requiredKeys: ['name', 'description'],
      allowedKeys: ['name', 'description', 'tools', 'model'],
      descriptionMinLength: 40,
      cuePatterns: ['use when', 'when the user'],
    },
    ...overrides,
  };
}

describe('loadConventions', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-conventions-'));
    file = join(dir, 'conventions.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a valid artifact', () => {
    writeFileSync(file, JSON.stringify(artifact()), 'utf8');
    const loaded = loadConventions(file);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.artifact.sourceHash).toBe('abc123');
      expect(loaded.artifact.rules.descriptionMinLength).toBe(40);
      expect(loaded.artifact.rules.cuePatterns).toEqual(['use when', 'when the user']);
    }
  });

  it('degrades to missing/absent when the file does not exist', () => {
    const loaded = loadConventions(file);
    expect(loaded).toEqual({ status: 'missing', reason: 'absent' });
  });

  it('degrades to missing/malformed on corrupt JSON rather than throwing', () => {
    writeFileSync(file, '{ not valid json', 'utf8');
    expect(() => loadConventions(file)).not.toThrow();
    expect(loadConventions(file)).toEqual({ status: 'missing', reason: 'malformed' });
  });

  it('degrades to missing/malformed on a wrong-shape artifact', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: CONVENTIONS_STORE_VERSION, rules: 'nope' }),
      'utf8',
    );
    expect(loadConventions(file)).toEqual({ status: 'missing', reason: 'malformed' });
  });

  it('degrades to missing/version-mismatch on a wrong schema version', () => {
    writeFileSync(
      file,
      JSON.stringify(artifact({ version: CONVENTIONS_STORE_VERSION + 1 })),
      'utf8',
    );
    expect(loadConventions(file)).toEqual({ status: 'missing', reason: 'version-mismatch' });
  });
});

describe('loadConventionsWithDefault', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-conventions-'));
    file = join(dir, 'conventions.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the shipped default when no user artifact exists', () => {
    const loaded = loadConventionsWithDefault(file);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      // The shipped artifact carries the real distilled rules.
      expect(loaded.artifact.rules.requiredKeys).toEqual(['name', 'description']);
      expect(loaded.artifact.rules.descriptionMinLength).toBeGreaterThan(0);
      expect(loaded.artifact.rules.cuePatterns.length).toBeGreaterThan(0);
    }
  });

  it('prefers a present user artifact over the shipped default', () => {
    writeFileSync(file, JSON.stringify(artifact({ sourceHash: 'user-hash' })), 'utf8');
    const loaded = loadConventionsWithDefault(file);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.artifact.sourceHash).toBe('user-hash');
    }
  });

  it('does not mask a corrupt user artifact with the shipped default', () => {
    writeFileSync(file, '{ not valid json', 'utf8');
    expect(loadConventionsWithDefault(file)).toEqual({ status: 'missing', reason: 'malformed' });
  });
});
