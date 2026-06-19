/**
 * Run transcript reader (feature-8 Reqs 45–47).
 *
 * Reads a run's per-run sidechain JSONL into a structured `RunTranscript`
 * containing the task prompt, per-assistant-turn text and tool-call detail
 * (with tool results attached), and the terminal stop reason.
 *
 * Parsing is defensive — a missing or malformed sidechain yields an empty
 * result rather than throwing. Tool result content is truncated to
 * `truncateBytes` (default 2048) unless `full: true` is set.
 */
import { readJsonl } from './jsonl';
export type { StopReason } from './telemetry';
import type { StopReason } from './telemetry';

export interface ReadTranscriptOptions {
  /** Maximum bytes to keep per tool result content. Default: 2048. */
  truncateBytes?: number;
  /** When true, disables truncation regardless of truncateBytes. */
  full?: boolean;
}

export interface TranscriptToolResult {
  readonly toolUseId: string;
  readonly isError: boolean;
  readonly content: string;
  readonly truncated: boolean;
}

export interface TranscriptToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly result: TranscriptToolResult | undefined;
}

export interface TranscriptTurn {
  readonly textBlocks: readonly string[];
  readonly toolCalls: readonly TranscriptToolCall[];
}

export interface RunTranscript {
  readonly taskPrompt: string | undefined;
  readonly turns: readonly TranscriptTurn[];
  readonly stopReason: StopReason | undefined;
}

/** Mutable pending tool call before its result has been attached. */
interface PendingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: TranscriptToolResult | undefined;
}

/** Pending assistant turn buffered until the following user entry arrives. */
interface PendingTurn {
  textBlocks: string[];
  toolCalls: PendingToolCall[];
}

/**
 * Read the sidechain JSONL at `sidechainPath` into a `RunTranscript`.
 * Returns `{ taskPrompt: undefined, turns: [], stopReason: undefined }` when
 * the file is missing or empty — never throws on bad input.
 */
export function readTranscript(
  sidechainPath: string,
  options?: ReadTranscriptOptions,
): RunTranscript {
  const maxBytes = options?.full === true ? Infinity : (options?.truncateBytes ?? 2048);
  const entries = readJsonl(sidechainPath);

  const turns: TranscriptTurn[] = [];
  let taskPrompt: string | undefined;
  let stopReason: StopReason | undefined;
  let firstUserSeen = false;
  let pending: PendingTurn | undefined;

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }
    const type = entry['type'];
    const message = isRecord(entry['message']) ? entry['message'] : undefined;
    if (message === undefined) {
      continue;
    }
    const blocks = contentBlocks(message);

    if (type === 'user') {
      if (!firstUserSeen) {
        firstUserSeen = true;
        taskPrompt = extractTaskPrompt(message);
      }

      // Attach tool results to the buffered assistant turn's pending tool calls.
      if (pending !== undefined) {
        for (const block of blocks) {
          if (block['type'] !== 'tool_result') {
            continue;
          }
          const toolUseId = block['tool_use_id'];
          if (typeof toolUseId !== 'string' || toolUseId === '') {
            continue;
          }
          const match = pending.toolCalls.find((c) => c.id === toolUseId);
          if (match === undefined) {
            continue;
          }
          const content = flattenContent(block['content']);
          const isError = block['is_error'] === true;
          const { text: truncatedContent, truncated } = applyTruncation(content, maxBytes);
          match.result = { toolUseId, isError, content: truncatedContent, truncated };
        }

        // Emit the completed turn.
        turns.push({ textBlocks: pending.textBlocks, toolCalls: pending.toolCalls });
        pending = undefined;
      }
    } else if (type === 'assistant') {
      // Flush any pending turn that had no following user entry.
      if (pending !== undefined) {
        turns.push({ textBlocks: pending.textBlocks, toolCalls: pending.toolCalls });
        pending = undefined;
      }

      // Collect text blocks and tool_use blocks from this assistant message.
      const textBlocks: string[] = [];
      const toolCalls: PendingToolCall[] = [];

      for (const block of blocks) {
        if (block['type'] === 'text' && typeof block['text'] === 'string') {
          textBlocks.push(block['text']);
        } else if (block['type'] === 'tool_use') {
          const id = block['id'];
          const name = block['name'];
          const input = isRecord(block['input']) ? block['input'] : {};
          if (typeof id === 'string' && id !== '' && typeof name === 'string' && name !== '') {
            toolCalls.push({ id, name, input, result: undefined });
          }
        }
      }

      // Track stop_reason; only 'end_turn' and 'max_tokens' are surfaced.
      const normalized = normalizeStop(message['stop_reason']);
      if (normalized !== undefined) {
        stopReason = normalized;
      }

      // Buffer this turn; it will be emitted when the next user entry arrives
      // (so tool results can be attached first).
      pending = { textBlocks, toolCalls };
    }
  }

  // Flush any remaining pending turn (no trailing user entry).
  if (pending !== undefined) {
    turns.push({ textBlocks: pending.textBlocks, toolCalls: pending.toolCalls });
  }

  return { taskPrompt, turns, stopReason };
}

/** Map raw stop_reason to the `StopReason` union; ignore unknown values. */
function normalizeStop(value: unknown): StopReason | undefined {
  if (value === 'end_turn') return 'end_turn';
  if (value === 'max_tokens') return 'max_tokens';
  return undefined;
}

/** Flatten tool result `content` (string or array of text blocks) to a string. */
function flattenContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && typeof item['text'] === 'string' ? item['text'] : ''))
      .join('');
  }
  return '';
}

/**
 * Truncate a UTF-8 string to at most `maxBytes` bytes.
 * Returns the (possibly truncated) string and a flag indicating truncation.
 */
function applyTruncation(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (!isFinite(maxBytes)) {
    return { text, truncated: false };
  }
  const byteLen = Buffer.byteLength(text, 'utf8');
  if (byteLen <= maxBytes) {
    return { text, truncated: false };
  }
  const buf = Buffer.from(text, 'utf8').subarray(0, maxBytes);
  return { text: buf.toString('utf8'), truncated: true };
}

/**
 * The first user entry's task prompt. Claude Code records it either as a plain
 * string `message.content` (the common sub-agent shape, confirmed against real
 * `~/.claude` data) or as an array of content blocks, where the prompt is the
 * text-type (non-`tool_result`) blocks. Returns `undefined` when neither yields
 * text (e.g. a first user entry carrying only tool results).
 */
function extractTaskPrompt(message: Record<string, unknown>): string | undefined {
  const content = message['content'];
  if (typeof content === 'string') {
    return content.length > 0 ? content : undefined;
  }
  const textParts = contentBlocks(message)
    .filter((b) => b['type'] === 'text' && typeof b['text'] === 'string')
    .map((b) => b['text'] as string);
  return textParts.length > 0 ? textParts.join('') : undefined;
}

/** The `message.content` blocks of a message, or `[]` when absent/misshaped. */
function contentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message['content']) ? message['content'].filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
