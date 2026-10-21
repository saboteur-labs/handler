/**
 * Tests for handleSubagentStop (hook handler) on the real snake_case payload.
 * Covers subagent-run-capture FR-7, FR-16, FR-18, FR-19, FR-22 (hook side), FR-34.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildSubagentStopPayload,
  CAPTURE_AGENT_IDS,
  CAPTURE_CWD,
  copyCaptureFixtures,
  expectedFromSubTranscript,
} from '../__fixtures__/capture/fixtures';
import { assembleCapturedRun } from '../capture-run';
import type { Run } from '../run';
import { repoSource, userSource, type AgentSource } from '../sources/source';
import { RunStore } from '../store/run-store';
import { handleSubagentStop } from './handler';

describe('handleSubagentStop', () => {
  let dir: string;
  let home: string;
  let storePath: string;
  let projectsRoot: string;
  let store: RunStore;

  const ids = CAPTURE_AGENT_IDS;
  const subPath = (id: string): string =>
    join(projectsRoot, '-synthetic-workspace-app', 'sess-0001', 'subagents', `agent-${id}.jsonl`);

  function writeAgent(base: string, name: string, content: string): void {
    const agents = join(base, '.claude', 'agents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, `${name}.md`), content, 'utf8');
  }

  function stop(
    agentId: string,
    agentType: string,
    over: { path?: string; cwd?: string } = {},
  ): Record<string, unknown> {
    return buildSubagentStopPayload({
      agentId,
      agentType,
      agentTranscriptPath: over.path ?? subPath(agentId),
      ...(over.cwd !== undefined && { cwd: over.cwd }),
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-hook-'));
    home = join(dir, 'home');
    writeAgent(home, 'code-reviewer', '# code-reviewer definition');
    writeAgent(home, 'doc-writer', '# doc-writer definition');
    projectsRoot = copyCaptureFixtures(join(dir, 'fx')).projectsRoot;
    storePath = join(dir, 'store', 'runs.json');
    store = new RunStore(storePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const sources = (): AgentSource[] => [userSource(home)];

  describe('capture from agent_transcript_path (FR-3, FR-18)', () => {
    it('records the run with metrics from the sub-transcript and source hook', () => {
      const result = handleSubagentStop(stop(ids.reviewer, 'code-reviewer'), sources(), store);

      expect(result).toBe('captured');
      const runs = store.list();
      expect(runs).toHaveLength(1);
      const run = runs[0]!;
      const expected = expectedFromSubTranscript(subPath(ids.reviewer))!;
      expect(run.runId).toBe(ids.reviewer);
      expect(run.agentName).toBe('code-reviewer');
      expect(run.source).toBe('hook');
      expect(run.sidechainPath).toBe(subPath(ids.reviewer));
      expect(run.totalToolUseCount).toBe(expected.toolUseCount);
      expect(run.totalDurationMs).toBe(expected.durationMs);
      expect(run.totalTokens).toBe(expected.totalTokens);
      expect(run.tags).not.toContain('incomplete');
      expect(run.definitionSnapshot).toBe('# code-reviewer definition');
    });

    it('records an incomplete run with metrics unset when the file is missing', () => {
      const result = handleSubagentStop(
        stop(ids.runlogOnly, 'code-reviewer', { path: join(dir, 'nope.jsonl') }),
        sources(),
        store,
      );

      expect(result).toBe('captured');
      const run = store.list()[0]!;
      expect(run.tags).toContain('incomplete');
      expect(run.totalDurationMs).toBeUndefined();
      expect(run.totalTokens).toBeUndefined();
      expect(run.totalToolUseCount).toBeUndefined();
    });

    it('records an incomplete run when agent_transcript_path is absent', () => {
      const payload = stop(ids.reviewer, 'code-reviewer');
      delete payload.agent_transcript_path;

      expect(handleSubagentStop(payload, sources(), store)).toBe('captured');
      expect(store.list()[0]?.tags).toContain('incomplete');
    });

    it('records an incomplete run for an empty sub-transcript', () => {
      expect(handleSubagentStop(stop(ids.empty, 'doc-writer'), sources(), store)).toBe('captured');
      const run = store.list()[0]!;
      expect(run.tags).toContain('incomplete');
      expect(run.totalTokens).toBeUndefined();
    });

    it('falls back to payload cwd and session_id when the transcript is missing', () => {
      handleSubagentStop(
        stop(ids.runlogOnly, 'code-reviewer', { path: join(dir, 'x') }),
        sources(),
        store,
      );
      expect(store.list()[0]?.cwd).toBe(CAPTURE_CWD);
      expect(store.list()[0]?.sessionId).toBe('sess-0001');
    });

    it('tags orphan when the definition is missing', () => {
      expect(handleSubagentStop(stop(ids.reviewer, 'ghost-agent'), sources(), store)).toBe(
        'captured',
      );
      const run = store.list()[0]!;
      expect(run.tags).toContain('orphan');
      expect(run.definitionSnapshot).toBeNull();
    });
  });

  describe('skips (FR-18, FR-19)', () => {
    it.each([['empty'], ['absent']])('skips an %s agent_type and writes nothing', (kind) => {
      const payload = stop(ids.reviewer, 'code-reviewer');
      if (kind === 'absent') delete payload.agent_type;
      else payload.agent_type = '';

      expect(handleSubagentStop(payload, sources(), store)).toBe('skipped');
      expect(store.list()).toHaveLength(0);
      expect(new RunStore(storePath).list()).toHaveLength(0);
    });

    it('skips built-in agents', () => {
      expect(handleSubagentStop(stop(ids.explore, 'Explore'), sources(), store)).toBe('skipped');
      expect(store.list()).toHaveLength(0);
    });

    it('skips when no registered source matches the cwd', () => {
      const repoOnly = [repoSource(join(dir, 'some-repo'))];
      expect(handleSubagentStop(stop(ids.reviewer, 'code-reviewer'), repoOnly, store)).toBe(
        'skipped',
      );
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('malformed input and store errors', () => {
    it('returns malformed for non-objects and a missing agent_id', () => {
      expect(handleSubagentStop(null, sources(), store)).toBe('malformed');
      expect(handleSubagentStop('bad', sources(), store)).toBe('malformed');
      expect(handleSubagentStop(42, sources(), store)).toBe('malformed');
      expect(handleSubagentStop([], sources(), store)).toBe('malformed');
      const payload = stop(ids.reviewer, 'code-reviewer');
      delete payload.agent_id;
      expect(handleSubagentStop(payload, sources(), store)).toBe('malformed');
      expect(store.list()).toHaveLength(0);
    });

    it('rejects the old camelCase payload as malformed', () => {
      expect(
        handleSubagentStop(
          { agentId: 'a', agentType: 'code-reviewer', cwd: home, sessionId: 's', status: 'ok' },
          sources(),
          store,
        ),
      ).toBe('malformed');
    });

    it('never throws when the store throws', () => {
      const throwing = {
        forRun: (): undefined => undefined,
        upsert: (): void => {
          throw new Error('disk full');
        },
      } as unknown as RunStore;
      expect(() =>
        handleSubagentStop(stop(ids.reviewer, 'code-reviewer'), sources(), throwing),
      ).not.toThrow();
    });
  });

  describe('dedup and precedence (FR-7, FR-22)', () => {
    it('repeated stops for one agentId yield one run', () => {
      handleSubagentStop(stop(ids.reviewer, 'code-reviewer'), sources(), store);
      handleSubagentStop(stop(ids.reviewer, 'code-reviewer'), sources(), store);
      expect(store.list()).toHaveLength(1);
      expect(new RunStore(storePath).list()).toHaveLength(1);
    });

    function seed(source: Run['source']): void {
      const run = assembleCapturedRun(
        {
          agentId: ids.reviewer,
          agentType: 'code-reviewer',
          sidechainPath: subPath(ids.reviewer),
        },
        sources(),
      )!;
      store.upsert({ ...run, source, totalTokens: 123456 });
    }

    it('never overwrites a transcript record', () => {
      seed('transcript');
      expect(handleSubagentStop(stop(ids.reviewer, 'code-reviewer'), sources(), store)).toBe(
        'captured',
      );
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.source).toBe('transcript');
      expect(runs[0]?.totalTokens).toBe(123456);
    });

    it('overwrites a runlog record', () => {
      seed('runlog');
      handleSubagentStop(stop(ids.reviewer, 'code-reviewer'), sources(), store);
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.source).toBe('hook');
      expect(runs[0]?.totalTokens).not.toBe(123456);
    });

    it('stores one record per identity when one agentId resolves differently (FR-16)', () => {
      const repoRoot = join(dir, 'repo');
      writeAgent(repoRoot, 'code-reviewer', '# repo code-reviewer');
      const both = [userSource(home), repoSource(repoRoot)];

      handleSubagentStop(
        stop(ids.reviewer, 'code-reviewer', { path: join(dir, 'm1') }),
        both,
        store,
      );
      handleSubagentStop(
        stop(ids.reviewer, 'code-reviewer', { path: join(dir, 'm2'), cwd: repoRoot }),
        both,
        store,
      );

      const runs = store.list();
      expect(runs).toHaveLength(2);
      expect(new Set(runs.map((r) => r.identityKey)).size).toBe(2);
      expect(runs.every((r) => r.runId === ids.reviewer)).toBe(true);
      expect(runs.map((r) => r.definitionSnapshot).sort()).toEqual([
        '# code-reviewer definition',
        '# repo code-reviewer',
      ]);
    });
  });
});
