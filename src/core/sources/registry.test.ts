import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SourceRegistry } from './registry';
import { repoSource, userSource } from './source';

describe('SourceRegistry (Req 5)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-')));
    file = join(dir, 'sources.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists nothing before anything is registered', () => {
    expect(new SourceRegistry(file).list()).toEqual([]);
  });

  it('registers a source and lists it', () => {
    const registry = new SourceRegistry(file);
    const source = repoSource(join(dir, 'repo-a'));
    registry.register(source);
    expect(registry.list()).toEqual([source]);
  });

  it('persists across instances (reload from disk)', () => {
    const source = repoSource(join(dir, 'repo-a'));
    new SourceRegistry(file).register(source);

    const reloaded = new SourceRegistry(file);
    expect(reloaded.list()).toEqual([source]);
  });

  it('does not duplicate an already-registered source', () => {
    const registry = new SourceRegistry(file);
    registry.register(repoSource(join(dir, 'repo-a')));
    registry.register(repoSource(join(dir, 'repo-a')));
    expect(registry.list()).toHaveLength(1);
  });

  it('dedupes by normalized path (trailing slash)', () => {
    const registry = new SourceRegistry(file);
    registry.register(repoSource(join(dir, 'repo-a')));
    registry.register(repoSource(`${join(dir, 'repo-a')}/`));
    expect(registry.list()).toHaveLength(1);
  });

  it('keeps distinct sources (different type or path)', () => {
    const registry = new SourceRegistry(file);
    const repo = repoSource(join(dir, 'repo-a'));
    const user = userSource(join(dir, 'home'));
    registry.register(repo);
    registry.register(user);
    expect(registry.list()).toEqual([repo, user]);
  });

  it('tolerates a malformed store file by treating it as empty', () => {
    writeFileSync(file, JSON.stringify({ version: 1, sources: 'not-an-array' }), 'utf8');
    expect(new SourceRegistry(file).list()).toEqual([]);
  });
});
