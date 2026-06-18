import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Score } from '../scoring/rubric';
import { SCORE_STORE_VERSION, ScoreStore } from './score-store';

function score(rubricVersion: number, composite: number): Score {
  return { band: 'pass', composite, breakdown: [], rubricVersion };
}

describe('ScoreStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-scores-'));
    file = join(dir, 'scores.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds an annotation and gets it back by (runId, rubricVersion)', () => {
    const store = new ScoreStore(file);
    store.add({ runId: 'r1', score: score(1, 90) });
    expect(store.get('r1', 1)?.composite).toBe(90);
  });

  it('returns undefined for an unknown run or rubric version', () => {
    const store = new ScoreStore(file);
    store.add({ runId: 'r1', score: score(1, 90) });
    expect(store.get('r1', 2)).toBeUndefined();
    expect(store.get('other', 1)).toBeUndefined();
  });

  it('does not overwrite an existing (runId, rubricVersion)', () => {
    const store = new ScoreStore(file);
    store.add({ runId: 'r1', score: score(1, 90) });
    store.add({ runId: 'r1', score: score(1, 10) });
    expect(store.get('r1', 1)?.composite).toBe(90);
  });

  it('keeps annotations for the same run under different rubric versions', () => {
    const store = new ScoreStore(file);
    store.add({ runId: 'r1', score: score(1, 90) });
    store.add({ runId: 'r1', score: score(2, 70) });
    expect(store.get('r1', 1)?.composite).toBe(90);
    expect(store.get('r1', 2)?.composite).toBe(70);
  });

  it('reloads persisted annotations in a fresh instance', () => {
    new ScoreStore(file).add({ runId: 'r1', score: score(1, 90) });
    expect(new ScoreStore(file).get('r1', 1)?.composite).toBe(90);
  });

  it('tolerates a structurally-wrong store file by starting empty', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: SCORE_STORE_VERSION, annotations: 'nope' }),
      'utf8',
    );
    const store = new ScoreStore(file);
    expect(store.list()).toEqual([]);
    store.add({ runId: 'r1', score: score(1, 90) });
    expect(store.list()).toHaveLength(1);
  });

  it('discards a store written under an older schema version', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: SCORE_STORE_VERSION - 1,
        annotations: [{ runId: 'r1', score: score(1, 90) }],
      }),
      'utf8',
    );
    expect(new ScoreStore(file).list()).toEqual([]);
  });
});
