/**
 * Tests for importRunlog (subagent-run-capture FR-16, FR-28, FR-29, FR-30,
 * FR-31) against the Task 1 fixtures, with temp roots and temp store paths.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE_AGENT_IDS as IDS,
  CAPTURE_CWD,
  buildRunlogEnvelope,
  buildSubagentStopPayload,
  copyCaptureFixtures,
} from '../__fixtures__/capture/fixtures';
import type { Run } from '../run';
import { userSource, type AgentSource } from '../sources/source';
import { canOverwrite } from '../store/precedence';
import { RunStore } from '../store/run-store';
import { importRunlog } from './import';

let tmp: string;
let home: string;
let storePath: string;
let runlogsRoot: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'handler-runlog-import-'));
  home = join(tmp, 'home');
  storePath = join(tmp, 'store', 'runs.json');
  const dir = join(home, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  for (const name of ['code-reviewer', 'test-writer']) {
    writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\n---\nbody ${name}\n`);
  }
  runlogsRoot = copyCaptureFixtures(join(tmp, 'fx')).runlogsRoot;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function sources(): AgentSource[] {
  return [userSource(home)];
}

function stored(): Run[] {
  return new RunStore(storePath).list();
}

function writeLog(root: string, lines: string[]): void {
  const dir = join(root, 'repos', 'r');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's.jsonl'), lines.join('\n') + '\n');
}

describe('importRunlog over the fixtures', () => {
  it('imports user-agent stops as runlog records, drops built-ins, and reports counts', () => {
    const result = importRunlog({ runlogsRoot, sources: sources(), storePath });
    const runs = stored();

    expect(runs.map((r) => r.runId).sort()).toEqual(
      [IDS.reviewer, IDS.writer, IDS.runlogOnly].sort(),
    );
    expect(runs.every((r) => r.source === 'runlog')).toBe(true);
    expect(runs.find((r) => r.runId === IDS.explore)).toBeUndefined();
    expect(result.imported).toBe(3);
    expect(result.skippedEmptyAgentType).toBe(1);
    expect(result.skippedMalformed).toBe(1);
  });

  it('computes FR-3 metrics when agent_transcript_path exists', () => {
    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const run = stored().find((r) => r.runId === IDS.reviewer)!;
    expect(run.totalToolUseCount).toBeGreaterThan(0);
    expect(run.totalTokens).toBeGreaterThan(0);
    expect(run.tags).not.toContain('incomplete');
    expect(run.definitionSnapshot).not.toBeNull();
  });

  it('falls back to payload cwd/session and envelope ts, no metrics, incomplete when the transcript is missing', () => {
    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const run = stored().find((r) => r.runId === IDS.runlogOnly)!;
    expect(run.cwd).toBe(CAPTURE_CWD);
    expect(run.sessionId).toBe('sess-0001');
    expect(run.timestamp).toBe('2026-10-01T10:10:07.000Z');
    expect(run.totalToolUseCount).toBeUndefined();
    expect(run.totalTokens).toBeUndefined();
    expect(run.totalDurationMs).toBeUndefined();
    expect(run.tags).toContain('incomplete');
  });

  it('keeps and tags orphan when the definition is not found', () => {
    rmSync(join(home, '.claude', 'agents', 'code-reviewer.md'));
    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const run = stored().find((r) => r.runId === IDS.reviewer)!;
    expect(run.tags).toContain('orphan');
    expect(run.definitionSnapshot).toBeNull();
  });

  it('drops stops matching no registered source silently', () => {
    const result = importRunlog({ runlogsRoot, sources: [], storePath });
    expect(stored()).toEqual([]);
    expect(result.imported).toBe(0);
  });

  it('a second import changes nothing (store content byte-identical)', () => {
    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const first = readFileSync(storePath, 'utf8');
    const second = importRunlog({ runlogsRoot, sources: sources(), storePath });
    expect(readFileSync(storePath, 'utf8')).toBe(first);
    expect(second.imported).toBe(0);
  });
});

describe('importRunlog precedence (FR-16)', () => {
  function seed(source: Run['source']): Run {
    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const store = new RunStore(storePath);
    const base = store.list().find((r) => r.runId === IDS.reviewer)!;
    const run: Run = { ...base, source, status: 'completed', totalTokens: 999 };
    store.upsert(run);
    return run;
  }

  it('never overwrites a hook or transcript record', () => {
    for (const source of ['hook', 'transcript'] as const) {
      const seeded = seed(source);
      const result = importRunlog({ runlogsRoot, sources: sources(), storePath });
      const after = stored().find((r) => r.runId === IDS.reviewer)!;
      expect(after).toEqual(seeded);
      expect(result.imported).toBe(0);
    }
  });

  it('a later hook or transcript write may replace a runlog record', () => {
    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const existing = stored().find((r) => r.runId === IDS.reviewer)!;
    expect(existing.source).toBe('runlog');
    expect(canOverwrite(existing.source, 'hook')).toBe(true);
    expect(canOverwrite(existing.source, 'transcript')).toBe(true);
  });
});

describe('importRunlog identity handling', () => {
  it('stores one agentId resolving to different identities per (identityKey, runId)', () => {
    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const store = new RunStore(storePath);
    const original = store.list().find((r) => r.runId === IDS.reviewer)!;
    // Same agentId already stored under a different identity.
    store.upsert({
      ...original,
      identityKey: 'repo|/elsewhere|code-reviewer',
      source: 'transcript',
    });

    importRunlog({ runlogsRoot, sources: sources(), storePath });
    const matches = stored().filter((r) => r.runId === IDS.reviewer);
    expect(matches).toHaveLength(2);
    expect(matches.map((r) => r.source).sort()).toEqual(['runlog', 'transcript']);
  });
});

describe('importRunlog robustness (FR-31)', () => {
  it('never throws on a missing root', () => {
    const result = importRunlog({ runlogsRoot: join(tmp, 'nope'), sources: sources(), storePath });
    expect(result.imported).toBe(0);
  });

  it('never throws on malformed lines or odd payloads, and leaves sidechainPath unset when absent', () => {
    const root = join(tmp, 'bad');
    const payload = buildSubagentStopPayload({
      agentId: 'x',
      agentType: 'code-reviewer',
      agentTranscriptPath: '',
    });
    delete payload.agent_transcript_path;
    writeLog(root, [
      'not json',
      JSON.stringify({ event: 'SubagentStop', payload: 5 }),
      JSON.stringify(
        buildRunlogEnvelope({ tsMs: 1, event: 'SubagentStop', agentId: 'x', payload }),
      ),
    ]);
    const result = importRunlog({ runlogsRoot: root, sources: sources(), storePath });
    expect(result.skippedMalformed).toBe(2);
    expect(result.imported).toBe(1);
    expect(stored()[0]!.sidechainPath).toBeUndefined();
  });
});
