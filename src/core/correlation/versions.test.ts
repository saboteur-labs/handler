import { describe, expect, it } from 'vitest';

import type { Run } from '../run';
import { segmentByDefinition } from './versions';

function run(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: 'user::/u::reviewer',
    runId: 'agent-1',
    agentName: 'reviewer',
    cwd: '/repo',
    sessionId: 'sess-1',
    sidechainPath: undefined,
    timestamp: '2026-06-18T10:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot: 'v1 body',
    tags: [],
    ...overrides,
  };
}

describe('segmentByDefinition', () => {
  it('groups contiguous runs sharing a snapshot into one version', () => {
    const { versions, changePoints } = segmentByDefinition([
      run({ runId: 'a', definitionSnapshot: 'v1 body', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'b', definitionSnapshot: 'v1 body', timestamp: '2026-06-18T10:01:00.000Z' }),
    ]);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.runs.map((r) => r.runId)).toEqual(['a', 'b']);
    expect(changePoints).toHaveLength(0);
  });

  it('emits a change point when the snapshot content changes', () => {
    const { versions, changePoints } = segmentByDefinition([
      run({ runId: 'a', definitionSnapshot: 'v1 body', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'b', definitionSnapshot: 'v2 body', timestamp: '2026-06-18T10:01:00.000Z' }),
    ]);
    expect(versions).toHaveLength(2);
    expect(changePoints).toHaveLength(1);
    expect(changePoints[0]?.before.runs.map((r) => r.runId)).toEqual(['a']);
    expect(changePoints[0]?.after.runs.map((r) => r.runId)).toEqual(['b']);
  });

  it('orders runs by timestamp before segmenting', () => {
    const { versions } = segmentByDefinition([
      run({ runId: 'late', definitionSnapshot: 'v2 body', timestamp: '2026-06-18T10:02:00.000Z' }),
      run({ runId: 'early', definitionSnapshot: 'v1 body', timestamp: '2026-06-18T10:00:00.000Z' }),
    ]);
    expect(versions.map((v) => v.runs.map((r) => r.runId))).toEqual([['early'], ['late']]);
  });

  it('treats a null (orphan) snapshot as an unknown boundary that never merges', () => {
    const { versions, changePoints } = segmentByDefinition([
      run({ runId: 'a', definitionSnapshot: 'v1 body', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'o', definitionSnapshot: null, timestamp: '2026-06-18T10:01:00.000Z' }),
      run({ runId: 'b', definitionSnapshot: 'v1 body', timestamp: '2026-06-18T10:02:00.000Z' }),
    ]);
    // A, unknown, A — the two A segments stay separate across the unknown gap.
    expect(versions).toHaveLength(3);
    expect(versions[1]?.snapshotHash).toBeNull();
    expect(versions[0]?.snapshotHash).toBe(versions[2]?.snapshotHash);
    expect(changePoints).toHaveLength(2);
  });

  it('does not merge contiguous orphan runs', () => {
    const { versions } = segmentByDefinition([
      run({ runId: 'o1', definitionSnapshot: null, timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'o2', definitionSnapshot: null, timestamp: '2026-06-18T10:01:00.000Z' }),
    ]);
    expect(versions).toHaveLength(2);
  });

  it('hashes identical content to the same key and different content apart', () => {
    const { versions } = segmentByDefinition([
      run({ runId: 'a', definitionSnapshot: 'same', timestamp: '2026-06-18T10:00:00.000Z' }),
      run({ runId: 'b', definitionSnapshot: 'other', timestamp: '2026-06-18T10:01:00.000Z' }),
      run({ runId: 'c', definitionSnapshot: 'same', timestamp: '2026-06-18T10:02:00.000Z' }),
    ]);
    expect(versions[0]?.snapshotHash).toBe(versions[2]?.snapshotHash);
    expect(versions[0]?.snapshotHash).not.toBe(versions[1]?.snapshotHash);
  });

  it('returns no versions or change points for no runs', () => {
    expect(segmentByDefinition([])).toEqual({ versions: [], changePoints: [] });
  });
});
