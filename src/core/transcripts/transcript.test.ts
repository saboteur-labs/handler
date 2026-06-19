/**
 * Tests for readTranscript (feature-8 Reqs 45–47).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTranscript } from './transcript';

describe('readTranscript', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-transcript-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSidechain(...entries: unknown[]): string {
    const file = join(dir, 'agent-x.jsonl');
    writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf8');
    return file;
  }

  // JSONL entry helpers
  const userEntry = (content: unknown[]): unknown => ({
    type: 'user',
    message: { role: 'user', content },
  });

  const assistantEntry = (content: unknown[], stopReason: string | null = null): unknown => ({
    type: 'assistant',
    message: {
      role: 'assistant',
      content,
      stop_reason: stopReason,
      model: 'claude-opus-4-5',
    },
  });

  const textBlock = (text: string): unknown => ({ type: 'text', text });

  const toolUseBlock = (id: string, name: string, input: Record<string, unknown>): unknown => ({
    type: 'tool_use',
    id,
    name,
    input,
  });

  const toolResultBlock = (
    toolUseId: string,
    content: string | unknown[],
    isError = false,
  ): unknown => ({ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content });

  // Req 46: missing file → safe empty result
  it('returns empty result for a missing file path without throwing', () => {
    const result = readTranscript(join(dir, 'nonexistent.jsonl'));
    expect(result).toEqual({ taskPrompt: undefined, turns: [], stopReason: undefined });
  });

  // Req 46: empty file → safe empty result
  it('returns empty result for an empty file', () => {
    const file = join(dir, 'empty.jsonl');
    writeFileSync(file, '', 'utf8');
    const result = readTranscript(file);
    expect(result).toEqual({ taskPrompt: undefined, turns: [], stopReason: undefined });
  });

  // Req 46: malformed lines → skipped, no throw
  it('skips malformed JSON lines and does not throw', () => {
    const file = join(dir, 'bad.jsonl');
    writeFileSync(file, 'not json\n{"broken":\n', 'utf8');
    expect(() => readTranscript(file)).not.toThrow();
    const result = readTranscript(file);
    expect(result.turns).toHaveLength(0);
  });

  // Req 45: first user entry with text type → taskPrompt populated
  it('extracts taskPrompt from first user entry text blocks', () => {
    const file = writeSidechain(userEntry([textBlock('Implement the feature')]));
    const result = readTranscript(file);
    expect(result.taskPrompt).toBe('Implement the feature');
    expect(result.turns).toHaveLength(0);
  });

  // Req 45: first user entry with only tool_result blocks → taskPrompt undefined
  it('returns taskPrompt undefined when first user entry has only tool_result blocks', () => {
    const file = writeSidechain(userEntry([toolResultBlock('tool_1', 'some result')]));
    const result = readTranscript(file);
    expect(result.taskPrompt).toBeUndefined();
  });

  // Req 45: one assistant turn with text and tool_use, followed by user with tool_result
  it('parses one assistant turn with text, tool call, and attached tool result', () => {
    const file = writeSidechain(
      userEntry([textBlock('Implement the feature')]),
      assistantEntry(
        [textBlock("I'll help."), toolUseBlock('tool_1', 'Bash', { command: 'ls' })],
        'end_turn',
      ),
      userEntry([toolResultBlock('tool_1', 'file1.ts\nfile2.ts')]),
    );
    const result = readTranscript(file);
    expect(result.taskPrompt).toBe('Implement the feature');
    expect(result.turns).toHaveLength(1);
    const turn = result.turns[0]!;
    expect(turn.textBlocks).toEqual(["I'll help."]);
    expect(turn.toolCalls).toHaveLength(1);
    const call = turn.toolCalls[0]!;
    expect(call.id).toBe('tool_1');
    expect(call.name).toBe('Bash');
    expect(call.input).toEqual({ command: 'ls' });
    expect(call.result).toBeDefined();
    expect(call.result?.toolUseId).toBe('tool_1');
    expect(call.result?.isError).toBe(false);
    expect(call.result?.content).toBe('file1.ts\nfile2.ts');
    expect(call.result?.truncated).toBe(false);
    expect(result.stopReason).toBe('end_turn');
  });

  // Req 45: multiple assistant turns with interleaved tool calls and results
  it('parses multiple assistant turns with interleaved tool calls and results', () => {
    const file = writeSidechain(
      userEntry([textBlock('Do the thing')]),
      assistantEntry(
        [textBlock('Step 1'), toolUseBlock('t1', 'Read', { file_path: 'foo.ts' })],
        'tool_use',
      ),
      userEntry([toolResultBlock('t1', 'content of foo')]),
      assistantEntry(
        [textBlock('Step 2'), toolUseBlock('t2', 'Write', { file_path: 'bar.ts' })],
        'end_turn',
      ),
      userEntry([toolResultBlock('t2', 'wrote bar.ts')]),
    );
    const result = readTranscript(file);
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]!.textBlocks).toEqual(['Step 1']);
    expect(result.turns[0]!.toolCalls[0]!.result?.content).toBe('content of foo');
    expect(result.turns[1]!.textBlocks).toEqual(['Step 2']);
    expect(result.turns[1]!.toolCalls[0]!.result?.content).toBe('wrote bar.ts');
    expect(result.stopReason).toBe('end_turn');
  });

  // Req 47: tool result content exceeding 2048 bytes → truncated
  it('truncates tool result content exceeding 2048 bytes and sets truncated: true', () => {
    const longContent = 'x'.repeat(3000);
    const file = writeSidechain(
      assistantEntry([toolUseBlock('t1', 'Bash', { command: 'cat file' })], 'end_turn'),
      userEntry([toolResultBlock('t1', longContent)]),
    );
    const result = readTranscript(file);
    const callResult = result.turns[0]!.toolCalls[0]!.result!;
    expect(callResult.truncated).toBe(true);
    expect(Buffer.byteLength(callResult.content)).toBeLessThanOrEqual(2048);
  });

  // Req 47: full: true → no truncation
  it('does not truncate when full: true is set', () => {
    const longContent = 'x'.repeat(3000);
    const file = writeSidechain(
      assistantEntry([toolUseBlock('t1', 'Bash', { command: 'cat file' })], 'end_turn'),
      userEntry([toolResultBlock('t1', longContent)]),
    );
    const result = readTranscript(file, { full: true });
    const callResult = result.turns[0]!.toolCalls[0]!.result!;
    expect(callResult.truncated).toBe(false);
    expect(callResult.content).toBe(longContent);
  });

  // Req 45: tool result with no matching tool_use_id → no crash
  it('ignores tool_result entries with no matching tool_use_id without crashing', () => {
    const file = writeSidechain(
      assistantEntry([toolUseBlock('t1', 'Bash', { command: 'ls' })], 'end_turn'),
      userEntry([toolResultBlock('unknown_id', 'some output')]),
    );
    const result = readTranscript(file);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]!.toolCalls[0]!.result).toBeUndefined();
  });

  // Req 45: stopReason extracted from final assistant entry
  it('uses the last seen stop_reason from assistant entries', () => {
    const file = writeSidechain(
      assistantEntry([textBlock('first')], 'tool_use'),
      userEntry([textBlock('hi')]),
      assistantEntry([textBlock('second')], 'max_tokens'),
    );
    const result = readTranscript(file);
    expect(result.stopReason).toBe('max_tokens');
  });

  // Req 45: tool result content as array of text items
  it('joins array content in tool_result into a single string', () => {
    const arrayContent = [
      { type: 'text', text: 'part1' },
      { type: 'text', text: 'part2' },
    ];
    const file = writeSidechain(
      assistantEntry([toolUseBlock('t1', 'Bash', { command: 'ls' })], 'end_turn'),
      userEntry([toolResultBlock('t1', arrayContent)]),
    );
    const result = readTranscript(file);
    const callResult = result.turns[0]!.toolCalls[0]!.result!;
    expect(callResult.content).toBe('part1part2');
    expect(callResult.truncated).toBe(false);
  });

  // Req 45: custom truncateBytes option
  it('respects custom truncateBytes option', () => {
    const content = 'abcde'; // 5 bytes
    const file = writeSidechain(
      assistantEntry([toolUseBlock('t1', 'Bash', { command: 'ls' })], 'end_turn'),
      userEntry([toolResultBlock('t1', content)]),
    );
    const result = readTranscript(file, { truncateBytes: 3 });
    const callResult = result.turns[0]!.toolCalls[0]!.result!;
    expect(callResult.truncated).toBe(true);
    expect(callResult.content).toBe('abc');
  });
});
