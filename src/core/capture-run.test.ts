import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assembleCapturedRun, type CaptureInput } from './capture-run';
import { repoSource, userSource } from './sources/source';

describe('assembleCapturedRun', () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'handler-capture-'));
    home = mkdtempSync(join(tmpdir(), 'handler-capture-home-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function writeAgent(base: string, name: string, content: string): void {
    const dir = join(base, '.claude', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), content, 'utf8');
  }

  function entry(
    type: 'user' | 'assistant',
    ts: string,
    extra: Record<string, unknown> = {},
  ): string {
    const message =
      type === 'assistant'
        ? {
            role: 'assistant',
            content: [{ type: 'tool_use', name: 'Read', input: {} }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }
        : { role: 'user', content: 'task' };
    return JSON.stringify({ type, timestamp: ts, message, ...extra });
  }

  function writeSidechain(name: string, fields: Record<string, unknown>): string {
    const path = join(root, name);
    const out = [
      entry('user', '2026-10-01T10:00:00.000Z', fields),
      entry('assistant', '2026-10-01T10:00:05.000Z', fields),
    ];
    writeFileSync(path, out.join('\n') + '\n', 'utf8');
    return path;
  }

  function input(over: Partial<CaptureInput> & { sidechainPath: string }): CaptureInput {
    return { agentId: 'agent-1', agentType: 'reviewer', ...over };
  }

  it('derives cwd, sessionId and timestamp from the sub-transcript and metrics from computeRunMetrics', () => {
    writeAgent(root, 'reviewer', 'def');
    const path = writeSidechain('a.jsonl', { cwd: root, sessionId: 'sess-x' });
    const run = assembleCapturedRun(input({ sidechainPath: path }), [repoSource(root)]);
    expect(run).not.toBeNull();
    expect(run!.cwd).toBe(root);
    expect(run!.sessionId).toBe('sess-x');
    expect(run!.timestamp).toBe('2026-10-01T10:00:00.000Z');
    expect(run!.totalDurationMs).toBe(5000);
    expect(run!.totalToolUseCount).toBe(1);
    expect(run!.totalTokens).toBe(15);
    expect(run!.toolStats?.readCount).toBe(1);
    expect(run!.tags).toEqual([]);
    expect(run!.runId).toBe('agent-1');
    expect(run!.sidechainPath).toBe(path);
    expect(run!.telemetry).toBeDefined();
  });

  it('uses fallback values only when the sub-transcript lacks them', () => {
    writeAgent(root, 'reviewer', 'def');
    const full = writeSidechain('full.jsonl', { cwd: root, sessionId: 'sess-x' });
    const fb = { cwd: '/other', sessionId: 'sess-fb', timestamp: '2020-01-01T00:00:00.000Z' };
    const a = assembleCapturedRun(input({ sidechainPath: full, fallback: fb }), [repoSource(root)]);
    expect(a!.cwd).toBe(root);
    expect(a!.sessionId).toBe('sess-x');
    expect(a!.timestamp).toBe('2026-10-01T10:00:00.000Z');

    const bare = writeSidechain('bare.jsonl', {});
    const b = assembleCapturedRun(input({ sidechainPath: bare, fallback: { ...fb, cwd: root } }), [
      repoSource(root),
    ]);
    expect(b!.cwd).toBe(root);
    expect(b!.sessionId).toBe('sess-fb');
    expect(b!.timestamp).toBe('2026-10-01T10:00:00.000Z');
  });

  it('uses the fallback timestamp when no entry has a parseable one', () => {
    writeAgent(root, 'reviewer', 'def');
    const path = join(root, 'nots.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'user', cwd: root }) + '\n', 'utf8');
    const run = assembleCapturedRun(
      input({ sidechainPath: path, fallback: { timestamp: '2020-01-01T00:00:00.000Z' } }),
      [repoSource(root)],
    );
    expect(run!.timestamp).toBe('2020-01-01T00:00:00.000Z');
    expect(run!.tags).toContain('incomplete');
  });

  it('takes parentAgentId and spawnDepth from meta, and status as supplied', () => {
    writeAgent(root, 'reviewer', 'def');
    const path = writeSidechain('a.jsonl', { cwd: root, sessionId: 's' });
    const run = assembleCapturedRun(
      input({
        sidechainPath: path,
        status: 'completed',
        meta: { agentType: 'reviewer', parentAgentId: 'parent-9', spawnDepth: 2 },
      }),
      [repoSource(root)],
    );
    expect(run!.parentAgentId).toBe('parent-9');
    expect(run!.spawnDepth).toBe(2);
    expect(run!.status).toBe('completed');
    const bare = assembleCapturedRun(input({ sidechainPath: path }), [repoSource(root)]);
    expect(bare!.status).toBeUndefined();
    expect(bare!.parentAgentId).toBeUndefined();
    expect(bare!.spawnDepth).toBeUndefined();
  });

  it('returns null for built-in agents and for runs matching no registered source', () => {
    const path = writeSidechain('a.jsonl', { cwd: root, sessionId: 's' });
    expect(
      assembleCapturedRun(input({ sidechainPath: path, agentType: 'Explore' }), [repoSource(root)]),
    ).toBeNull();
    expect(assembleCapturedRun(input({ sidechainPath: path }), [])).toBeNull();
  });

  it('attributes to the nearest-ancestor repo source, else user-level', () => {
    writeAgent(root, 'reviewer', 'repo def');
    writeAgent(home, 'reviewer', 'user def');
    const sources = [userSource(home), repoSource(root)];
    mkdirSync(join(root, 'sub'));
    const inRepo = writeSidechain('in.jsonl', { cwd: join(root, 'sub'), sessionId: 's' });
    const a = assembleCapturedRun(input({ sidechainPath: inRepo }), sources);
    expect(a!.definitionSnapshot).toBe('repo def');
    const outside = writeSidechain('out.jsonl', { cwd: '/elsewhere/proj', sessionId: 's' });
    const b = assembleCapturedRun(input({ sidechainPath: outside }), sources);
    expect(b!.definitionSnapshot).toBe('user def');
    expect(b!.identityKey).not.toBe(a!.identityKey);
  });

  it('tags a run with a missing definition as orphan but keeps it', () => {
    const path = writeSidechain('a.jsonl', { cwd: root, sessionId: 's' });
    const run = assembleCapturedRun(input({ sidechainPath: path }), [repoSource(root)]);
    expect(run!.definitionSnapshot).toBeNull();
    expect(run!.tags).toEqual(['orphan']);
  });

  it('tags incomplete only when the sub-transcript is missing, empty, unreadable or unusable', () => {
    writeAgent(root, 'reviewer', 'def');
    const sources = [repoSource(root)];
    const fb = { cwd: root };
    const missing = assembleCapturedRun(
      input({ sidechainPath: join(root, 'nope.jsonl'), fallback: fb }),
      sources,
    );
    expect(missing!.tags).toContain('incomplete');
    expect(missing!.totalTokens).toBeUndefined();
    expect(missing!.telemetry).toBeUndefined();

    const empty = join(root, 'empty.jsonl');
    writeFileSync(empty, '', 'utf8');
    expect(
      assembleCapturedRun(input({ sidechainPath: empty, fallback: fb }), sources)!.tags,
    ).toContain('incomplete');

    const dir = join(root, 'adir.jsonl');
    mkdirSync(dir);
    expect(
      assembleCapturedRun(input({ sidechainPath: dir, fallback: fb }), sources)!.tags,
    ).toContain('incomplete');

    const junk = join(root, 'junk.jsonl');
    writeFileSync(junk, 'not json\n{"type":"user"}\n', 'utf8');
    expect(
      assembleCapturedRun(input({ sidechainPath: junk, fallback: fb }), sources)!.tags,
    ).toContain('incomplete');
  });

  it('does not tag incomplete when meta finished is absent or false', () => {
    writeAgent(root, 'reviewer', 'def');
    const path = writeSidechain('a.jsonl', { cwd: root, sessionId: 's' });
    for (const finished of [undefined, false]) {
      const run = assembleCapturedRun(
        input({ sidechainPath: path, meta: { agentType: 'reviewer', finished } }),
        [repoSource(root)],
      );
      expect(run!.tags).not.toContain('incomplete');
    }
  });
});
