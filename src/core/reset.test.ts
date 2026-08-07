import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResetScope, ResetTargetKey } from './reset';
import { executeReset, planReset } from './reset';

describe('core: reset', () => {
  let dir: string;
  let paths: Record<ResetTargetKey, string>;

  /** Every store the reset knows about, seeded with a marker file. */
  const FILES: readonly ResetTargetKey[] = [
    'runs',
    'scores',
    'tierB',
    'tierC',
    'anchors',
    'notes',
    'sources',
    'conventions',
    'config',
  ] as const;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-reset-'));
    paths = Object.fromEntries(FILES.map((key) => [key, join(dir, `${key}.json`)])) as Record<
      ResetTargetKey,
      string
    >;
    for (const path of Object.values(paths)) {
      writeFileSync(path, '{}\n', 'utf8');
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const keysFor = (scope: ResetScope): string[] =>
    planReset({ scope, paths })
      .targets.map((target) => target.key)
      .sort();

  describe('planReset', () => {
    it('scopes "scores" to the recomputable score annotations only', () => {
      expect(keysFor('scores')).toEqual(['scores', 'tierB']);
    });

    it('scopes "derived" to the run cache plus the score annotations', () => {
      expect(keysFor('derived')).toEqual(['runs', 'scores', 'tierB']);
    });

    it('scopes "all" to every known store', () => {
      expect(keysFor('all')).toEqual([...FILES].sort());
    });

    it('marks regenerable stores derived and authored stores not', () => {
      const plan = planReset({ scope: 'all', paths });
      const derived = Object.fromEntries(plan.targets.map((t) => [t.key, t.derived]));

      expect(derived).toMatchObject({
        runs: true,
        scores: true,
        tierB: true,
        tierC: false,
        anchors: false,
        notes: false,
        sources: false,
        config: false,
      });
    });

    it('reports which targets exist on disk', () => {
      rmSync(paths.notes);
      const byKey = Object.fromEntries(
        planReset({ scope: 'all', paths }).targets.map((t) => [t.key, t.exists]),
      );

      expect(byKey.notes).toBe(false);
      expect(byKey.runs).toBe(true);
    });

    it('does not touch the filesystem', () => {
      planReset({ scope: 'all', paths });

      expect(existsSync(paths.runs)).toBe(true);
    });

    it('falls back to the default store paths when no override is given', () => {
      const plan = planReset({ scope: 'all' });

      for (const target of plan.targets) {
        expect(target.path).toMatch(/[\\/]\.handler[\\/]/);
      }
    });
  });

  describe('executeReset', () => {
    it('deletes exactly the planned targets and leaves the rest', () => {
      const outcome = executeReset(planReset({ scope: 'derived', paths }));

      expect([...outcome.deleted].sort()).toEqual(['runs', 'scores', 'tierB']);
      expect(existsSync(paths.runs)).toBe(false);
      expect(existsSync(paths.scores)).toBe(false);
      expect(existsSync(paths.tierB)).toBe(false);
      expect(existsSync(paths.notes)).toBe(true);
      expect(existsSync(paths.sources)).toBe(true);
    });

    it('reports absent targets as skipped rather than failing', () => {
      rmSync(paths.scores);
      const outcome = executeReset(planReset({ scope: 'scores', paths }));

      expect(outcome.deleted).toEqual(['tierB']);
      expect(outcome.skipped).toEqual(['scores']);
    });

    it('copies each deleted file into the backup directory when one is given', () => {
      writeFileSync(paths.notes, '{"note":"keep me"}\n', 'utf8');
      const backupDir = join(dir, 'backup');

      const outcome = executeReset(planReset({ scope: 'all', paths }), { backupDir });

      expect([...outcome.backedUp].sort()).toEqual([...outcome.deleted].sort());
      expect(readFileSync(join(backupDir, 'notes.json'), 'utf8')).toBe('{"note":"keep me"}\n');
      expect(existsSync(paths.notes)).toBe(false);
    });

    it('creates the backup directory when it does not exist', () => {
      const backupDir = join(dir, 'nested', 'backup');
      executeReset(planReset({ scope: 'scores', paths }), { backupDir });

      expect(existsSync(join(backupDir, 'scores.json'))).toBe(true);
    });

    it('backs a file up before deleting it, so a copy failure loses nothing', () => {
      // A regular file where the backup directory must go: mkdir fails, and the
      // originals must survive.
      const backupDir = join(dir, 'blocked');
      writeFileSync(backupDir, 'not a directory', 'utf8');

      expect(() => executeReset(planReset({ scope: 'scores', paths }), { backupDir })).toThrow();
      expect(existsSync(paths.scores)).toBe(true);
    });
  });
});
