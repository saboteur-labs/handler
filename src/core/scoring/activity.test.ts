import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readActivity } from './activity';

describe('readActivity', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-sidechain-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Write sidechain entries, in the real on-disk shape, to a `.jsonl` file. */
  function writeSidechain(...entries: unknown[]): string {
    const file = join(dir, 'agent-x.jsonl');
    writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf8');
    return file;
  }

  const assistantToolUse = (name: string, input: Record<string, unknown>): unknown => ({
    type: 'assistant',
    cwd: '/Users/me/repo',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input }] },
  });

  const toolResult = (content: unknown, isError = false): unknown => ({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content, is_error: isError }],
    },
  });

  it('collects tool calls with their name and input in order', () => {
    const file = writeSidechain(
      assistantToolUse('Bash', { command: 'ls' }),
      assistantToolUse('Read', { file_path: '/x' }),
    );
    expect(readActivity(file).toolCalls).toEqual([
      { name: 'Bash', input: { command: 'ls' } },
      { name: 'Read', input: { file_path: '/x' } },
    ]);
  });

  it('counts permission denials by the deterministic denial string', () => {
    const file = writeSidechain(
      toolResult('Permission to use Bash has been denied. IMPORTANT: you may attempt...'),
    );
    const activity = readActivity(file);
    expect(activity.denials).toBe(1);
    expect(activity.errors).toBe(0);
  });

  it('counts tool errors (is_error) but not denials as errors', () => {
    const file = writeSidechain(
      toolResult('Exit code 2\ncan not open file', true),
      toolResult('Permission to use Bash has been denied.', true),
    );
    const activity = readActivity(file);
    expect(activity.errors).toBe(1);
    expect(activity.denials).toBe(1);
  });

  it('surfaces the run cwd and tolerates non-tool entries', () => {
    const file = writeSidechain(
      { type: 'attachment', message: 'noise' },
      assistantToolUse('Bash', { command: 'pwd' }),
    );
    const activity = readActivity(file);
    expect(activity.cwd).toBe('/Users/me/repo');
    expect(activity.toolCalls).toHaveLength(1);
  });

  it('handles tool_result content given as text blocks', () => {
    const file = writeSidechain(
      toolResult([{ type: 'text', text: 'Permission to use Edit has been denied.' }]),
    );
    expect(readActivity(file).denials).toBe(1);
  });

  it('returns empty activity for a missing file', () => {
    expect(readActivity(join(dir, 'nope.jsonl'))).toEqual({
      toolCalls: [],
      denials: 0,
      errors: 0,
      cwd: undefined,
    });
  });
});
