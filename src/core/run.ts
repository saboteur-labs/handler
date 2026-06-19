/**
 * Attributed run model & assembly (spec Reqs 2, 3, 6, 9).
 *
 * `assembleRun` is the ingest seam: it takes an extracted `RawRun`, attributes
 * it to a single agent identity via Feature 1's `resolveAgent`, snapshots the
 * definition that was in effect, and tags anything off-normal. Built-in/plugin
 * runs and runs matching no registered source are dropped — the only drops.
 * Everything else is kept and tagged (Req 6): `incomplete` for a run without a
 * completed summary, `orphan` when the definition can't be found.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isBuiltinAgent } from './denylist';
import { agentIdentity, type AgentIdentity, identityKey } from './identity';
import { loadDefinitionSnapshot } from './snapshot';
import { resolveAgent } from './resolve';
import type { AgentSource } from './sources/source';
import type { RawRun, ToolStats } from './transcripts/extract';
import {
  latencyDistribution,
  readTelemetry,
  type LatencyDistribution,
  type RunTelemetry,
} from './transcripts/telemetry';

export type { ToolStats } from './transcripts/extract';

/** A non-fatal observation about a run that is kept rather than dropped. */
export type RunTag = 'incomplete' | 'orphan';

/** Persisted per-run telemetry: the parsed turns plus the derived latency. */
export interface RunTelemetrySummary extends RunTelemetry {
  readonly latency: LatencyDistribution | undefined;
}

/** An attributed, snapshotted run ready to persist. */
export interface Run {
  /** Serialized agent identity (Req 8) — the per-agent join key. */
  readonly identityKey: string;
  /** The run's `agentId`, unique per run within an agent. */
  readonly runId: string;
  readonly agentName: string;
  /** The run's recorded working directory; the implicit scope for boundary checks. */
  readonly cwd: string | undefined;
  /** Parent session id, part of the sub-transcript locator. */
  readonly sessionId: string | undefined;
  /** Path to the per-run sub-transcript, or `undefined` when not locatable. */
  readonly sidechainPath: string | undefined;
  /** ISO 8601 timestamp of the run, used for last-used metrics. */
  readonly timestamp: string | undefined;
  readonly status: string | undefined;
  readonly totalDurationMs: number | undefined;
  readonly totalTokens: number | undefined;
  readonly totalToolUseCount: number | undefined;
  readonly toolStats: ToolStats | undefined;
  /** Definition content at run time, or `null` when not found (orphan). */
  readonly definitionSnapshot: string | null;
  readonly tags: readonly RunTag[];
  /** Per-run telemetry from the sub-transcript; absent when not locatable. */
  readonly telemetry?: RunTelemetrySummary;
  /**
   * How this record was last written. `'transcript'` means the full attributed
   * record was assembled from a parsed JSONL transcript (authoritative);
   * `'hook'` means it was written as a real-time stub by the SubagentStop hook
   * handler (may be superseded by a subsequent transcript ingest).
   * `undefined` for records written before this field was introduced.
   */
  readonly source?: 'hook' | 'transcript';
  /**
   * The `agentId` of the parent subagent when this run was spawned by another
   * subagent (nested subagent capture). `undefined` for top-level runs or for
   * records written before this field was introduced.
   */
  readonly parentAgentId?: string;
}

/**
 * Attribute and snapshot a `RawRun` against the registered `sources`, or return
 * `null` when the run names a built-in/plugin agent or matches no source.
 *
 * When processing a sidechain file, pass `parentAgentId` (extracted from the
 * sidechain filename) so the returned `Run` records the nesting relationship.
 */
export function assembleRun(
  raw: RawRun,
  sources: readonly AgentSource[],
  transcriptPath: string,
  parentAgentId?: string,
): Run | null {
  const identity = resolveRunIdentity(raw, sources);
  if (identity === null) {
    return null;
  }
  const source = sources.find(
    (s) => s.type === identity.sourceType && s.root === identity.sourcePath,
  );
  const definitionSnapshot = source ? loadDefinitionSnapshot(source, identity.name) : null;

  const tags: RunTag[] = [];
  if (raw.incomplete) {
    tags.push('incomplete');
  }
  if (definitionSnapshot === null) {
    tags.push('orphan');
  }

  const sidechainPath = sidechainPathFor(raw, transcriptPath);

  return {
    identityKey: identityKey(identity),
    runId: raw.agentId,
    agentName: identity.name,
    cwd: raw.cwd,
    sessionId: raw.sessionId,
    sidechainPath,
    timestamp: raw.timestamp,
    status: raw.status,
    totalDurationMs: raw.totalDurationMs,
    totalTokens: raw.totalTokens,
    totalToolUseCount: raw.totalToolUseCount,
    toolStats: raw.toolStats,
    definitionSnapshot,
    tags,
    telemetry: readRunTelemetry(sidechainPath),
    parentAgentId,
  };
}

/**
 * Parse the run's per-turn telemetry from its sub-transcript, or `undefined`
 * when the sidechain is missing (interrupted/orphan runs, or rotated history).
 * The latency distribution is derived from the parsed turns at the same time.
 */
function readRunTelemetry(sidechainPath: string | undefined): RunTelemetrySummary | undefined {
  if (sidechainPath === undefined || !existsSync(sidechainPath)) {
    return undefined;
  }
  const telemetry = readTelemetry(sidechainPath);
  return { ...telemetry, latency: latencyDistribution(telemetry.turns) };
}

/**
 * Derive the per-run sub-transcript path. Claude Code stores it at
 * `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl`, alongside the
 * parent transcript. Returns `undefined` when the session id is missing, so
 * scoring can tell a locatable run from one it cannot reach.
 */
function sidechainPathFor(raw: RawRun, transcriptPath: string): string | undefined {
  if (raw.sessionId === undefined) {
    return undefined;
  }
  return join(dirname(transcriptPath), raw.sessionId, 'subagents', `agent-${raw.agentId}.jsonl`);
}

/**
 * Resolve a run to an identity. With a recorded `cwd`, defer to Feature 1's
 * nearest-ancestor rule; without one (a malformed entry), fall back to the
 * user-level source rather than misattributing by an assumed `cwd`.
 */
function resolveRunIdentity(raw: RawRun, sources: readonly AgentSource[]): AgentIdentity | null {
  if (raw.cwd !== undefined) {
    return resolveAgent(raw.agentType, raw.cwd, sources);
  }
  if (isBuiltinAgent(raw.agentType)) {
    return null;
  }
  const userSourceMatch = sources.find((s) => s.type === 'user');
  return userSourceMatch ? agentIdentity(userSourceMatch, raw.agentType) : null;
}
