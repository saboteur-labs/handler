import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Run } from '../run';
import { RUN_STORE_VERSION, RunStore } from './run-store';

function run(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: '["repo","/r","reviewer"]',
    runId: 'agent-1',
    agentName: 'reviewer',
    cwd: '/r',
    sessionId: 'sess-1',
    sidechainPath: '/projects/-enc/sess-1/subagents/agent-agent-1.jsonl',
    timestamp: '2026-06-17T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: { readCount: 2 },
    definitionSnapshot: 'body',
    tags: [],
    ...overrides,
  };
}

describe('RunStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-runs-'));
    file = join(dir, 'runs.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds a run and lists it', () => {
    const store = new RunStore(file);
    store.add(run());
    expect(store.list()).toEqual([run()]);
  });

  it('does not duplicate the same (identityKey, runId)', () => {
    const store = new RunStore(file);
    store.add(run());
    store.add(run({ totalTokens: 999 }));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.totalTokens).toBe(500);
  });

  it('keeps runs that share a runId across different agents', () => {
    const store = new RunStore(file);
    store.add(run());
    store.add(run({ identityKey: '["user","/home","reviewer"]' }));
    expect(store.list()).toHaveLength(2);
  });

  it('reloads persisted runs in a fresh instance', () => {
    new RunStore(file).add(run());
    expect(new RunStore(file).list()).toEqual([run()]);
  });

  it('returns only the requested agent for forAgent', () => {
    const store = new RunStore(file);
    store.add(run());
    store.add(run({ identityKey: '["repo","/r","other"]', runId: 'agent-2' }));
    const found = store.forAgent('["repo","/r","reviewer"]');
    expect(found).toHaveLength(1);
    expect(found[0]?.agentName).toBe('reviewer');
  });

  it('tolerates a structurally-wrong store file by starting empty', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: RUN_STORE_VERSION, runs: 'not-an-array' }),
      'utf8',
    );
    const store = new RunStore(file);
    expect(store.list()).toEqual([]);
    store.add(run());
    expect(store.list()).toHaveLength(1);
  });

  it('filters out persisted records missing an identityKey or runId', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: RUN_STORE_VERSION, runs: [run(), { agentName: 'x' }] }),
      'utf8',
    );
    expect(new RunStore(file).list()).toEqual([run()]);
  });

  it('discards a store written under an older schema version, then rebuilds', () => {
    writeFileSync(file, JSON.stringify({ version: RUN_STORE_VERSION - 1, runs: [run()] }), 'utf8');
    expect(new RunStore(file).list()).toEqual([]); // stale schema discarded

    const store = new RunStore(file);
    store.add(run());
    expect(store.list()).toHaveLength(1); // re-ingested under the current schema
  });
});
