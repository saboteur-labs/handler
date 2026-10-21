/**
 * Shared sub-transcript run metrics (subagent-run-capture FR-3, and the metric
 * half of FR-5 and FR-8).
 *
 * One computation reused by ingest, the SubagentStop hook, and `import-runlog`.
 * Everything is derived from the per-run sub-transcript alone; task
 * notifications are never a source here.
 */
import { readJsonl } from './jsonl.js';

/** The exact legacy `toolStats` key set; every key is always present. */
export const TOOL_STATS_KEYS = [
  'readCount',
  'searchCount',
  'bashCount',
  'editFileCount',
  'linesAdded',
  'linesRemoved',
  'otherToolCount',
] as const;

export type ToolStatsKey = (typeof TOOL_STATS_KEYS)[number];
export type ComputedToolStats = Record<ToolStatsKey, number>;

export interface ComputedRunMetrics {
  totalToolUseCount: number;
  /** Last entry timestamp minus first entry timestamp, in milliseconds. */
  totalDurationMs: number;
  /**
   * A final-turn context size, NOT a cumulative spend: the final assistant
   * turn's input + cache_read + cache_creation + output tokens.
   */
  totalTokens: number;
  toolStats: ComputedToolStats;
}

export interface RunMetricsResult {
  /** Undefined when the file has no usable data. */
  metrics: ComputedRunMetrics | undefined;
  /** True when the sub-transcript is missing, empty, unreadable or malformed (FR-5). */
  noUsableData: boolean;
}

/**
 * Map a tool name to its `toolStats` counter key.
 *
 * UNVERIFIED ASSUMPTION: the legacy tool-name to category mapping is not
 * determinable from this repo (the source data is gone), so this mapping is a
 * proposal and is NOT known to reproduce legacy values. Only the 7 key names
 * were verified. Mapping: Read to readCount; Grep and Glob to searchCount;
 * Bash to bashCount; Edit, Write, MultiEdit and NotebookEdit to editFileCount;
 * everything else to otherToolCount.
 */
export function toolStatsKeyFor(toolName: string): ToolStatsKey {
  switch (toolName) {
    case 'Read':
      return 'readCount';
    case 'Grep':
    case 'Glob':
      return 'searchCount';
    case 'Bash':
      return 'bashCount';
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'editFileCount';
    default:
      return 'otherToolCount';
  }
}

interface RawEntry {
  type?: unknown;
  timestamp?: unknown;
  message?: { content?: unknown; usage?: Record<string, unknown> } | null;
}

const NO_DATA: RunMetricsResult = { metrics: undefined, noUsableData: true };

function emptyToolStats(): ComputedToolStats {
  return {
    readCount: 0,
    searchCount: 0,
    bashCount: 0,
    editFileCount: 0,
    linesAdded: 0,
    linesRemoved: 0,
    otherToolCount: 0,
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Compute run metrics from a sub-transcript. Never throws: a missing, empty,
 * unreadable (e.g. a directory) or malformed file yields
 * `{ metrics: undefined, noUsableData: true }`. A file is usable when at least
 * one entry carries a parseable timestamp.
 *
 * `linesAdded` and `linesRemoved` are always 0: they cannot be derived
 * reliably from tool_use inputs (a Write does not reveal what it replaced, and
 * an Edit's old/new strings are not a diff), so they are emitted only to keep
 * the legacy key set complete.
 */
export function computeRunMetrics(sidechainPath: string): RunMetricsResult {
  let entries: RawEntry[];
  try {
    entries = readJsonl<RawEntry>(sidechainPath);
  } catch {
    return NO_DATA;
  }

  const stamps: number[] = [];
  const toolStats = emptyToolStats();
  let totalToolUseCount = 0;
  let totalTokens = 0;

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (typeof entry.timestamp === 'string') {
      const t = Date.parse(entry.timestamp);
      if (!Number.isNaN(t)) stamps.push(t);
    }
    if (entry.type !== 'assistant') continue;
    const message = entry.message;
    if (typeof message !== 'object' || message === null) continue;
    if (Array.isArray(message.content)) {
      for (const block of message.content as { type?: unknown; name?: unknown }[]) {
        if (block?.type !== 'tool_use') continue;
        totalToolUseCount += 1;
        toolStats[toolStatsKeyFor(typeof block.name === 'string' ? block.name : '')] += 1;
      }
    }
    const u = message.usage;
    if (typeof u === 'object' && u !== null) {
      totalTokens =
        num(u.input_tokens) +
        num(u.cache_read_input_tokens) +
        num(u.cache_creation_input_tokens) +
        num(u.output_tokens);
    }
  }

  if (stamps.length === 0) return NO_DATA;
  return {
    metrics: {
      totalToolUseCount,
      totalDurationMs: stamps[stamps.length - 1]! - stamps[0]!,
      totalTokens,
      toolStats,
    },
    noUsableData: false,
  };
}
