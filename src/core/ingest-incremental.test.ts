/**
 * Incremental ingest (subagent-run-capture FR-36, Task 18): a warm ingest over
 * unchanged files re-reads nothing, and an incremental ingest always converges
 * to exactly what a full ingest into an empty store would produce.
 * Temp dirs only; no real ~/.claude or ~/.handler.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_AGENT_IDS as IDS,
  buildSubTranscript,
  buildSubagentStopPayload,
  buildTaskNotificationText,
  copyCaptureFixtures,
} from './__fixtures__/capture/fixtures';
import { handleSubagentStop } from './hook/handler';
import { ingest } from './ingest';
import type { Run } from './run';
import { userSource } from './sources/source';
import { ingestCachePathFor } from './store/ingest-cache';
import { RunStore } from './store/run-store';
import * as jsonl from './transcripts/jsonl';

let tmp: string;
let home: string;
let projectsRoot: string;
let storePath: string;

const FIXTURE_USER_AGENTS = ['code-reviewer', 'test-writer', 'doc-writer', 'planner'];

function sub(id: string): string {
  return join(
    projectsRoot,
    '-synthetic-workspace-app',
    'sess-0001',
    'subagents',
    `agent-${id}.jsonl`,
  );
}

function parent(): string {
  return join(projectsRoot, '-synthetic-workspace-app', 'sess-0001.jsonl');
}

function run(path: string = storePath): Run[] {
  ingest({ sources: [userSource(home)], projectsRoot, storePath: path });
  return new RunStore(path).list();
}

/** Ingest into a brand-new store, as the oracle for an incremental result. */
function fresh(): Run[] {
  return run(join(tmp, 'oracle', 'runs.json'));
}

function sorted(runs: Run[]): Run[] {
  return [...runs].sort((a, b) =>
    `${a.identityKey}${a.runId}`.localeCompare(`${b.identityKey}${b.runId}`),
  );
}

