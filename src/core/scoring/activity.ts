/**
 * Run-activity parser (spec Reqs 7, 14; supports 4–8).
 *
 * Reads a run's per-run sub-transcript (the sidechain JSONL) into the
 * turn-level detail the deterministic checks need: the ordered tool calls the
 * agent made, the count of permission denials, and the count of tool errors.
 * Everything is derived locally from the transcript — no network, no LLM.
 *
 * Shapes confirmed against real `~/.claude` data: assistant entries carry
 * `tool_use` blocks (`name`, `input`) in `message.content`; user entries carry
 * `tool_result` blocks (`is_error`, `content`). A denial is the deterministic
 * string Claude Code writes when a tool is refused. Parsing is defensive — a
 * missing or malformed sidechain yields empty activity rather than throwing.
 */
import { readJsonl } from '../transcripts/jsonl';

export interface ToolCall {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface RunActivity {
  /** Tool invocations in the order they were made. */
  readonly toolCalls: readonly ToolCall[];
  /** Permission-denial events. */
  readonly denials: number;
  /** Tool-error events (`is_error`), excluding denials. */
  readonly errors: number;
  /** The run's working directory as recorded in the sidechain, if present. */
  readonly cwd: string | undefined;
}

const DENIAL = /permission to use\b[\s\S]*\bdenied/i;

/** Parse the sidechain transcript at `sidechainPath` into run activity. */
export function readActivity(sidechainPath: string): RunActivity {
  const toolCalls: ToolCall[] = [];
  let denials = 0;
  let errors = 0;
  let cwd: string | undefined;

  for (const entry of readJsonl(sidechainPath)) {
    if (!isRecord(entry)) {
      continue;
    }
    if (cwd === undefined && isNonEmptyString(entry.cwd)) {
      cwd = entry.cwd;
    }
    for (const block of contentBlocks(entry)) {
      if (block.type === 'tool_use' && isNonEmptyString(block.name)) {
        toolCalls.push({ name: block.name, input: isRecord(block.input) ? block.input : {} });
      } else if (block.type === 'tool_result') {
        if (DENIAL.test(textOf(block.content))) {
          denials += 1;
        } else if (block.is_error === true) {
          errors += 1;
        }
      }
    }
  }

  return { toolCalls, denials, errors, cwd };
}

/** The `message.content` blocks of an entry, or `[]` when absent/misshaped. */
function contentBlocks(entry: Record<string, unknown>): Record<string, unknown>[] {
  const message = entry.message;
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }
  return message.content.filter(isRecord);
}

/** Flatten a `tool_result.content` (string, or text blocks) to searchable text. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
