/**
 * Pins the real on-disk shapes the subagent-run-capture feature depends on
 * (FR-33). Each fixture must parse and carry exactly the pinned key set, so a
 * later test that leans on a fixture fails loudly if the shape drifts.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isBuiltinAgent } from '../../denylist.js';
import { readJsonl } from '../../transcripts/jsonl.js';
import {
  ASYNC_LAUNCHED_KEYS,
  CAPTURE_AGENT_IDS,
  CAPTURE_CWD,
  CAPTURE_RUNLOGS_ROOT,
  ENVELOPE_KEYS,
  FIXTURE_ROOT_TOKEN,
  META_KEYS,
  NOTIFICATION_TAGS,
  SUBAGENT_STOP_KEYS,
  capturePaths,
  copyCaptureFixtures,
  expectedFromSubTranscript,
  parseNotifications,
} from './fixtures.js';

type Json = Record<string, unknown>;

const sorted = (o: object): string[] => Object.keys(o).sort();
const sortedCopy = (keys: readonly string[]): string[] => [...keys].sort();
const readJson = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;

describe('meta.json fixtures', () => {
  const ids = [
    CAPTURE_AGENT_IDS.reviewer,
    CAPTURE_AGENT_IDS.writer,
    CAPTURE_AGENT_IDS.explore,
    CAPTURE_AGENT_IDS.empty,
    CAPTURE_AGENT_IDS.malformed,
  ];

  it('carries exactly the pinned keys, except where finished is absent', () => {
    const full = sortedCopy(META_KEYS);
    const withoutFinished = full.filter((k) => k !== 'finished');
    for (const id of ids) {
      const keys = sorted(readJson(capturePaths.meta(id)));
      expect([full, withoutFinished]).toContainEqual(keys);
    }
  });

  it('has a case with finished true and a case with finished absent', () => {
    expect(readJson(capturePaths.meta(CAPTURE_AGENT_IDS.reviewer)).finished).toBe(true);
    expect('finished' in readJson(capturePaths.meta(CAPTURE_AGENT_IDS.writer))).toBe(false);
  });

  it('has a spawnDepth-2 nested run with a parentAgentId', () => {
    const meta = readJson(capturePaths.meta(CAPTURE_AGENT_IDS.nested));
    expect(meta.spawnDepth).toBe(2);
    expect(meta.parentAgentId).toBe(CAPTURE_AGENT_IDS.reviewer);
    expect(sorted(meta)).toEqual(sortedCopy([...META_KEYS, 'parentAgentId']));
    expect(existsSync(capturePaths.subTranscript(CAPTURE_AGENT_IDS.nested))).toBe(true);
  });

  it('names a built-in agent and user agents', () => {
    const typeOf = (id: string): string => String(readJson(capturePaths.meta(id)).agentType);
    expect(isBuiltinAgent(typeOf(CAPTURE_AGENT_IDS.explore))).toBe(true);
    expect(isBuiltinAgent(typeOf(CAPTURE_AGENT_IDS.reviewer))).toBe(false);
  });
});

describe('parent transcript', () => {
  const entries = readJsonl<Json>(capturePaths.parentTranscript);

  it('holds async_launched results with exactly the pinned keys, one omitting canContinueAgent', () => {
    const results = entries
      .map((e) => e.toolUseResult)
      .filter((r): r is Json => typeof r === 'object' && r !== null);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const full = sortedCopy(ASYNC_LAUNCHED_KEYS);
    const withoutCan = full.filter((k) => k !== 'canContinueAgent');
    for (const r of results) {
      expect(r.status).toBe('async_launched');
      expect('agentType' in r).toBe(false);
      expect([full, withoutCan]).toContainEqual(sorted(r));
    }
    expect(results.some((r) => !('canContinueAgent' in r))).toBe(true);
    expect(results.some((r) => 'canContinueAgent' in r)).toBe(true);
  });

  it('holds notifications in both a user entry and a queue-operation entry', () => {
    const notes = parseNotifications(entries);
    expect(new Set(notes.map((n) => n.entryType))).toEqual(new Set(['user', 'queue-operation']));
    for (const n of notes) {
      expect(sorted(n.fields)).toEqual(sortedCopy(NOTIFICATION_TAGS));
      expect(sorted(n.usage)).toEqual(['duration_ms', 'subagent_tokens', 'tool_uses']);
    }
  });

  it('repeats a task-id with a changed status (resume) and has an unmatched task-id', () => {
    const notes = parseNotifications(entries);
    const writer = notes.filter((n) => n.taskId === CAPTURE_AGENT_IDS.writer).map((n) => n.status);
    expect(writer).toEqual(['completed', 'failed']);
    expect(notes.some((n) => n.taskId === CAPTURE_AGENT_IDS.unmatched)).toBe(true);
    expect(existsSync(capturePaths.subTranscript(CAPTURE_AGENT_IDS.unmatched))).toBe(false);
  });

  it('uses the synthetic cwd', () => {
    expect(entries.some((e) => e.cwd === CAPTURE_CWD)).toBe(true);
  });
});

describe('notification usage as an oracle for the sub-transcript', () => {
  it('agrees with expectedFromSubTranscript for the complete runs', () => {
    const notes = parseNotifications(readJsonl<Json>(capturePaths.parentTranscript));
    const complete = [
      CAPTURE_AGENT_IDS.reviewer,
      CAPTURE_AGENT_IDS.writer,
      CAPTURE_AGENT_IDS.nested,
      CAPTURE_AGENT_IDS.explore,
    ];
    for (const id of complete) {
      const last = notes.filter((n) => n.taskId === id).at(-1);
      const exp = expectedFromSubTranscript(capturePaths.subTranscript(id));
      expect(exp).toBeDefined();
      expect(last?.usage.tool_uses).toBe(exp?.toolUseCount);
      expect(last?.usage.duration_ms).toBe(exp?.durationMs);
      expect(last?.usage.subagent_tokens).toBe(exp?.totalTokens);
    }
  });

  it('computes tool-use count, duration and final-turn tokens for the reviewer', () => {
    expect(
      expectedFromSubTranscript(capturePaths.subTranscript(CAPTURE_AGENT_IDS.reviewer)),
    ).toEqual({ toolUseCount: 2, durationMs: 42000, totalTokens: 12 + 3000 + 200 + 150 });
  });

  it('returns undefined for empty and malformed sub-transcripts', () => {
    expect(
      expectedFromSubTranscript(capturePaths.subTranscript(CAPTURE_AGENT_IDS.empty)),
    ).toBeUndefined();
    expect(
      expectedFromSubTranscript(capturePaths.subTranscript(CAPTURE_AGENT_IDS.malformed)),
    ).toBeUndefined();
  });
});

describe('sub-transcripts', () => {
  it('has a complete, an empty and a malformed one', () => {
    const complete = readJsonl<Json>(capturePaths.subTranscript(CAPTURE_AGENT_IDS.reviewer));
    expect(complete.length).toBeGreaterThan(3);
    expect(complete.every((e) => e.isSidechain === true && e.cwd === CAPTURE_CWD)).toBe(true);
    expect(readFileSync(capturePaths.subTranscript(CAPTURE_AGENT_IDS.empty), 'utf8')).toBe('');
    const malformedPath = capturePaths.subTranscript(CAPTURE_AGENT_IDS.malformed);
    expect(readFileSync(malformedPath, 'utf8').length).toBeGreaterThan(0);
    expect(readJsonl(malformedPath)).toEqual([]);
  });
});

describe('runlog fixtures', () => {
  const lines = readFileSync(capturePaths.runlog, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const parsed: Json[] = [];
  let malformed = 0;
  for (const l of lines) {
    try {
      parsed.push(JSON.parse(l) as Json);
    } catch {
      malformed += 1;
    }
  }
  const stops = parsed.filter((e) => e.event === 'SubagentStop');

  it('has SubagentStop envelopes with exactly the pinned keys and snake_case payloads', () => {
    expect(stops.length).toBeGreaterThanOrEqual(4);
    for (const s of stops) {
      expect(sorted(s)).toEqual(sortedCopy(ENVELOPE_KEYS));
      expect(s.v).toBe(1);
      expect(s.tool_use_id).toBeNull();
      expect(sorted(s.payload as Json)).toEqual(sortedCopy(SUBAGENT_STOP_KEYS));
    }
  });

  it('has a non-SubagentStop event, a malformed line, an empty agent_type, a duplicate agent_id and a root-token path', () => {
    expect(parsed.some((e) => e.event !== 'SubagentStop')).toBe(true);
    expect(malformed).toBe(1);
    const payloads = stops.map((e) => e.payload as Json);
    expect(payloads.some((p) => p.agent_type === '')).toBe(true);
    const ids = payloads.map((p) => p.agent_id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
    expect(payloads.some((p) => String(p.agent_transcript_path).includes(FIXTURE_ROOT_TOKEN))).toBe(
      true,
    );
  });

  it('keeps a pointer file under runlogs/sessions/', () => {
    expect(existsSync(capturePaths.runlogPointer)).toBe(true);
    expect(capturePaths.runlogPointer).toContain(join('runlogs', 'sessions'));
    expect(readdirSync(join(CAPTURE_RUNLOGS_ROOT, 'repos'))).toEqual(['synthetic-app']);
  });
});

describe('copyCaptureFixtures', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('copies the tree and resolves the root token so transcript paths exist', () => {
    const dest = mkdtempSync(join(tmpdir(), 'capture-fixtures-'));
    dirs.push(dest);
    const { projectsRoot, runlogsRoot } = copyCaptureFixtures(dest);
    expect(existsSync(join(projectsRoot, '-synthetic-workspace-app'))).toBe(true);
    const runlog = readFileSync(
      join(runlogsRoot, 'repos', 'synthetic-app', 'sess-0001.jsonl'),
      'utf8',
    );
    expect(runlog).not.toContain(FIXTURE_ROOT_TOKEN);
    const first = JSON.parse(runlog.split('\n')[0] as string) as {
      payload: { agent_transcript_path: string };
    };
    expect(existsSync(first.payload.agent_transcript_path)).toBe(true);
  });
});
