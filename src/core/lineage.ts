/**
 * Lineage resolution for nested subagent runs (V1 Feature 7).
 *
 * Provides a pure utility for resolving a `parentAgentId` to a human-readable
 * annotation string for use in `show` and `trend` output. No I/O — callers
 * pass the already-loaded run list.
 */
import type { Run } from './run';

/**
 * Resolve a `parentAgentId` to a human-readable "spawned by" annotation.
 *
 * When a run with `runId === parentAgentId` exists in `allRuns`, returns
 * `"spawned by <agentName>"` using the parent run's `agentName`. When no match
 * is found (parent not yet ingested or definition gone), returns
 * `"spawned by <parentAgentId>"` — the raw id — without throwing. Multiple
 * matches use the first (deterministic).
 */
export function resolveParentAnnotation(parentAgentId: string, allRuns: readonly Run[]): string {
  const parent = allRuns.find((r) => r.runId === parentAgentId);
  return parent !== undefined ? `spawned by ${parent.agentName}` : `spawned by ${parentAgentId}`;
}