function readPaths(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'handler-incr-'));
  home = join(tmp, 'home');
  const dir = join(home, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  for (const name of FIXTURE_USER_AGENTS) {
    writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\n---\nbody ${name}\n`);
  }
  ({ projectsRoot } = copyCaptureFixtures(join(tmp, 'fx')));
  storePath = join(tmp, 'store', 'runs.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('warm ingest over unchanged files (FR-36)', () => {
  it('parses no parent transcript and reads no sub-transcript', () => {
    run();
    const spy = vi.spyOn(jsonl, 'readJsonl');
    run();
    expect(readPaths(spy)).toEqual([]);
  });

  it('writes the extraction cache beside the run store', () => {
    run();
    expect(existsSync(ingestCachePathFor(storePath))).toBe(true);
    expect(ingestCachePathFor(storePath)).toBe(join(tmp, 'store', 'ingest-cache.json'));
  });

  it('leaves the run store byte-identical', () => {
    run();
    const before = readFileSync(storePath, 'utf8');
    run();
    expect(readFileSync(storePath, 'utf8')).toBe(before);
  });

  it('records the sub-transcript size and mtime on each transcript run', () => {
    const r = run().find((x) => x.runId === IDS.reviewer)!;
    expect(r.sidechainSize).toBeGreaterThan(0);
    expect(r.sidechainMtimeMs).toBeGreaterThan(0);
  });
});

describe('incremental ingest equals full ingest', () => {
  it('(a) unchanged', () => {
    run();
    expect(sorted(run())).toEqual(sorted(fresh()));
  });

  it('(b) after a parent gains a newer task-notification', () => {
    run();
    const before = run().find((x) => x.runId === IDS.reviewer)!.status;
    appendFileSync(
      parent(),
      JSON.stringify({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: '2026-10-01T11:00:00.000Z',
        sessionId: 'sess-0001',
        content: buildTaskNotificationText({
          taskId: IDS.reviewer,
          status: 'failed',
          toolUses: 1,
          durationMs: 1,
          subagentTokens: 1,
        }),
      }) + '\n',
    );
    const incremental = run();
    expect(incremental.find((x) => x.runId === IDS.reviewer)!.status).toBe('failed');
    expect(before).not.toBe('failed');
    expect(sorted(incremental)).toEqual(sorted(fresh()));
  });

  it('(c) after a sub-transcript grows', () => {
    run();
    const oldTools = run().find((x) => x.runId === IDS.reviewer)!.totalToolUseCount;
    appendFileSync(
      sub(IDS.reviewer),
      buildSubTranscript({
        agentId: IDS.reviewer,
        startMs: Date.parse('2026-10-01T10:30:00.000Z'),
        durationMs: 3000,
        turns: [
          {
            tools: ['Bash', 'Read'],
            usage: { input: 1, cacheRead: 2, cacheCreation: 3, output: 4 },
          },
        ],
      }),
    );
    const incremental = run();
    expect(incremental.find((x) => x.runId === IDS.reviewer)!.totalToolUseCount).toBe(
      (oldTools ?? 0) + 2,
    );
    expect(sorted(incremental)).toEqual(sorted(fresh()));
  });

  it('(d) after a hook record exists for a run (upgrades to transcript)', () => {
    const store = new RunStore(storePath);
    handleSubagentStop(
      buildSubagentStopPayload({
        agentId: IDS.reviewer,
        agentType: 'code-reviewer',
        agentTranscriptPath: sub(IDS.reviewer),
      }),
      [userSource(home)],
      store,
    );
    expect(new RunStore(storePath).list()[0]!.source).toBe('hook');
    run(); // first ingest with a hook record in place, cache cold
    run(); // and a warm one
    const incremental = new RunStore(storePath).list();
    expect(incremental.find((x) => x.runId === IDS.reviewer)!.source).toBe('transcript');
    expect(sorted(incremental)).toEqual(sorted(fresh()));
  });

  it('(d2) a hook record planted after a warm ingest still upgrades', () => {
    run();
    const stored = new RunStore(storePath);
    const existing = stored.list().find((x) => x.runId === IDS.reviewer)!;
    stored.upsert({ ...existing, source: 'hook', totalToolUseCount: 999 });
    const incremental = run();
    const r = incremental.find((x) => x.runId === IDS.reviewer)!;
    expect(r.source).toBe('transcript');
    expect(r.totalToolUseCount).not.toBe(999);
    expect(sorted(incremental)).toEqual(sorted(fresh()));
  });
});

describe('only changed files are re-read', () => {
  it('re-reads just the grown sub-transcript, not its parent or siblings', () => {
    run();
    appendFileSync(
      sub(IDS.writer),
      buildSubTranscript({
        agentId: IDS.writer,
        startMs: Date.parse('2026-10-01T10:30:00.000Z'),
        durationMs: 1000,
        turns: [
          { tools: ['Bash'], usage: { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 } },
        ],
      }),
    );
    const spy = vi.spyOn(jsonl, 'readJsonl');
    run();
    const reads = readPaths(spy);
    // once for the sidechain-pass cache refresh, once for the assembly
    expect(reads.every((p) => p === sub(IDS.writer))).toBe(true);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((p) => p === sub(IDS.writer)).length).toBeLessThanOrEqual(2);
  });
});

describe('ingest cache degradation', () => {
  it('a corrupt cache file degrades to a full re-parse with the same result', () => {
    const expected = sorted(run());
    writeFileSync(ingestCachePathFor(storePath), '{ not json', 'utf8');
    const spy = vi.spyOn(jsonl, 'readJsonl');
    const again = sorted(run());
    expect(readPaths(spy).length).toBeGreaterThan(0);
    expect(again).toEqual(expected);
  });

  it('a wrong-version cache file degrades to a full re-parse', () => {
    const expected = sorted(run());
    writeFileSync(
      ingestCachePathFor(storePath),
      JSON.stringify({ version: 999, files: {} }),
      'utf8',
    );
    const spy = vi.spyOn(jsonl, 'readJsonl');
    expect(sorted(run())).toEqual(expected);
    expect(readPaths(spy).length).toBeGreaterThan(0);
  });

  it('prunes cache entries for files that no longer exist', () => {
    run();
    const cachePath = ingestCachePathFor(storePath);
    const before = Object.keys(JSON.parse(readFileSync(cachePath, 'utf8')).files);
    expect(before).toContain(sub(IDS.reviewer));
    rmSync(sub(IDS.reviewer));
    rmSync(sub(IDS.reviewer).replace('.jsonl', '.meta.json'));
    run();
    const after = Object.keys(JSON.parse(readFileSync(cachePath, 'utf8')).files);
    expect(after).not.toContain(sub(IDS.reviewer));
    expect(after.length).toBe(before.length - 1);
  });
});
