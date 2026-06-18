/**
 * Per-turn telemetry parser (feature-6 Reqs 1, 3).
 *
 * Reads a run's per-run sub-transcript (the sidechain JSONL) into the detail
 * the richer run record needs: token usage, timestamp, and model for each
 * assistant turn; the run-level stop reason; the files the run edited; its
 * `TodoWrite` planning activity; the tool errors it hit (with any `Bash` exit
 * code); and the count of error→retry loops. Everything is derived locally from
 * the transcript — no network, no LLM.
 *
 * Shapes follow the sidechain layout already relied on by `readActivity`:
 * assistant entries carry `message.usage` (`input_tokens`, `output_tokens`,
 * `cache_read_input_tokens`, `cache_creation_input_tokens`), `message.model`,
 * `message.stop_reason`, and `tool_use` content blocks (`id`, `name`, `input`),
 * with the entry's ISO `timestamp` alongside; user entries carry `tool_result`
 * blocks (`tool_use_id`, `is_error`, `content`). Confirmed against real
 * `~/.claude` data: Bash failures have no structured exit-code field — they
 * surface as `is_error` results whose content text begins `Exit code N`, so the
 * code is parsed from that payload and is `undefined` when absent. Interruption
 * is detected by the deterministic marker Claude Code writes, mirroring the
 * denial-string approach in `activity.ts`. Parsing is defensive — a missing or
 * malformed sidechain yields empty telemetry rather than throwing.
 *
 * Kept separate from `readActivity` for now; a later refactor may unify the
 * single sidechain walk once both parsers settle.
 */
import { toolSignature } from '../scoring/signature';
import { readJsonl } from './jsonl';

export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

export interface Turn {
  readonly usage: TurnUsage;
  /** ISO 8601 entry timestamp, or `undefined` when absent. */
  readonly timestamp: string | undefined;
  /** Model id for the turn, or `undefined` when absent. */
  readonly model: string | undefined;
}

/** A tool error the run hit, with any parsed `Bash` exit code. */
export interface ToolError {
  /** Exit code parsed from an `Exit code N` payload, or `undefined`. */
  readonly exitCode: number | undefined;
  /** The error payload text. */
  readonly message: string;
}

/** Inter-turn latency summary, in milliseconds. */
export interface LatencyDistribution {
  readonly p50Ms: number;
  readonly p95Ms: number;
}

/** How the run ended, when determinable from the transcript. */
export type StopReason = 'end_turn' | 'max_tokens' | 'interrupted';

export interface RunTelemetry {
  /** Assistant turns that reported a token-usage object, in order. */
  readonly turns: readonly Turn[];
  /** Terminal stop reason, or `undefined` when not determinable. */
  readonly stopReason: StopReason | undefined;
  /** Distinct file paths the run edited (Edit/Write/MultiEdit), first-seen order. */
  readonly filesEdited: readonly string[];
  /** Number of `TodoWrite` calls — a planning-activity proxy. */
  readonly todoWrites: number;
  /** Tool errors hit by the run, denials excluded. */
  readonly toolErrors: readonly ToolError[];
  /** Distinct tool signatures that errored and were then retried. */
  readonly retryLoops: number;
}

