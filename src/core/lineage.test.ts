import { describe, expect, it } from 'vitest';

import { resolveParentAnnotation } from './lineage';
import type { Run } from './run';

/** Minimal Run stub for lineage tests — only fields used by resolveParentAnnotation. */
function makeRun(runId: string, agentName: string): Run {
  return {
    identityKey: `["user","/home/u","${agentName}"]`,
    runId,
    agentName,
    cwd: undefined,
    sessionId: undefined,
    sidechainPath: undefined,
    timestamp: undefined,
    status: undefined,
    totalDurationMs: undefined,
    totalTokens: undefined,
    totalToolUseCount: undefined,
    toolStats: undefined,
    definitionSnapshot: null,
    tags: [],
  };
}

describe('resolveParentAnnotation (V1 Feature 7, Task 6)', () => {
  it('returns "spawned by <agentName>" when a run matching parentAgentId is found', () => {
    const parent = makeRun('parent-run-id', 'orchestrator');
    const child = makeRun('child-run-id', 'worker');
    const allRuns: readonly Run[] = [parent, child];

    expect(resolveParentAnnotation('parent-run-id', allRuns)).toBe('spawned by orchestrator');
  });

  it('returns "spawned by <parentAgentId>" (raw id) when no matching run is found', () => {
    const run = makeRun('some-run-id', 'worker');
    const allRuns: readonly Run[] = [run];

    expect(resolveParentAnnotation('unknown-parent-id', allRuns)).toBe(
      'spawned by unknown-parent-id',
    );
  });

  it('returns "spawned by <parentAgentId>" (raw id) when allRuns is empty', () => {
    expect(resolveParentAnnotation('some-parent-id', [])).toBe('spawned by some-parent-id');
  });

  it('uses the first matching run when multiple runs share the same runId', () => {
    const first = makeRun('shared-id', 'first-agent');
    const second = makeRun('shared-id', 'second-agent');
    const allRuns: readonly Run[] = [first, second];

    expect(resolveParentAnnotation('shared-id', allRuns)).toBe('spawned by first-agent');
  });
});
