import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizePath } from '../paths';
import { enumerateDefinitionNames, repoSource, userSource } from './source';

describe('agent sources (Req 4)', () => {
  let dir: string;

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-')));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('userSource', () => {
    it('is anchored at the given home and derives <home>/.claude/agents', () => {
      const source = userSource(dir);
      expect(source.type).toBe('user');
      expect(source.root).toBe(dir);
      expect(source.agentsDir).toBe(join(dir, '.claude', 'agents'));
    });

    it("defaults to the current user's home directory", () => {
      const source = userSource();
      expect(source.root).toBe(normalizePath(homedir()));
      expect(source.agentsDir).toBe(join(normalizePath(homedir()), '.claude', 'agents'));
    });
  });

  describe('repoSource', () => {
    it('is anchored at the repo root and derives <repo>/.claude/agents', () => {
      const source = repoSource(dir);
      expect(source.type).toBe('repo');
      expect(source.root).toBe(dir);
      expect(source.agentsDir).toBe(join(dir, '.claude', 'agents'));
    });

    it('normalizes the root (absolute, ".." collapsed, trailing-slash stable)', () => {
      const source = repoSource(`${join(dir, 'pkg', '..')}/`);
      expect(source.root).toBe(dir);
      expect(source.agentsDir).toBe(join(dir, '.claude', 'agents'));
    });
  });

  describe('enumerateDefinitionNames', () => {
    it('surfaces definitions in nested subfolders alongside top-level ones', () => {
      const agentsDir = join(dir, '.claude', 'agents');
      mkdirSync(join(agentsDir, 'review'), { recursive: true });
      writeFileSync(join(agentsDir, 'top.md'), 'x', 'utf8');
      writeFileSync(join(agentsDir, 'review', 'security.md'), 'x', 'utf8');
      writeFileSync(join(agentsDir, 'review', 'notes.txt'), 'x', 'utf8'); // ignored (not .md)

      expect(enumerateDefinitionNames(repoSource(dir)).sort()).toEqual(['security', 'top']);
    });

    it('returns an empty list when the agents dir is absent', () => {
      expect(enumerateDefinitionNames(repoSource(dir))).toEqual([]);
    });
  });
});
