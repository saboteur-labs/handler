/**
 * Tests for readRunlogStops against the Task 1 runlog fixtures (FR-25, FR-26,
 * FR-27, FR-31).
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE_AGENT_IDS as IDS,
  buildRunlogEnvelope,
  buildSubagentStopPayload,
  copyCaptureFixtures,
} from '../__fixtures__/capture/fixtures';
import { defaultRunlogsRoot, readRunlogStops } from './reader';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'handler-runlog-reader-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function stopEnvelope(agentId: string, agentType: string, tsMs: number): Record<string, unknown> {
  return buildRunlogEnvelope({
    tsMs,
    event: 'SubagentStop',
    agentId,
    payload: buildSubagentStopPayload({ agentId, agentType, agentTranscriptPath: '/x.jsonl' }),
  });
}

function writeRunlog(root: string, repo: string, name: string, lines: string[]): string {
  const dir = join(root, 'repos', repo);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.jsonl`);
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('readRunlogStops over the fixtures', () => {
  it('dedups by agent_id (latest wins), skips and counts empty type and malformed lines', () => {
    const { runlogsRoot } = copyCaptureFixtures(tmp);
    const result = readRunlogStops(runlogsRoot);

    expect(result.skippedEmptyAgentType).toBe(1);
    expect(result.skippedMalformed).toBe(1);
    expect(result.stops.map((s) => s.agentId).sort()).toEqual(
      [IDS.reviewer, IDS.writer, IDS.explore, IDS.runlogOnly].sort(),
    );
    const reviewer = result.stops.find((s) => s.agentId === IDS.reviewer);
    expect(reviewer?.ts).toBe('2026-10-01T10:10:04.000Z');
    expect(reviewer?.tsMs).toBe(1790849404000);
    expect(reviewer?.agentType).toBe('code-reviewer');
    expect(reviewer?.agentTranscriptPath).toContain(tmp);
    expect(result.stops.some((s) => s.agentId === IDS.emptyTypeStop)).toBe(false);
  });

  it('does not read sessions/ pointer files', () => {
    const { runlogsRoot } = copyCaptureFixtures(tmp);
    writeFileSync(
      join(runlogsRoot, 'sessions', 'other.jsonl'),
      JSON.stringify(stopEnvelope('a-pointer-only', 'x', 1)) + '\n',
    );
    const result = readRunlogStops(runlogsRoot);
    expect(result.stops.some((s) => s.agentId === 'a-pointer-only')).toBe(false);
  });

  it('is read-only: content and mtime unchanged', () => {
    const { runlogsRoot } = copyCaptureFixtures(tmp);
    const file = join(runlogsRoot, 'repos', 'synthetic-app', 'sess-0001.jsonl');
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(file, old, old);
    const before = readFileSync(file, 'utf8');
    readRunlogStops(runlogsRoot);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(statSync(file).mtimeMs).toBe(old.getTime());
  });
});

describe('readRunlogStops edge cases', () => {
  it('returns no stops and zero counts for a missing root', () => {
    expect(readRunlogStops(join(tmp, 'nope'))).toEqual({
      stops: [],
      skippedEmptyAgentType: 0,
      skippedMalformed: 0,
    });
  });

  it('does not filter by repo and dedups across files', () => {
    writeRunlog(tmp, 'repo-a', 's1', [JSON.stringify(stopEnvelope('a1', 'x', 100))]);
    writeRunlog(tmp, 'repo-b', 's2', [
      JSON.stringify(stopEnvelope('a2', 'y', 100)),
      JSON.stringify(stopEnvelope('a1', 'z', 200)),
    ]);
    const { stops } = readRunlogStops(tmp);
    expect(stops.map((s) => [s.agentId, s.agentType]).sort()).toEqual([
      ['a1', 'z'],
      ['a2', 'y'],
    ]);
  });

  it('picks the latest by ts_ms even when it appears earlier in the file', () => {
    writeRunlog(tmp, 'r', 's', [
      JSON.stringify(stopEnvelope('a1', 'newer', 200)),
      JSON.stringify(stopEnvelope('a1', 'older', 100)),
    ]);
    expect(readRunlogStops(tmp).stops[0]?.agentType).toBe('newer');
  });

  it('falls back to file order when ts_ms is missing', () => {
    const noTs = (type: string): string => {
      const env = stopEnvelope('a1', type, 100);
      delete env.ts_ms;
      return JSON.stringify(env);
    };
    writeRunlog(tmp, 'r', 's', [noTs('first'), noTs('second')]);
    const { stops } = readRunlogStops(tmp);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.agentType).toBe('second');
    expect(stops[0]?.tsMs).toBeUndefined();
  });

  it('ignores other events and counts malformed lines without throwing', () => {
    writeRunlog(tmp, 'r', 's', [
      JSON.stringify(
        buildRunlogEnvelope({ tsMs: 1, event: 'SessionStart', agentId: '', payload: {} }),
      ),
      '',
      'not json {',
      '[1,2]',
      JSON.stringify({ event: 'SubagentStop', payload: { agent_type: 'x' } }),
      JSON.stringify({ event: 'SubagentStop', payload: 'str' }),
      JSON.stringify(stopEnvelope('a1', 'ok', 5)),
    ]);
    const result = readRunlogStops(tmp);
    expect(result.stops.map((s) => s.agentId)).toEqual(['a1']);
    expect(result.skippedMalformed).toBe(4);
    expect(result.skippedEmptyAgentType).toBe(0);
  });

  it('ignores non-jsonl files in repos/', () => {
    const dir = join(tmp, 'repos', 'r');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.txt'), JSON.stringify(stopEnvelope('a1', 'x', 1)));
    expect(readRunlogStops(tmp).stops).toEqual([]);
  });
});

describe('defaultRunlogsRoot', () => {
  it('is ~/.claude/runlogs (computed only, never read)', () => {
    expect(defaultRunlogsRoot()).toBe(join(homedir(), '.claude', 'runlogs'));
  });
});
