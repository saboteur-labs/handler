import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Run } from '../run';
import { ScoreStore } from '../store/score-store';
import { RUBRIC_VERSION } from './rubric';
import { scoreRun } from './score';

const CWD = '/home/u/repo';

describe('scoreRun', () => {
  let dir: string;
  let sidechainPath: string;
  let store: ScoreStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-score-'));
    sidechainPath = join(dir, 'agent-r1.jsonl');
    store = new ScoreStore(join(dir, 'scores.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSidechain(...blocks: unknown[]): void {
    const entries = blocks.map((content) => ({ type: 'user', cwd: CWD, message: { content } }));
    writeFileSync(sidechainPath, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf8');
  }

  function makeRun(overrides: Partial<Run> = {}): Run {
    return {
      identityKey: '["repo","/r","a"]',
      runId: 'r1',
      agentName: 'a',
      cwd: CWD,
      sessionId: 's',
      sidechainPath,
      timestamp: '2026-06-17T10:00:00.000Z',
      status: 'completed',
      totalDurationMs: 1,
      totalTokens: 1,
      totalToolUseCount: 1,
      toolStats: {},
      definitionSnapshot: '---\ntools: Bash\n---\nbody',
      tags: [],
      ...overrides,
    };
  }

  it('scores a run end-to-end and persists the annotation', () => {
    writeSidechain([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]);
    const result = scoreRun(makeRun(), store);
    expect(result?.band).toBe('pass');
    expect(result?.composite).toBe(100);
    expect(store.get('r1', RUBRIC_VERSION)?.composite).toBe(100);
  });

  it('reflects a tool error as a warn', () => {
    writeSidechain(
      [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
      [{ type: 'tool_result', is_error: true, content: 'Exit code 1' }],
    );
    expect(scoreRun(makeRun(), store)?.band).toBe('warn');
  });

  it('returns the cached score without recomputing once stored', () => {
    writeSidechain([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]);
    const first = scoreRun(makeRun(), store);
    rmSync(sidechainPath); // a recompute would now see empty activity and differ
    const second = scoreRun(makeRun(), store);
    expect(second).toEqual(first);
    expect(second?.composite).toBe(100);
  });

  it('returns null (unscored) when the run has no sidechain locator', () => {
    expect(scoreRun(makeRun({ sidechainPath: undefined }), store)).toBeNull();
  });

  it('returns null when the sidechain file is missing (interrupted run)', () => {
    expect(scoreRun(makeRun({ sidechainPath: join(dir, 'gone.jsonl') }), store)).toBeNull();
  });
});
