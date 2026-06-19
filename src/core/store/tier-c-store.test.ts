import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TierCResult } from '../scoring/tier-c';
import { TIER_C_VERSION } from '../scoring/tier-c';
import { ScoreStore } from './score-store';
import { TierBStore } from './tier-b-store';
import { TIER_C_STORE_VERSION, TierCStore } from './tier-c-store';

function tierCResult(rubricVersion: string = TIER_C_VERSION): TierCResult {
  return {
    label: 'pass',
    reasoning: 'The agent performed well.',
    rubricVersion,
    createdAt: '2026-06-18T00:00:00.000Z',
  };
}

describe('TierCStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-tierc-'));
    file = join(dir, 'tier-c.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds an annotation and gets it back by (identityKey, runId, tierCVersion)', () => {
    const store = new TierCStore(file);
    store.add({
      identityKey: 'user::~/.claude/agents::my-agent',
      runId: 'r1',
      result: tierCResult(),
    });
    const result = store.get('user::~/.claude/agents::my-agent', 'r1', TIER_C_VERSION);
    expect(result?.label).toBe('pass');
    expect(result?.rubricVersion).toBe(TIER_C_VERSION);
  });

  it('is a no-op when the same (identityKey, runId, tierCVersion) already exists', () => {
    const store = new TierCStore(file);
    const first = tierCResult();
    store.add({ identityKey: 'ik1', runId: 'r1', result: first });

    const second: TierCResult = {
      label: 'fail',
      reasoning: 'Different result.',
      rubricVersion: TIER_C_VERSION,
      createdAt: '2026-06-18T01:00:00.000Z',
    };
    store.add({ identityKey: 'ik1', runId: 'r1', result: second });

    // First value must be retained
    expect(store.get('ik1', 'r1', TIER_C_VERSION)?.label).toBe('pass');
    expect(store.list()).toHaveLength(1);
  });

  it('stores annotations for the same run under different tierCVersions separately', () => {
    const store = new TierCStore(file);
    store.add({ identityKey: 'ik1', runId: 'r1', result: tierCResult('tier-c-v1') });
    store.add({
      identityKey: 'ik1',
      runId: 'r1',
      result: {
        label: 'fail',
        reasoning: 'v2 result',
        rubricVersion: 'tier-c-v2',
        createdAt: '2026-06-18T00:00:00.000Z',
      },
    });
    expect(store.get('ik1', 'r1', 'tier-c-v1')?.label).toBe('pass');
    expect(store.get('ik1', 'r1', 'tier-c-v2')?.label).toBe('fail');
  });

  it('stores annotations for the same (runId, tierCVersion) under different identityKeys separately', () => {
    const store = new TierCStore(file);
    store.add({ identityKey: 'ik1', runId: 'r1', result: tierCResult() });
    store.add({
      identityKey: 'ik2',
      runId: 'r1',
      result: {
        label: 'fail',
        reasoning: 'different agent',
        rubricVersion: TIER_C_VERSION,
        createdAt: '2026-06-18T00:00:00.000Z',
      },
    });
    expect(store.get('ik1', 'r1', TIER_C_VERSION)?.label).toBe('pass');
    expect(store.get('ik2', 'r1', TIER_C_VERSION)?.label).toBe('fail');
  });

  it('list returns all annotations in insertion order', () => {
    const store = new TierCStore(file);
    store.add({ identityKey: 'ik1', runId: 'r1', result: tierCResult() });
    store.add({ identityKey: 'ik1', runId: 'r2', result: tierCResult() });
    store.add({ identityKey: 'ik2', runId: 'r3', result: tierCResult() });
    const list = store.list();
    expect(list.map((a) => a.runId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('degrades to empty when the file contains corrupt JSON', () => {
    writeFileSync(file, 'not-valid-json', 'utf8');
    const store = new TierCStore(file);
    expect(store.list()).toEqual([]);
    // Verify the store is still usable after degrading
    store.add({ identityKey: 'ik1', runId: 'r1', result: tierCResult() });
    expect(store.list()).toHaveLength(1);
  });

  it('degrades to empty when the file has a wrong schema version', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: TIER_C_STORE_VERSION + 1,
        annotations: [{ identityKey: 'ik1', runId: 'r1', result: tierCResult() }],
      }),
      'utf8',
    );
    expect(new TierCStore(file).list()).toEqual([]);
  });

  it('does not read or write ScoreStore or TierBStore paths when using separate tmp paths', () => {
    const scoreFile = join(dir, 'scores.json');
    const tierBFile = join(dir, 'tier-b.json');
    const tierCFile = join(dir, 'tier-c.json');

    const scoreStore = new ScoreStore(scoreFile);
    const tierBStore = new TierBStore(tierBFile);
    const tierCStore = new TierCStore(tierCFile);

    tierCStore.add({ identityKey: 'ik1', runId: 'r1', result: tierCResult() });

    // Score store must remain untouched
    expect(scoreStore.get('r1', 1)).toBeUndefined();
    expect(new ScoreStore(scoreFile).list()).toEqual([]);

    // Tier B store must remain untouched
    expect(tierBStore.get('r1', 1)).toBeUndefined();
    expect(new TierBStore(tierBFile).list()).toEqual([]);
  });
});
