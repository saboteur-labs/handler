/**
 * Reader for the per-run `agent-<agentId>.meta.json` file that Claude Code
 * writes beside each subagent sidechain (spec FR-1, FR-8, FR-11).
 *
 * The reader is defensive: any missing, empty, malformed or unusable file
 * yields `undefined` instead of throwing, so one bad meta never aborts
 * discovery of other runs.
 */
import { readFileSync } from 'node:fs';

/** The fields handler consumes from a run's meta file. */
export interface SubagentMeta {
  /** The agent's name (required; a meta without one is unusable). */
  agentType: string;
  spawnDepth?: number;
  parentAgentId?: string;
  /**
   * Parsed as written but deliberately not a success signal: it is absent on
   * runs that completed normally, so consumers must not infer failure from it.
   */
  finished?: boolean;
}

/** Read and validate a meta file; `undefined` if absent, empty, or malformed. */
export function readMeta(metaPath: string): SubagentMeta | undefined {
  let raw: string;
  try {
    raw = readFileSync(metaPath, 'utf8');
  } catch {
    return undefined;
  }
  if (raw.trim() === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.agentType !== 'string' || obj.agentType === '') {
    return undefined;
  }
  const meta: SubagentMeta = { agentType: obj.agentType };
  if (typeof obj.spawnDepth === 'number' && Number.isFinite(obj.spawnDepth)) {
    meta.spawnDepth = obj.spawnDepth;
  }
  if (typeof obj.parentAgentId === 'string' && obj.parentAgentId !== '') {
    meta.parentAgentId = obj.parentAgentId;
  }
  if (typeof obj.finished === 'boolean') {
    meta.finished = obj.finished;
  }
  return meta;
}
