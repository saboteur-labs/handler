/**
 * Shared capture assembler (subagent-run-capture FR-2, FR-5, FR-9, FR-10, FR-11).
 *
 * Turns an agent id, agent type and sub-transcript path (plus optional meta,
 * notification status and fallback values) into an attributed `Run`. Shared by
 * ingest, the SubagentStop hook and `import-runlog`. Everything per-run is
 * derived from the sub-transcript; the legacy `assembleRun` is untouched.
 */
import { existsSync } from 'node:fs';

import { identityKey } from './identity';
import { resolveRunIdentity, summarizeTelemetry, type Run, type RunTag } from './run';
import { loadDefinitionSnapshot } from './snapshot';
import type { AgentSource } from './sources/source';
import { readJsonl } from './transcripts/jsonl';
import type { SubagentMeta } from './transcripts/meta';
import type { NotificationStatus } from './transcripts/notifications';
import { computeRunMetricsFromEntries } from './transcripts/run-metrics';

/** Values used only when the sub-transcript does not carry them. */
export interface CaptureFallback {
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly timestamp?: string;
}

export interface CaptureInput {
  readonly agentId: string;
  readonly agentType: string;
  /** Stored on the run exactly as passed. */
  readonly sidechainPath: string;
  readonly status?: NotificationStatus;
  readonly meta?: SubagentMeta;
  readonly fallback?: CaptureFallback;
}

export interface TranscriptFacts {
  cwd: string | undefined;
  sessionId: string | undefined;
  timestamp: string | undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** First cwd, sessionId and parseable timestamp found in the parsed sub-transcript entries. */
export function transcriptFactsFromEntries(entries: readonly unknown[]): TranscriptFacts {
  const facts: TranscriptFacts = { cwd: undefined, sessionId: undefined, timestamp: undefined };
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    facts.cwd ??= nonEmptyString(e.cwd);
    facts.sessionId ??= nonEmptyString(e.sessionId);
    const ts = nonEmptyString(e.timestamp);
    if (facts.timestamp === undefined && ts !== undefined && !Number.isNaN(Date.parse(ts))) {
      facts.timestamp = ts;
    }
  }
  return facts;
}

/** Parse the sub-transcript once, or `undefined` when it cannot be read. */
function readEntriesOnce(sidechainPath: string): unknown[] | undefined {
  try {
    return readJsonl(sidechainPath);
  } catch {
    return undefined;
  }
}

/**
 * Assemble an attributed run, or `null` for built-in/plugin agents and runs
 * matching no registered source. Missing definitions are kept as `orphan`; a
 * missing, empty, unreadable or unusable sub-transcript is kept as `incomplete`.
 */
export function assembleCapturedRun(
  input: CaptureInput,
  sources: readonly AgentSource[],
): Run | null {
  // One parse feeds the facts, the metrics and the telemetry (FR-36).
  const entries = readEntriesOnce(input.sidechainPath);
  const facts = transcriptFactsFromEntries(entries ?? []);
  const cwd = facts.cwd ?? input.fallback?.cwd;
  const identity = resolveRunIdentity({ agentType: input.agentType, cwd }, sources);
  if (identity === null) {
    return null;
  }
  const source = sources.find(
    (s) => s.type === identity.sourceType && s.root === identity.sourcePath,
  );
  const definitionSnapshot = source ? loadDefinitionSnapshot(source, identity.name) : null;

  const { metrics, noUsableData } =
    entries === undefined
      ? { metrics: undefined, noUsableData: true }
      : computeRunMetricsFromEntries(entries);
  const tags: RunTag[] = [];
  if (noUsableData) tags.push('incomplete');
  if (definitionSnapshot === null) tags.push('orphan');

  return {
    identityKey: identityKey(identity),
    runId: input.agentId,
    agentName: identity.name,
    cwd,
    sessionId: facts.sessionId ?? input.fallback?.sessionId,
    sidechainPath: input.sidechainPath,
    timestamp: facts.timestamp ?? input.fallback?.timestamp,
    status: input.status,
    totalDurationMs: metrics?.totalDurationMs,
    totalTokens: metrics?.totalTokens,
    totalToolUseCount: metrics?.totalToolUseCount,
    toolStats: metrics?.toolStats,
    definitionSnapshot,
    tags,
    telemetry:
      entries === undefined || !existsSync(input.sidechainPath)
        ? undefined
        : summarizeTelemetry(entries),
    ...(input.meta?.parentAgentId !== undefined && { parentAgentId: input.meta.parentAgentId }),
    ...(input.meta?.spawnDepth !== undefined && { spawnDepth: input.meta.spawnDepth }),
  };
}