/** The deterministic marker Claude Code writes when a turn is interrupted. */
const INTERRUPTION = /\[request interrupted/i;
/** The denial marker (mirrors `activity.ts`); denials are not counted as errors. */
const DENIAL = /permission to use\b[\s\S]*\bdenied/i;
/** Leading `Exit code N` line on a failed `Bash` result's payload. */
const EXIT_CODE = /^Exit code (\d+)/;
/** Tools whose `file_path` input marks an edited file. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

interface CallRef {
  readonly signature: string;
  readonly id: string | undefined;
}

/** Parse the sidechain transcript at `sidechainPath` into per-turn telemetry. */
export function readTelemetry(sidechainPath: string): RunTelemetry {
  const turns: Turn[] = [];
  const filesEdited: string[] = [];
  const calls: CallRef[] = [];
  const erroredIds = new Set<string>();
  const toolErrors: ToolError[] = [];
  let todoWrites = 0;
  let lastStop: StopReason | undefined;
  let interrupted = false;

  for (const entry of readJsonl(sidechainPath)) {
    if (!isRecord(entry)) {
      continue;
    }
    if (containsInterruption(entry)) {
      interrupted = true;
    }
    const message = isRecord(entry.message) ? entry.message : undefined;
    if (message === undefined) {
      continue;
    }
    if (isRecord(message.usage)) {
      turns.push({
        usage: parseUsage(message.usage),
        timestamp: isNonEmptyString(entry.timestamp) ? entry.timestamp : undefined,
        model: isNonEmptyString(message.model) ? message.model : undefined,
      });
    }
    const stop = normalizeStop(message.stop_reason);
    if (stop !== undefined) {
      lastStop = stop;
    }
    for (const block of contentBlocks(message)) {
      if (block.type === 'tool_use' && isNonEmptyString(block.name)) {
        const input = isRecord(block.input) ? block.input : {};
        calls.push({
          signature: toolSignature(block.name, input),
          id: isNonEmptyString(block.id) ? block.id : undefined,
        });
        if (block.name === 'TodoWrite') {
          todoWrites += 1;
        } else if (EDIT_TOOLS.has(block.name) && isNonEmptyString(input.file_path)) {
          if (!filesEdited.includes(input.file_path)) {
            filesEdited.push(input.file_path);
          }
        }
      } else if (block.type === 'tool_result') {
        const text = textOf(block.content);
        if (block.is_error === true && !DENIAL.test(text)) {
          toolErrors.push({ exitCode: parseExitCode(text), message: text });
          if (isNonEmptyString(block.tool_use_id)) {
            erroredIds.add(block.tool_use_id);
          }
        }
      }
    }
  }

  return {
    turns,
    stopReason: interrupted ? 'interrupted' : lastStop,
    filesEdited,
    todoWrites,
    toolErrors,
    retryLoops: countRetryLoops(calls, erroredIds),
  };
}

/**
 * Count distinct tool signatures that errored and were then retried: a group of
 * identical calls where an errored occurrence is followed by a later one.
 */
function countRetryLoops(calls: readonly CallRef[], erroredIds: ReadonlySet<string>): number {
  const groups = new Map<string, boolean[]>();
  for (const call of calls) {
    const errored = call.id !== undefined && erroredIds.has(call.id);
    const group = groups.get(call.signature) ?? [];
    group.push(errored);
    groups.set(call.signature, group);
  }
  let loops = 0;
  for (const group of groups.values()) {
    if (group.slice(0, -1).some((errored) => errored)) {
      loops += 1;
    }
  }
  return loops;
}

/**
 * Inter-turn latency p50/p95 (nearest-rank) over the turns that carry a
 * timestamp, in order. Returns `undefined` when fewer than two timestamped
 * turns exist, since latency needs at least one interval.
 */
export function latencyDistribution(turns: readonly Turn[]): LatencyDistribution | undefined {
  const times: number[] = [];
  for (const turn of turns) {
    const ms = turn.timestamp === undefined ? NaN : Date.parse(turn.timestamp);
    if (!Number.isNaN(ms)) {
      times.push(ms);
    }
  }
  if (times.length < 2) {
    return undefined;
  }
  const intervals: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    intervals.push(times[i]! - times[i - 1]!);
  }
  intervals.sort((a, b) => a - b);
  return { p50Ms: percentile(intervals, 50), p95Ms: percentile(intervals, 95) };
}

/** Nearest-rank percentile of an ascending-sorted, non-empty list. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

function parseUsage(usage: Record<string, unknown>): TurnUsage {
  return {
    inputTokens: numberOf(usage.input_tokens),
    outputTokens: numberOf(usage.output_tokens),
    cacheReadTokens: numberOf(usage.cache_read_input_tokens),
    cacheCreationTokens: numberOf(usage.cache_creation_input_tokens),
  };
}

/** Parse a leading `Exit code N` from an error payload, or `undefined`. */
function parseExitCode(text: string): number | undefined {
  const match = EXIT_CODE.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** Map a raw `stop_reason` to the reasons we surface; ignore others (e.g. `tool_use`). */
function normalizeStop(value: unknown): StopReason | undefined {
  if (value === 'end_turn') {
    return 'end_turn';
  }
  if (value === 'max_tokens') {
    return 'max_tokens';
  }
  return undefined;
}

/** True when the entry carries the Claude Code interruption marker in its content. */
function containsInterruption(entry: Record<string, unknown>): boolean {
  const message = entry.message;
  if (!isRecord(message)) {
    return false;
  }
  return INTERRUPTION.test(textOf(message.content));
}

/** The `message.content` blocks of a message, or `[]` when absent/misshaped. */
function contentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : [];
}

/** Flatten message content (string, or text blocks) to searchable text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .join(' ');
  }
  return '';
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
