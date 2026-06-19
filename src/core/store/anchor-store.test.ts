import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TierCAnchor } from '../scoring/tier-c';
import { ANCHOR_STORE_VERSION, AnchorStore } from './anchor-store';

function makeAnchor(
  identityKey: string,
  runId: string,
  score: 'pass' | 'fail' = 'pass',
): TierCAnchor {
  return {
    identityKey,
    runId,
    definitionSnapshot: `definition for ${identityKey}`,
    runOutput: `output of run ${runId}`,
    score,
    reasoning: 'test reasoning',
    createdAt: new Date().toISOString(),
  };
}

describe('AnchorStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-anchors-'));
    file = join(dir, 'anchors.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds an anchor and gets it back by (identityKey, runId)', () => {
    const store = new AnchorStore(file);
    const anchor = makeAnchor('user::~/.claude/agents::my-agent', 'run-001');
    store.add(anchor);
    const result = store.get('user::~/.claude/agents::my-agent', 'run-001');
    expect(result).toBeDefined();
    expect(result?.identityKey).toBe('user::~/.claude/agents::my-agent');
    expect(result?.runId).toBe('run-001');
    expect(result?.score).toBe('pass');
  });

  it('returns undefined for a non-existent (identityKey, runId)', () => {
    const store = new AnchorStore(file);
    expect(store.get('user::~/.claude/agents::my-agent', 'run-999')).toBeUndefined();
  });

  it('get-by-agent returns all anchors for a given identityKey', () => {
    const store = new AnchorStore(file);
    const anchor1 = makeAnchor('user::~/.claude/agents::my-agent', 'run-001', 'pass');
    const anchor2 = makeAnchor('user::~/.claude/agents::my-agent', 'run-002', 'fail');
    store.add(anchor1);
    store.add(anchor2);
    const results = store.getByAgent('user::~/.claude/agents::my-agent');
    expect(results).toHaveLength(2);
    expect(results.map((a) => a.runId)).toContain('run-001');
    expect(results.map((a) => a.runId)).toContain('run-002');
  });

  it('get-by-agent returns only anchors for the requested identityKey', () => {
    const store = new AnchorStore(file);
    store.add(makeAnchor('user::~/.claude/agents::agent-a', 'run-001'));
    store.add(makeAnchor('user::~/.claude/agents::agent-b', 'run-002'));
    store.add(makeAnchor('user::~/.claude/agents::agent-a', 'run-003'));
    const results = store.getByAgent('user::~/.claude/agents::agent-a');
    expect(results).toHaveLength(2);
    expect(results.every((a) => a.identityKey === 'user::~/.claude/agents::agent-a')).toBe(true);
  });

  it('get-by-agent returns empty array when agent has no anchors', () => {
    const store = new AnchorStore(file);
    expect(store.getByAgent('user::~/.claude/agents::unknown')).toEqual([]);
  });

  it('supports multiple anchors per agent across different runs', () => {
    const store = new AnchorStore(file);
    const ids = ['run-001', 'run-002', 'run-003'];
    for (const runId of ids) {
      store.add(makeAnchor('user::~/.claude/agents::my-agent', runId));
    }
    expect(store.getByAgent('user::~/.claude/agents::my-agent')).toHaveLength(3);
  });

  it('re-adding the same (identityKey, runId) is a no-op', () => {
    const store = new AnchorStore(file);
    const anchor = makeAnchor('user::~/.claude/agents::my-agent', 'run-001', 'pass');
    store.add(anchor);

    const updated = makeAnchor('user::~/.claude/agents::my-agent', 'run-001', 'fail');
    store.add(updated);

    expect(store.get('user::~/.claude/agents::my-agent', 'run-001')?.score).toBe('pass');
    expect(store.list()).toHaveLength(1);
  });

  it('persists anchors across instances', () => {
    const store1 = new AnchorStore(file);
    store1.add(makeAnchor('user::~/.claude/agents::my-agent', 'run-001'));
    store1.add(makeAnchor('user::~/.claude/agents::my-agent', 'run-002'));

    const store2 = new AnchorStore(file);
    expect(store2.getByAgent('user::~/.claude/agents::my-agent')).toHaveLength(2);
  });

  it('degrades to empty when the file contains corrupt JSON', () => {
    writeFileSync(file, 'not-valid-json', 'utf8');
    const store = new AnchorStore(file);
    expect(store.list()).toEqual([]);
    // Store remains usable after degrading
    store.add(makeAnchor('user::~/.claude/agents::my-agent', 'run-001'));
    expect(store.list()).toHaveLength(1);
  });

  it('degrades to empty when the file has a wrong schema version', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: ANCHOR_STORE_VERSION + 1,
        anchors: [makeAnchor('user::~/.claude/agents::my-agent', 'run-001')],
      }),
      'utf8',
    );
    expect(new AnchorStore(file).list()).toEqual([]);
  });
});
