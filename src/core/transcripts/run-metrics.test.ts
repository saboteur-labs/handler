/**
 * Shared sub-transcript run metrics (subagent-run-capture FR-3, metric half of
 * FR-5 and FR-8). The fixture oracle uses notification `<usage>` via the Task 1
 * helpers; that is test-only and never a production source.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPTURE_AGENT_IDS,
  buildSubTranscript,
  capturePaths,
  expectedFromSubTranscript,
  parseNotifications,
} from '../__fixtures__/capture/fixtures.js';
import { readJsonl } from './jsonl.js';
import { computeRunMetrics, toolStatsKeyFor, TOOL_STATS_KEYS } from './run-metrics.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'run-metrics-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const usage = (
  n: number,
): { input: number; cacheRead: number; cacheCreation: number; output: number } => ({
  input: n,
  cacheRead: n * 10,
  cacheCreation: n * 100,
  output: n * 1000,
});

describe('computeRunMetrics', () => {
  it('computes count, duration, final-turn tokens and toolStats from a sub-transcript', () => {
    const p = join(tmp(), 'agent-x.jsonl');
    writeFileSync(
      p,
      buildSubTranscript({
        agentId: 'x',
        startMs: Date.parse('2026-01-01T00:00:00Z'),
        durationMs: 8000,
        turns: [
          { tools: ['Read', 'Grep'], usage: usage(1) },
          { tools: ['Bash'], usage: usage(2) },
          { tools: [], usage: usage(3) },
        ],
      }),
    );
    const r = computeRunMetrics(p);
    expect(r.noUsableData).toBe(false);
    expect(r.metrics).toEqual({
      totalToolUseCount: 3,
      totalDurationMs: 8000,
      // Final assistant turn only (a context size), not a sum across turns.
      totalTokens: 3 + 30 + 300 + 3000,
      toolStats: {
        readCount: 1,
        searchCount: 1,
        bashCount: 1,
        editFileCount: 0,
        linesAdded: 0,
        linesRemoved: 0,
        otherToolCount: 0,
      },
    });
  });

  it('pins the tool-name to toolStats-key mapping (UNVERIFIED ASSUMPTION, not legacy-derived)', () => {
    // UNVERIFIED ASSUMPTION: the legacy mapping is not determinable from the
    // repo. This test pins the mapping we chose; it does not prove it
    // reproduces legacy values.
    const expected: Record<string, string> = {
      Read: 'readCount',
      Grep: 'searchCount',
      Glob: 'searchCount',
      Bash: 'bashCount',
      Edit: 'editFileCount',
      Write: 'editFileCount',
      MultiEdit: 'editFileCount',
      NotebookEdit: 'editFileCount',
      Task: 'otherToolCount',
      WebFetch: 'otherToolCount',
      TodoWrite: 'otherToolCount',
      mcp__x__y: 'otherToolCount',
    };
    for (const [name, key] of Object.entries(expected)) {
      expect(toolStatsKeyFor(name), name).toBe(key);
    }
  });

  it('always emits exactly the 7 legacy toolStats keys', () => {
    expect([...TOOL_STATS_KEYS]).toEqual([
      'readCount',
      'searchCount',
      'bashCount',
      'editFileCount',
      'linesAdded',
      'linesRemoved',
      'otherToolCount',
    ]);
    const p = join(tmp(), 'a.jsonl');
    writeFileSync(
      p,
      buildSubTranscript({
        agentId: 'a',
        startMs: 0,
        durationMs: 100,
        turns: [{ tools: ['Weird', 'Edit', 'Glob'], usage: usage(1) }],
      }),
    );
    const stats = computeRunMetrics(p).metrics!.toolStats;
    expect(Object.keys(stats).sort()).toEqual([...TOOL_STATS_KEYS].sort());
    expect(stats).toMatchObject({ otherToolCount: 1, editFileCount: 1, searchCount: 1 });
    // linesAdded/linesRemoved are not derived (always 0); see run-metrics.ts.
    expect(stats.linesAdded).toBe(0);
    expect(stats.linesRemoved).toBe(0);
  });

  it('counts tool_use blocks in assistant entries only', () => {
    const p = join(tmp(), 'a.jsonl');
    const lines = [
      {
        type: 'user',
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_use', name: 'Read' }] },
      },
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01Z',
        message: { content: [{ type: 'tool_use', name: 'Read' }], usage: { output_tokens: 5 } },
      },
    ];
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
    const m = computeRunMetrics(p).metrics!;
    expect(m.totalToolUseCount).toBe(1);
    expect(m.totalDurationMs).toBe(1000);
    expect(m.totalTokens).toBe(5);
  });

  it('agrees with the notification <usage> oracle on the fixtures', () => {
    const notes = parseNotifications(
      readJsonl<Record<string, unknown>>(capturePaths.parentTranscript),
    );
    const ids = [
      CAPTURE_AGENT_IDS.reviewer,
      CAPTURE_AGENT_IDS.writer,
      CAPTURE_AGENT_IDS.explore,
      CAPTURE_AGENT_IDS.nested,
    ];
    let compared = 0;
    for (const id of ids) {
      const note = notes.filter((n) => n.taskId === id).at(-1);
      if (!note) continue;
      compared++;
      const m = computeRunMetrics(capturePaths.subTranscript(id)).metrics!;
      expect(m.totalToolUseCount, id).toBe(note.usage.tool_uses);
      expect(Math.abs(m.totalDurationMs - note.usage.duration_ms), id).toBeLessThanOrEqual(
        note.usage.duration_ms * 0.1,
      );
      expect(Math.abs(m.totalTokens - note.usage.subagent_tokens), id).toBeLessThanOrEqual(
        note.usage.subagent_tokens * 0.02,
      );
      const expected = expectedFromSubTranscript(capturePaths.subTranscript(id))!;
      expect(m.totalToolUseCount).toBe(expected.toolUseCount);
      expect(m.totalDurationMs).toBe(expected.durationMs);
      expect(m.totalTokens).toBe(expected.totalTokens);
    }
    expect(compared).toBeGreaterThanOrEqual(2);
  });

  it('returns undefined metrics and flags no usable data for missing, empty, directory and malformed input', () => {
    const d = tmp();
    const empty = join(d, 'empty.jsonl');
    writeFileSync(empty, '');
    const dirPath = join(d, 'adir.jsonl');
    mkdirSync(dirPath);
    const garbage = join(d, 'garbage.jsonl');
    writeFileSync(garbage, 'not json\n{"truncated":\n');
    const noStamps = join(d, 'nostamps.jsonl');
    writeFileSync(noStamps, '{"type":"assistant"}\n');
    for (const p of [
      join(d, 'missing.jsonl'),
      empty,
      dirPath,
      garbage,
      noStamps,
      capturePaths.subTranscript(CAPTURE_AGENT_IDS.empty),
      capturePaths.subTranscript(CAPTURE_AGENT_IDS.malformed),
    ]) {
      expect(computeRunMetrics(p), p).toEqual({ metrics: undefined, noUsableData: true });
    }
  });

  it('does not read notification usage in production code', () => {
    const src = readFileSync(fileURLToPath(new URL('./run-metrics.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/subagent_tokens|task-notification|duration_ms|tool_uses/);
  });
});
