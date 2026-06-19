/**
 * Tests for handleSubagentStop (hook handler).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ingest } from '../ingest';
import { repoSource, userSource } from '../sources/source';
import { RunStore } from '../store/run-store';
import { handleSubagentStop } from './handler';

/** Build a minimal valid hook payload object. */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: 'agent-abc123',
    agentType: 'my-agent',
    cwd: '/tmp/project',
    sessionId: 'session-xyz',
    status: 'completed',
    totalDurationMs: 1200,
    totalTokens: 500,
    totalToolUseCount: 3,
    ...overrides,
  };
}

describe('handleSubagentStop', () => {
  let repoRoot: string;
  let storePath: string;
  let agentsDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'handler-hook-repo-'));
    agentsDir = join(repoRoot, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'my-agent.md'), '# my-agent definition', 'utf8');

    storePath = join(mkdtempSync(join(tmpdir(), 'handler-hook-store-')), 'runs.json');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(join(storePath, '..'), { recursive: true, force: true });
  });

  describe('happy-path capture', () => {
    it('returns captured and writes the run to the store', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      const payload = validPayload({ cwd: repoRoot });

      const result = handleSubagentStop(payload, sources, store);

      expect(result).toBe('captured');
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.runId).toBe('agent-abc123');
      expect(runs[0]?.agentName).toBe('my-agent');
    });

    it('stores the definition snapshot', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);

      handleSubagentStop(validPayload({ cwd: repoRoot }), sources, store);

      expect(store.list()[0]?.definitionSnapshot).toBe('# my-agent definition');
    });
  });

  describe('idempotent double-call (upsert semantics)', () => {
    it('calling twice with the same agentId results in exactly one record', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      const payload = validPayload({ cwd: repoRoot });

      handleSubagentStop(payload, sources, store);
      handleSubagentStop(payload, sources, store);

      expect(store.list()).toHaveLength(1);
    });
  });

  describe('builtin agent skip', () => {
    it('returns skipped for a known builtin agent name', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      const payload = validPayload({ agentType: 'Explore', cwd: repoRoot });

      const result = handleSubagentStop(payload, sources, store);

      expect(result).toBe('skipped');
      expect(store.list()).toHaveLength(0);
    });

    it('does not touch the store when skipped', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);

      handleSubagentStop(validPayload({ agentType: 'Plan', cwd: repoRoot }), sources, store);

      expect(store.list()).toHaveLength(0);
    });
  });

  describe('unresolvable source skip', () => {
    it('returns skipped when no registered source matches the cwd', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      // cwd that is NOT under repoRoot, and no user source registered
      const payload = validPayload({ cwd: '/some/completely/unrelated/path' });

      const result = handleSubagentStop(payload, sources, store);

      expect(result).toBe('skipped');
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('malformed payload', () => {
    it('returns malformed for null', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);

      const result = handleSubagentStop(null, sources, store);

      expect(result).toBe('malformed');
      expect(store.list()).toHaveLength(0);
    });

    it('returns malformed for a missing required field', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { agentId: _agentId, ...noAgentId } = validPayload({ cwd: repoRoot });

      const result = handleSubagentStop(noAgentId, sources, store);

      expect(result).toBe('malformed');
      expect(store.list()).toHaveLength(0);
    });

    it('returns malformed for a non-object payload', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);

      expect(handleSubagentStop('bad-string', sources, store)).toBe('malformed');
      expect(handleSubagentStop(42, sources, store)).toBe('malformed');
      expect(handleSubagentStop([], sources, store)).toBe('malformed');
    });
  });

  describe('orphan (definition missing) kept-and-tagged capture', () => {
    it('returns captured even when the agent definition file does not exist', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      // Agent name that has no matching .md file in agentsDir
      const payload = validPayload({ agentType: 'ghost-agent', cwd: repoRoot });

      const result = handleSubagentStop(payload, sources, store);

      expect(result).toBe('captured');
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.tags).toContain('orphan');
      expect(runs[0]?.definitionSnapshot).toBeNull();
    });
  });

  describe('incomplete run kept-and-tagged capture', () => {
    it('returns captured and tags the run as incomplete', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      const payload = validPayload({ cwd: repoRoot, incomplete: true });

      const result = handleSubagentStop(payload, sources, store);

      expect(result).toBe('captured');
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.tags).toContain('incomplete');
    });
  });

  describe('user-level source fallback', () => {
    it('resolves against the user-level source when a user source is registered', () => {
      // Temporarily write a definition to the real home-level agents dir is unsafe;
      // instead use a temp dir as a fake home to host a userSource.
      const fakeHome = mkdtempSync(join(tmpdir(), 'handler-hook-home-'));
      const userAgentsDir = join(fakeHome, '.claude', 'agents');
      mkdirSync(userAgentsDir, { recursive: true });
      writeFileSync(join(userAgentsDir, 'my-agent.md'), '# user-level', 'utf8');

      const sources = [userSource(fakeHome)];
      const store = new RunStore(storePath);
      // cwd matches under fakeHome
      const payload = validPayload({ cwd: fakeHome });

      const result = handleSubagentStop(payload, sources, store);

      expect(result).toBe('captured');
      expect(store.list()[0]?.agentName).toBe('my-agent');

      rmSync(fakeHome, { recursive: true, force: true });
    });
  });

  describe('source field and transcript-wins invariant', () => {
    /** Build a projects root with a single transcript containing one task entry. */
    function setupProjectsRoot(
      projectsRoot: string,
      agentType: string,
      agentId: string,
      cwd: string,
    ): void {
      const projectDir = join(projectsRoot, '-encoded-project');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(projectDir, 'session.jsonl'),
        JSON.stringify({
          type: 'user',
          cwd,
          sessionId: 'session',
          toolUseResult: {
            status: 'completed',
            agentId,
            agentType,
            totalDurationMs: 1000,
            totalTokens: 500,
            totalToolUseCount: 3,
            toolStats: {},
          },
        }),
        'utf8',
      );
    }

    it('hook-only: record persists with source: hook', () => {
      const sources = [repoSource(repoRoot)];
      const store = new RunStore(storePath);
      const payload = validPayload({ cwd: repoRoot });

      handleSubagentStop(payload, sources, store);

      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.source).toBe('hook');
    });

    it('transcript-only: record has source: transcript', () => {
      const projectsRoot = mkdtempSync(join(tmpdir(), 'handler-hook-projects-'));
      setupProjectsRoot(projectsRoot, 'my-agent', 'agent-abc123', repoRoot);
      const sources = [repoSource(repoRoot)];

      ingest({ sources, projectsRoot, storePath });

      const store = new RunStore(storePath);
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.source).toBe('transcript');

      rmSync(projectsRoot, { recursive: true, force: true });
    });

    it('hook-then-transcript: final record has transcript content and source: transcript', () => {
      const projectsRoot = mkdtempSync(join(tmpdir(), 'handler-hook-projects-'));
      setupProjectsRoot(projectsRoot, 'my-agent', 'agent-abc123', repoRoot);
      const sources = [repoSource(repoRoot)];

      // Hook fires first
      const store = new RunStore(storePath);
      handleSubagentStop(validPayload({ cwd: repoRoot }), sources, store);
      expect(store.list()[0]?.source).toBe('hook');

      // Transcript ingest overwrites the hook stub
      ingest({ sources, projectsRoot, storePath });

      const finalStore = new RunStore(storePath);
      const runs = finalStore.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.source).toBe('transcript');

      rmSync(projectsRoot, { recursive: true, force: true });
    });

    it('transcript-then-hook: hook does NOT overwrite the transcript record', () => {
      const projectsRoot = mkdtempSync(join(tmpdir(), 'handler-hook-projects-'));
      setupProjectsRoot(projectsRoot, 'my-agent', 'agent-abc123', repoRoot);
      const sources = [repoSource(repoRoot)];

      // Transcript ingest runs first
      ingest({ sources, projectsRoot, storePath });
      const afterIngest = new RunStore(storePath);
      expect(afterIngest.list()[0]?.source).toBe('transcript');

      // Hook fires after ingest — should NOT overwrite
      const store = new RunStore(storePath);
      const result = handleSubagentStop(validPayload({ cwd: repoRoot }), sources, store);

      expect(result).toBe('captured');
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]?.source).toBe('transcript');

      rmSync(projectsRoot, { recursive: true, force: true });
    });
  });
});
