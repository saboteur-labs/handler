/**
 * Cross-path integration tests for subagent-run-capture: transcript ingest,
 * the SubagentStop hook and runlog import against ONE store, in every order,
 * over the Task 1 fixtures (FR-7, FR-15, FR-16, FR-22, FR-30, FR-33).
 * Everything lives in temp dirs; no network and no real ~/.claude or ~/.handler.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CAPTURE_AGENT_IDS as IDS,
  buildSubagentStopPayload,
  copyCaptureFixtures,
} from './__fixtures__/capture/fixtures';
import { agentIdentity, identityKey } from './identity';
import { handleSubagentStop } from './hook/handler';
import { ingest } from './ingest';
import type { Run } from './run';
import { importRunlog } from './runlog/import';
import { repoSource, userSource, type AgentSource } from './sources/source';
import { RunStore } from './store/run-store';

type PathName = 'ingest' | 'hook' | 'runlog';

const ORDERINGS: readonly (readonly PathName[])[] = [
  ['ingest', 'hook', 'runlog'],
  ['ingest', 'runlog', 'hook'],
  ['hook', 'ingest', 'runlog'],
  ['hook', 'runlog', 'ingest'],
  ['runlog', 'ingest', 'hook'],
  ['runlog', 'hook', 'ingest'],
];

const FIXTURE_USER_AGENTS = ['code-reviewer', 'test-writer', 'doc-writer', 'planner'];
const HOOK_STOPS: readonly (readonly [string, string])[] = [
  [IDS.reviewer, 'code-reviewer'],
  [IDS.writer, 'test-writer'],
];

let tmp: string;
let home: string;
let storePath: string;
let projectsRoot: string;
let runlogsRoot: string;

function writeAgent(base: string, name: string): void {
  const dir = join(base, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\n---\nbody ${name}\n`);
}

function subPath(id: string): string {
  return join(
    projectsRoot,
    '-synthetic-workspace-app',
    'sess-0001',
    'subagents',
    `agent-${id}.jsonl`,
  );
}

function sources(): AgentSource[] {
  return [userSource(home)];
}

function runPath(name: PathName, srcs: readonly AgentSource[] = sources()): void {
  if (name === 'ingest') {
    ingest({ sources: srcs, projectsRoot, storePath });
  } else if (name === 'runlog') {
    importRunlog({ runlogsRoot, sources: srcs, storePath });
  } else {
    const store = new RunStore(storePath);
    for (const [agentId, agentType] of HOOK_STOPS) {
      handleSubagentStop(
        buildSubagentStopPayload({ agentId, agentType, agentTranscriptPath: subPath(agentId) }),
        srcs,
        store,
      );
    }
  }
}

function stored(): Run[] {
  return new RunStore(storePath).list();
}

function byRunId(runId: string): Run[] {
  return stored().filter((r) => r.runId === runId);
}

/** The metric fields shared by all three paths (FR-3). */
function metrics(r: Run): Record<string, unknown> {
  return {
    totalDurationMs: r.totalDurationMs,
    totalTokens: r.totalTokens,
    totalToolUseCount: r.totalToolUseCount,
    toolStats: r.toolStats,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'handler-capture-int-'));
  home = join(tmp, 'home');
  for (const name of FIXTURE_USER_AGENTS) writeAgent(home, name);
  ({ projectsRoot, runlogsRoot } = copyCaptureFixtures(join(tmp, 'fx')));
  storePath = join(tmp, 'store', 'runs.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('capture paths against one store (FR-22)', () => {
  describe.each(ORDERINGS.map((o) => [o.join(' -> '), o] as const))('order %s', (_label, order) => {
    it('converges to one transcript run per (identityKey, runId)', () => {
      for (const p of order) runPath(p);

      const runs = stored();
      const keys = runs.map((r) => `${r.identityKey}\u0000${r.runId}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const id of [IDS.reviewer, IDS.writer, IDS.empty, IDS.malformed, IDS.nested]) {
        const found = byRunId(id);
        expect(found).toHaveLength(1);
        expect(found[0]!.source).toBe('transcript');
      }
      // Built-ins are never stored by any path.
      expect(byRunId(IDS.explore)).toHaveLength(0);
      // Only runlog knows this run (its transcript path does not exist).
      const runlogOnly = byRunId(IDS.runlogOnly);
      expect(runlogOnly).toHaveLength(1);
      expect(runlogOnly[0]!.source).toBe('runlog');
    });

    it('adds nothing when every path is repeated', () => {
      for (const p of order) runPath(p);
      const before = readFileSync(storePath, 'utf8');
      for (const p of order) runPath(p);
      expect(readFileSync(storePath, 'utf8')).toBe(before);
    });
  });

  it('hook then runlog leaves the hook record', () => {
    runPath('hook');
    runPath('runlog');
    for (const [id] of HOOK_STOPS) {
      const found = byRunId(id);
      expect(found).toHaveLength(1);
      expect(found[0]!.source).toBe('hook');
    }
  });

  it('runlog then hook ends as the hook record', () => {
    runPath('runlog');
    expect(byRunId(IDS.reviewer)[0]!.source).toBe('runlog');
    runPath('hook');
    for (const [id] of HOOK_STOPS) {
      const found = byRunId(id);
      expect(found).toHaveLength(1);
      expect(found[0]!.source).toBe('hook');
    }
  });

  it('computes identical metrics on all three paths for the same sub-transcript (FR-3)', () => {
    const perPath = new Map<PathName, Record<string, unknown>>();
    for (const p of ['ingest', 'hook', 'runlog'] as const) {
      rmSync(join(tmp, 'store'), { recursive: true, force: true });
      runPath(p);
      const run = byRunId(IDS.reviewer)[0]!;
      expect(run.totalToolUseCount).toBeGreaterThan(0);
      perPath.set(p, metrics(run));
    }
    expect(perPath.get('hook')).toEqual(perPath.get('ingest'));
    expect(perPath.get('runlog')).toEqual(perPath.get('ingest'));
  });
});

describe('legacy toolUseResult and meta for the same agentId (FR-15)', () => {
  it('produce one run', () => {
    const parent = join(projectsRoot, '-synthetic-workspace-app', 'sess-0001.jsonl');
    const legacy = JSON.stringify({
      type: 'user',
      cwd: '/synthetic/workspace/app',
      sessionId: 'sess-0001',
      timestamp: '2026-10-01T10:00:20.000Z',
      toolUseResult: {
        status: 'completed',
        agentId: IDS.reviewer,
        agentType: 'code-reviewer',
        totalDurationMs: 42000,
        totalTokens: 3362,
        totalToolUseCount: 2,
        toolStats: { readCount: 2 },
      },
    });
    writeFileSync(parent, readFileSync(parent, 'utf8') + legacy + '\n');

    runPath('ingest');

    const found = byRunId(IDS.reviewer);
    expect(found).toHaveLength(1);
    expect(found[0]!.source).toBe('transcript');
    expect(found[0]!.totalToolUseCount).toBe(2);
  });
});

describe('an agentId resolving to different identities across paths', () => {
  it('yields one record per identity, each with its own source', () => {
    const repo = join(tmp, 'repo');
    writeAgent(repo, 'code-reviewer');
    const both: AgentSource[] = [userSource(home), repoSource(repo)];

    // Transcript and runlog see cwd /synthetic/workspace/app -> user identity.
    runPath('ingest', both);
    runPath('runlog', both);
    // The assembler prefers the sub-transcript's own cwd over the payload's, so a
    // hook whose sub-transcript is unreadable falls back to the payload cwd (inside
    // the repo) -> repo identity, same runId.
    handleSubagentStop(
      buildSubagentStopPayload({
        agentId: IDS.reviewer,
        agentType: 'code-reviewer',
        agentTranscriptPath: join(tmp, 'missing.jsonl'),
        cwd: repo,
      }),
      both,
      new RunStore(storePath),
    );

    const found = byRunId(IDS.reviewer);
    expect(found).toHaveLength(2);
    expect(new Set(found.map((r) => r.identityKey)).size).toBe(2);
    const userKey = identityKey(agentIdentity(userSource(home), 'code-reviewer'));
    const repoKey = identityKey(agentIdentity(repoSource(repo), 'code-reviewer'));
    const userRun = found.find((r) => r.identityKey === userKey)!;
    const repoRun = found.find((r) => r.identityKey === repoKey)!;
    expect(userRun.source).toBe('transcript');
    expect(repoRun.source).toBe('hook');
  });
});
