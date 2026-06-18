import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { latencyDistribution, readTelemetry, type Turn } from './telemetry';

describe('readTelemetry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-telemetry-'));
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

  const assistantTurn = (
    usage: Record<string, unknown>,
    extra: { timestamp?: string; model?: string; stop_reason?: string | null } = {},
  ): unknown => ({
    type: 'assistant',
    timestamp: extra.timestamp,
    message: {
      role: 'assistant',
      model: extra.model,
      stop_reason: extra.stop_reason,
      usage,
      content: [{ type: 'text', text: 'ok' }],
    },
  });

  it('collects per-turn token usage in order, defaulting missing fields to 0', () => {
    const file = writeSidechain(
      assistantTurn({
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 3,
      }),
      assistantTurn({ input_tokens: 1, output_tokens: 2 }),
    );
    expect(readTelemetry(file).turns.map((t) => t.usage)).toEqual([
      { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 3 },
      { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ]);
  });

  it('captures the timestamp and model per turn', () => {
    const file = writeSidechain(
      assistantTurn(
        { input_tokens: 1, output_tokens: 1 },
        { timestamp: '2026-06-18T10:00:00.000Z', model: 'claude-opus-4-8' },
      ),
    );
    const { turns } = readTelemetry(file);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.timestamp).toBe('2026-06-18T10:00:00.000Z');
    expect(turns[0]?.model).toBe('claude-opus-4-8');
  });

  it('skips entries without a usage object', () => {
    const file = writeSidechain(
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      assistantTurn({ input_tokens: 1, output_tokens: 1 }),
    );
    expect(readTelemetry(file).turns).toHaveLength(1);
  });

  it('derives stopReason end_turn from the final assistant turn', () => {
    const file = writeSidechain(
      assistantTurn({ input_tokens: 1, output_tokens: 1 }, { stop_reason: 'tool_use' }),
      assistantTurn({ input_tokens: 1, output_tokens: 1 }, { stop_reason: 'end_turn' }),
    );
    expect(readTelemetry(file).stopReason).toBe('end_turn');
  });

  it('reports stopReason max_tokens when the final turn hit the cap', () => {
    const file = writeSidechain(
      assistantTurn({ input_tokens: 1, output_tokens: 1 }, { stop_reason: 'max_tokens' }),
    );
    expect(readTelemetry(file).stopReason).toBe('max_tokens');
  });

  it('reports stopReason interrupted on the Claude Code interruption marker', () => {
    const file = writeSidechain(
      assistantTurn({ input_tokens: 1, output_tokens: 1 }, { stop_reason: 'end_turn' }),
      {
        type: 'user',
        message: { role: 'user', content: '[Request interrupted by user for tool use]' },
      },
    );
    expect(readTelemetry(file).stopReason).toBe('interrupted');
  });

  const toolUse = (name: string, input: Record<string, unknown>, id = 't1'): unknown => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });

  const toolResult = (content: unknown, isError: boolean, id = 't1'): unknown => ({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }],
    },
  });

  it('collects distinct edited file paths in first-seen order', () => {
    const file = writeSidechain(
      toolUse('Write', { file_path: '/a.ts', content: 'x' }),
      toolUse('Edit', { file_path: '/b.ts', old_string: 'a', new_string: 'b' }),
      toolUse('Edit', { file_path: '/a.ts', old_string: 'c', new_string: 'd' }),
    );
    expect(readTelemetry(file).filesEdited).toEqual(['/a.ts', '/b.ts']);
  });

  it('counts TodoWrite planning activity', () => {
    const file = writeSidechain(
      toolUse('TodoWrite', { todos: [] }),
      toolUse('TodoWrite', { todos: [] }),
    );
    expect(readTelemetry(file).todoWrites).toBe(2);
  });

  it('captures tool errors with a parsed Bash exit code, excluding denials', () => {
    const file = writeSidechain(
      toolResult('Exit code 2\ncannot open file', true),
      toolResult('Permission to use Bash has been denied.', true),
    );
    expect(readTelemetry(file).toolErrors).toEqual([
      { exitCode: 2, message: 'Exit code 2\ncannot open file' },
    ]);
  });

  it('captures a tool error without an exit code as undefined', () => {
    const file = writeSidechain(toolResult('something broke', true));
    expect(readTelemetry(file).toolErrors).toEqual([
      { exitCode: undefined, message: 'something broke' },
    ]);
  });

  it('counts an error→retry loop when an errored call is repeated', () => {
    const file = writeSidechain(
      toolUse('Bash', { command: 'npm test' }, 't1'),
      toolResult('Exit code 1\nfail', true, 't1'),
      toolUse('Bash', { command: 'npm test' }, 't2'),
    );
    expect(readTelemetry(file).retryLoops).toBe(1);
  });

  it('does not count a repeated call that never errored as a retry loop', () => {
    const file = writeSidechain(
      toolUse('Bash', { command: 'ls' }, 't1'),
      toolUse('Bash', { command: 'ls' }, 't2'),
    );
    expect(readTelemetry(file).retryLoops).toBe(0);
  });

  it('returns empty telemetry for a missing or malformed file', () => {
    expect(readTelemetry(join(dir, 'nope.jsonl'))).toEqual({
      turns: [],
      stopReason: undefined,
      filesEdited: [],
      todoWrites: 0,
      toolErrors: [],
      retryLoops: 0,
    });
  });
});

describe('latencyDistribution', () => {
  const turn = (timestamp?: string): Turn => ({
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    timestamp,
    model: undefined,
  });

  it('returns the single inter-turn latency for two timestamped turns', () => {
    const dist = latencyDistribution([
      turn('2026-06-18T10:00:00.000Z'),
      turn('2026-06-18T10:00:01.000Z'),
    ]);
    expect(dist).toEqual({ p50Ms: 1000, p95Ms: 1000 });
  });

  it('computes nearest-rank p50 and p95 over multiple intervals', () => {
    // intervals: 100, 200, 300 ms -> sorted [100,200,300]
    // p50 rank ceil(.5*3)=2 -> 200; p95 rank ceil(.95*3)=3 -> 300
    const dist = latencyDistribution([
      turn('2026-06-18T10:00:00.000Z'),
      turn('2026-06-18T10:00:00.100Z'),
      turn('2026-06-18T10:00:00.300Z'),
      turn('2026-06-18T10:00:00.600Z'),
    ]);
    expect(dist).toEqual({ p50Ms: 200, p95Ms: 300 });
  });

  it('measures latency between timestamped turns, skipping turns without a timestamp', () => {
    const dist = latencyDistribution([
      turn('2026-06-18T10:00:00.000Z'),
      turn(undefined),
      turn('2026-06-18T10:00:00.500Z'),
    ]);
    expect(dist).toEqual({ p50Ms: 500, p95Ms: 500 });
  });

  it('returns undefined when there are fewer than two timestamped turns', () => {
    expect(latencyDistribution([])).toBeUndefined();
    expect(latencyDistribution([turn('2026-06-18T10:00:00.000Z')])).toBeUndefined();
    expect(
      latencyDistribution([turn(undefined), turn('2026-06-18T10:00:00.000Z')]),
    ).toBeUndefined();
  });
});
