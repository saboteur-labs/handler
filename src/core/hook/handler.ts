/**
 * SubagentStop hook handler (V1 Feature 5, Task 3).
 *
 * `handleSubagentStop` is the single entry point for real-time run capture
 * from Claude Code's `SubagentStop` hook. It parses the raw payload, resolves
 * agent identity, assembles a `Run`, and upserts it into the store. All errors
 * are caught — the function never throws.
 */

import { assembleRun } from '../run';
import type { AgentSource } from '../sources/source';
import type { RunStore } from '../store/run-store';
import type { ToolStats } from '../transcripts/extract';

/** Outcome of a single hook invocation. */
export type HandleResult = 'captured' | 'skipped' | 'malformed';

/**
 * Handle a single `SubagentStop` hook invocation.
 *
 * - `'malformed'` — payload failed to parse; store is not touched.
 * - `'skipped'`   — agent is a builtin/plugin or unresolvable to any source;
 *                   store is not touched.
 * - `'captured'`  — run assembled and upserted into the store (includes orphan
 *                   and incomplete runs, which are kept-and-tagged per spec Req 7).
 *
 * Never throws.
 */
export function handleSubagentStop(
  payload: unknown,
  sources: readonly AgentSource[],
  store: RunStore,
): HandleResult {
  try {
    const parsed = parseLegacyHookPayload(payload);
    if (parsed === null) {
      return 'malformed';
    }

    // Pass an empty string for transcriptPath: with hook payloads the sidechain
    // file may not exist yet. assembleRun / readRunTelemetry tolerate a missing
    // file via the existsSync guard.
    const run = assembleRun(parsed, sources, '');
    if (run === null) {
      return 'skipped';
    }

    // "Transcript always wins": if a transcript-authoritative record already
    // exists for this run, do not overwrite it with the hook stub.
    const existing = store.forRun(run.identityKey, run.runId);
    if (existing?.source !== 'transcript') {
      store.upsert({ ...run, source: 'hook' });
    }
    return 'captured';
  } catch {
    return 'malformed';
  }
}

/**
 * Interim shim (Task 9): the camelCase, status-requiring payload the handler
 * accepted before `parseHookPayload` moved to the real snake_case payload.
 * Structurally a `RawRun`. Task 10 replaces this with the new parser.
 */
interface LegacyHookPayload {
  readonly agentId: string;
  readonly agentType: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly status: string;
  readonly totalDurationMs: number | undefined;
  readonly totalTokens: number | undefined;
  readonly totalToolUseCount: number | undefined;
  readonly toolStats: ToolStats | undefined;
  readonly timestamp: string | undefined;
  readonly incomplete: boolean;
}

function parseLegacyHookPayload(raw: unknown): LegacyHookPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { agentId, agentType, cwd, sessionId, status } = raw;
  if (
    !isNonEmptyString(agentId) ||
    !isNonEmptyString(agentType) ||
    !isNonEmptyString(cwd) ||
    !isNonEmptyString(sessionId) ||
    !isNonEmptyString(status)
  ) {
    return null;
  }
  return {
    agentId,
    agentType,
    cwd,
    sessionId,
    status,
    totalDurationMs: asFiniteNumber(raw.totalDurationMs),
    totalTokens: asFiniteNumber(raw.totalTokens),
    totalToolUseCount: asFiniteNumber(raw.totalToolUseCount),
    toolStats: asToolStats(raw.toolStats),
    timestamp: isNonEmptyString(raw.timestamp) ? raw.timestamp : undefined,
    incomplete: typeof raw.incomplete === 'boolean' ? raw.incomplete : false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asToolStats(value: unknown): ToolStats | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stats: Record<string, number> = {};
  for (const [key, n] of Object.entries(value)) {
    const v = asFiniteNumber(n);
    if (v !== undefined) {
      stats[key] = v;
    }
  }
  return stats;
}
