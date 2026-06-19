/**
 * Tests for getRunTranscript (GUI core API — Req 53).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Run } from '../run';
import { getRunTranscript } from './transcript';

function makeRun(overrides: Partial<Run> & { runId: string }): Run {
  return {
    identityKey: JSON.stringify(['user', '/home/user/.claude/agents', 'test-agent']),
    agentName: 'test-agent',
    cwd: '/home/user',
    sessionId: 'session-1',
    sidechainPath: undefined,
    timestamp: '2024-01-01T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: {},
    definitionSnapshot: 'description: test',
    tags: [],
    ...overrides,
  };
}

describe('getRunTranscript', () => {
  it('returns null when the runId is not found in allRuns', () => {
    const runs: Run[] = [makeRun({ runId: 'run-1' })];
    const result = getRunTranscript('nonexistent-run', runs);
    expect(result).toBeNull();
  });

  it('returns null when the run is found but sidechainPath is undefined', () => {
    const run = makeRun({ runId: 'run-1', sidechainPath: undefined });
    const result = getRunTranscript('run-1', [run]);
    expect(result).toBeNull();
  });

  it('returns null when the run status is incomplete', () => {
    const run = makeRun({
      runId: 'run-1',
      sidechainPath: '/some/path/agent-run-1.jsonl',
      status: 'incomplete',
    });
    const result = getRunTranscript('run-1', [run]);
    expect(result).toBeNull();
  });

  it('returns null when the run status is orphan', () => {
    const run = makeRun({
      runId: 'run-1',
      sidechainPath: '/some/path/agent-run-1.jsonl',
      status: 'orphan',
    });
    const result = getRunTranscript('run-1', [run]);
    expect(result).toBeNull();
  });

  it('returns RunTranscript when run is found with a valid sidechain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handler-transcript-test-'));
    const sidechainPath = join(dir, 'agent-run-1.jsonl');

    const userEntry = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Do the task.' }],
      },
    });
    const assistantEntry = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done.' }],
      },
    });
    writeFileSync(sidechainPath, `${userEntry}\n${assistantEntry}\n`, 'utf8');

    const run = makeRun({
      runId: 'run-1',
      sidechainPath,
      status: 'completed',
    });

    const result = getRunTranscript('run-1', [run]);

    expect(result).not.toBeNull();
    expect(result?.taskPrompt).toBe('Do the task.');
    expect(result?.turns).toHaveLength(1);
    expect(result?.turns[0]?.textBlocks[0]).toBe('Done.');
    expect(result?.stopReason).toBe('end_turn');
  });
});
