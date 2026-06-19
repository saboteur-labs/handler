/**
 * Integration test for the SubagentStop hook full round-trip (V1 Feature 5, Task 7).
 *
 * Exercises: hook payload → handleSubagentStop → store → ingest → store has
 * single canonical record. Tests both arrival orders, builtin-agent skip,
 * malformed-payload safety, and the no-duplicates invariant.
 *
 * Calls the CORE API directly (not via subprocess) for speed and determinism.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleSubagentStop } from '../../core/hook/handler';
import { ingest } from '../../core/ingest';
import { repoSource } from '../../core/sources/source';
import { RunStore } from '../../core/store/run-store';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** The fixed agent name used across all tests that need a real agent. */
const AGENT_NAME = 'review-agent';

/**
 * Build a minimal valid hook payload for `AGENT_NAME`.
 * Optional overrides replace individual fields.
 */
function hookPayload(
  cwd: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    agentId: 'agent-hook-001',
    agentType: AGENT_NAME,
    cwd,
    sessionId: 'session-hook-001',
    status: 'completed',
    totalDurationMs: 1500,
    totalTokens: 600,
    totalToolUseCount: 4,
    toolStats: { readCount: 3 },
    ...overrides,
  };
}

/**
 * Serialise a completed parent-transcript task entry for `AGENT_NAME`.
 * The `agentId` and `sessionId` are fixed so they match the hook payload above.
 */
function transcriptEntry(cwd: string): string {
  return JSON.stringify({
    type: 'user',
    cwd,
    sessionId: 'session-hook-001',
    timestamp: '2025-06-01T10:00:00.000Z',
    toolUseResult: {
      status: 'completed',
      agentId: 'agent-hook-001',
      agentType: AGENT_NAME,
      totalDurationMs: 1800,
      totalTokens: 750,
      totalToolUseCount: 5,
      toolStats: { readCount: 4, editCount: 1 },
    },
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('hook integration: SubagentStop round-trip', () => {
  let repoRoot: string;
  let projectsRoot: string;
  let storePath: string;

  beforeEach(() => {
    repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-hook-int-repo-')));
    projectsRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-hook-int-proj-')));
    storePath = join(
      realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-hook-int-store-'))),
      'runs.json',
    );

    // Create the agent definition so it can be resolved during assembly.
    const agentsDir = join(repoRoot, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, `${AGENT_NAME}.md`), '# review-agent definition', 'utf8');

    // Create a single project directory that holds the parent transcript file.
    const projectDir = join(projectsRoot, '-encoded-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'session-hook-001.jsonl'), transcriptEntry(repoRoot), 'utf8');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(join(storePath, '..'), { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. hook-then-ingest
  // -------------------------------------------------------------------------
  it('hook-then-ingest: results in exactly ONE record with source: transcript', () => {
    const sources = [repoSource(repoRoot)];

    // Hook fires first.
    const store = new RunStore(storePath);
    const result = handleSubagentStop(hookPayload(repoRoot), sources, store);
    expect(result).toBe('captured');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.source).toBe('hook');

    // Transcript ingest runs second — must overwrite the hook stub.
    ingest({ sources, projectsRoot, storePath });

    const finalStore = new RunStore(storePath);
    const runs = finalStore.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.source).toBe('transcript');
    // Transcript-authoritative content: totalTokens from the transcript entry.
    expect(runs[0]?.totalTokens).toBe(750);
  });

  // -------------------------------------------------------------------------
  // 2. ingest-then-hook
  // -------------------------------------------------------------------------
  it('ingest-then-hook: hook does NOT overwrite transcript record; one record remains', () => {
    const sources = [repoSource(repoRoot)];

    // Transcript ingest runs first.
    ingest({ sources, projectsRoot, storePath });

    const afterIngest = new RunStore(storePath);
    expect(afterIngest.list()).toHaveLength(1);
    expect(afterIngest.list()[0]?.source).toBe('transcript');
    const transcriptTokens = afterIngest.list()[0]?.totalTokens;

    // Hook fires after ingest — must NOT overwrite transcript record.
    const store = new RunStore(storePath);
    const result = handleSubagentStop(hookPayload(repoRoot), sources, store);

    expect(result).toBe('captured');
    const runs = store.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.source).toBe('transcript');
    // Token count must still be the transcript value, not the hook stub value.
    expect(runs[0]?.totalTokens).toBe(transcriptTokens);
  });

  // -------------------------------------------------------------------------
  // 3. builtin-agent skip
  // -------------------------------------------------------------------------
  it('builtin-agent skip: Explore payload → zero records in store', () => {
    const sources = [repoSource(repoRoot)];
    const store = new RunStore(storePath);

    const result = handleSubagentStop(
      hookPayload(repoRoot, { agentType: 'Explore', agentId: 'agent-explore-1' }),
      sources,
      store,
    );

    expect(result).toBe('skipped');
    expect(store.list()).toHaveLength(0);
  });

  it('builtin-agent skip: Plan payload → zero records in store', () => {
    const sources = [repoSource(repoRoot)];
    const store = new RunStore(storePath);

    const result = handleSubagentStop(
      hookPayload(repoRoot, { agentType: 'Plan', agentId: 'agent-plan-1' }),
      sources,
      store,
    );

    expect(result).toBe('skipped');
    expect(store.list()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 4. malformed payload
  // -------------------------------------------------------------------------
  it('malformed payload: null → zero records, function does not throw', () => {
    const sources = [repoSource(repoRoot)];
    const store = new RunStore(storePath);

    let result: string | undefined;
    expect(() => {
      result = handleSubagentStop(null, sources, store);
    }).not.toThrow();

    expect(result).toBe('malformed');
    expect(store.list()).toHaveLength(0);
  });

  it('malformed payload: missing required agentId field → zero records, does not throw', () => {
    const sources = [repoSource(repoRoot)];
    const store = new RunStore(storePath);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { agentId: _agentId, ...noAgentId } = hookPayload(repoRoot);

    let result: string | undefined;
    expect(() => {
      result = handleSubagentStop(noAgentId, sources, store);
    }).not.toThrow();

    expect(result).toBe('malformed');
    expect(store.list()).toHaveLength(0);
  });

  it('malformed payload: missing required agentType field → zero records, does not throw', () => {
    const sources = [repoSource(repoRoot)];
    const store = new RunStore(storePath);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { agentType: _agentType, ...noAgentType } = hookPayload(repoRoot);

    let result: string | undefined;
    expect(() => {
      result = handleSubagentStop(noAgentType, sources, store);
    }).not.toThrow();

    expect(result).toBe('malformed');
    expect(store.list()).toHaveLength(0);
  });

  it('malformed payload: non-object (string) → zero records, does not throw', () => {
    const sources = [repoSource(repoRoot)];
    const store = new RunStore(storePath);

    let result: string | undefined;
    expect(() => {
      result = handleSubagentStop('not-an-object', sources, store);
    }).not.toThrow();

    expect(result).toBe('malformed');
    expect(store.list()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5. no-duplicates invariant
  // -------------------------------------------------------------------------
  it('no duplicates invariant: calling handleSubagentStop twice with same payload → exactly ONE record', () => {
    const sources = [repoSource(repoRoot)];
    const store = new RunStore(storePath);
    const payload = hookPayload(repoRoot);

    handleSubagentStop(payload, sources, store);
    handleSubagentStop(payload, sources, store);

    expect(store.list()).toHaveLength(1);
  });
});
