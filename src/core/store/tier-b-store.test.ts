import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TierBResult } from '../scoring/tier-b';
import { TIER_B_VERSION } from '../scoring/tier-b';
import { ScoreStore } from './score-store';
import { TIER_B_STORE_VERSION, TierBStore } from './tier-b-store';

function tierBResult(tierBVersion: number = TIER_B_VERSION): TierBResult {
  return {
    status: 'applicable',
    tierBVersion,
    flags: [{ dimension: 'tokens', status: 'within', value: 100, median: 80, factor: 2 }],
    contract: { status: 'not-applicable' },
  };
}

describe('TierBStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-tierb-'));
    file = join(dir, 'tier-b.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds an annotation and gets it back by (runId, tierBVersion)', () => {
    const store = new TierBStore(file);
    store.add({ runId: 'r1', result: tierBResult(1) });
    const result = store.get('r1', 1);
    expect(result?.tierBVersion).toBe(1);
    expect(result?.status).toBe('applicable');
  });

  it('is a no-op when the same (runId, tierBVersion) already exists', () => {
    const store = new TierBStore(file);
    const first = tierBResult(1);
    store.add({ runId: 'r1', result: first });

    const second: TierBResult = { status: 'insufficient-history', tierBVersion: 1 };
    store.add({ runId: 'r1', result: second });

    // First value must be retained
    expect(store.get('r1', 1)?.status).toBe('applicable');
    expect(store.list()).toHaveLength(1);
  });

  it('stores annotations for the same run under different tierBVersions separately', () => {
    const store = new TierBStore(file);
    store.add({ runId: 'r1', result: tierBResult(1) });
    store.add({ runId: 'r1', result: { status: 'insufficient-history', tierBVersion: 2 } });
    expect(store.get('r1', 1)?.status).toBe('applicable');
    expect(store.get('r1', 2)?.status).toBe('insufficient-history');
  });

  it('list returns all annotations in insertion order', () => {
    const store = new TierBStore(file);
    store.add({ runId: 'r1', result: tierBResult(1) });
    store.add({ runId: 'r2', result: tierBResult(1) });
    store.add({ runId: 'r3', result: tierBResult(1) });
    const list = store.list();
    expect(list.map((a) => a.runId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('degrades to empty when the file contains corrupt JSON', () => {
    writeFileSync(file, 'not-valid-json', 'utf8');
    const store = new TierBStore(file);
    expect(store.list()).toEqual([]);
    // Verify the store is still usable after degrading
    store.add({ runId: 'r1', result: tierBResult(1) });
    expect(store.list()).toHaveLength(1);
  });

  it('degrades to empty when the file has a wrong schema version', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: TIER_B_STORE_VERSION + 1,
        annotations: [{ runId: 'r1', result: tierBResult(1) }],
      }),
      'utf8',
    );
    expect(new TierBStore(file).list()).toEqual([]);
  });

  it('does not read or write a ScoreStore path when using separate tmp paths', () => {
    const scoreFile = join(dir, 'scores.json');
    const tierBFile = join(dir, 'tier-b.json');

    const scoreStore = new ScoreStore(scoreFile);
    const tierBStore = new TierBStore(tierBFile);

    tierBStore.add({ runId: 'r1', result: tierBResult(1) });

    // Score store file must remain untouched — any read returns undefined (no data)
    expect(scoreStore.get('r1', 1)).toBeUndefined();

    // A fresh ScoreStore at the score path must also be empty
    expect(new ScoreStore(scoreFile).list()).toEqual([]);
  });
});
