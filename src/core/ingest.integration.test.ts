/**
 * Full-pipeline integration test for nested subagent capture (V1 Feature 7).
 *
 * Exercises Reqs 39-44 across a vertical slice using static JSONL fixture data
 * under `src/core/__fixtures__/nested/`. A real temp store is created per test.
 *
 * Fixture structure (relative to __fixtures__/nested/projects/project-abc/):
 *   session-root.jsonl                                    — parent transcript, spawns agent-1 (orchestrator)
 *   session-root/subagents/agent-agent-1.jsonl            — depth-1 sidechain, spawns agent-2 (worker)
 *   session-root/subagents/session-nested/subagents/agent-agent-2.jsonl  — depth-2 sidechain, spawns agent-3 (validator)
 *   session-root/subagents/agent-agent-99.jsonl           — interrupted sidechain (agent-4, checker)
 *
 * The fixtures use cwd="/Users/me/repo" which has no matching repo source. A
 * user-level source registered on a temp directory covers all four agents
 * (orchestrator, worker, validator, checker) so every non-built-in run is
 * attributed rather than dropped.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentIdentity, identityKey, ingest, resolveParentAnnotation, userSource } from './index';
import { RunStore } from './store/run-store';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the nested fixture projectsRoot. */
const FIXTURE_PROJECTS_ROOT = resolve(__dirname, '__fixtures__', 'nested', 'projects');

describe('ingest — nested subagent capture integration (Reqs 39-44)', () => {
  let agentsHomeDir: string;
  let storePath: string;

  beforeEach(() => {
    // Temp directory that serves as the user-level agents home. Agent definition
    // files are placed here so attribution succeeds for all fixture agents.
    agentsHomeDir = mkdtempSync(join(tmpdir(), 'handler-nested-int-'));
    const agentsDir = join(agentsHomeDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'orchestrator.md'), 'orchestrator definition', 'utf8');
    writeFileSync(join(agentsDir, 'worker.md'), 'worker definition', 'utf8');
    writeFileSync(join(agentsDir, 'validator.md'), 'validator definition', 'utf8');
    writeFileSync(join(agentsDir, 'checker.md'), 'checker definition', 'utf8');

    storePath = join(mkdtempSync(join(tmpdir(), 'handler-nested-store-')), 'runs.json');
  });

  afterEach(() => {
    rmSync(agentsHomeDir, { recursive: true, force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  });

  function runIngest(): ReturnType<typeof ingest> {
    return ingest({
      sources: [userSource(agentsHomeDir)],
      projectsRoot: FIXTURE_PROJECTS_ROOT,
      storePath,
    });
  }

  // Req 39 — discovery: ingest discovers nested runs at depth ≥ 1
  it('Req 39: discovers and ingests nested runs from sidechain files at depth ≥ 1', () => {
    const runs = runIngest();

    // Top-level run (orchestrator, agent-1) from parent transcript.
    expect(runs.find((r) => r.runId === 'agent-1')).toBeDefined();

    // Depth-1 nested run (worker, agent-2) from agent-agent-1.jsonl.
    expect(runs.find((r) => r.runId === 'agent-2')).toBeDefined();

    // Depth-2 nested run (validator, agent-3) from session-nested/subagents/agent-agent-2.jsonl.
    expect(runs.find((r) => r.runId === 'agent-3')).toBeDefined();
  });

  // Req 40 — attribution: nested runs attributed to their own identity tuple
  it('Req 40: attributes each nested run to its own agent name, not the parent agent', () => {
    const runs = runIngest();
    const source = userSource(agentsHomeDir);

    const orchestratorRun = runs.find((r) => r.runId === 'agent-1');
    expect(orchestratorRun?.agentName).toBe('orchestrator');
    expect(orchestratorRun?.identityKey).toBe(identityKey(agentIdentity(source, 'orchestrator')));

    const workerRun = runs.find((r) => r.runId === 'agent-2');
    expect(workerRun?.agentName).toBe('worker');
    expect(workerRun?.identityKey).toBe(identityKey(agentIdentity(source, 'worker')));

    const validatorRun = runs.find((r) => r.runId === 'agent-3');
    expect(validatorRun?.agentName).toBe('validator');
    expect(validatorRun?.identityKey).toBe(identityKey(agentIdentity(source, 'validator')));
  });

  // Req 41 — lineage pointer: parentAgentId set on nested runs, absent on top-level
  it('Req 41: sets parentAgentId on nested runs and leaves it undefined on the top-level run', () => {
    const runs = runIngest();

    // Top-level run: spawned directly by a human session, no parent agent.
    const orchestratorRun = runs.find((r) => r.runId === 'agent-1');
    expect(orchestratorRun?.parentAgentId).toBeUndefined();

    // Depth-1: orchestrator (agent-1) spawned this run.
    const workerRun = runs.find((r) => r.runId === 'agent-2');
    expect(workerRun?.parentAgentId).toBe('agent-1');

    // Depth-2: worker (agent-2) spawned this run.
    const validatorRun = runs.find((r) => r.runId === 'agent-3');
    expect(validatorRun?.parentAgentId).toBe('agent-2');
  });

  // Req 42 — dedup: re-running ingest over the same fixtures produces no duplicates
  it('Req 42: is idempotent — re-ingesting the same fixtures produces no duplicate records', () => {
    runIngest();
    runIngest();

    const store = new RunStore(storePath);
    const all = store.list();

    // Each agentId should appear exactly once in the store.
    for (const agentId of ['agent-1', 'agent-2', 'agent-3', 'agent-4']) {
      expect(all.filter((r) => r.runId === agentId).length).toBeLessThanOrEqual(1);
    }
  });

  // Req 43 — resilience: interrupted nested sidechain kept-and-tagged 'incomplete'
  it('Req 43: keeps and tags interrupted nested runs as incomplete rather than dropping them', () => {
    const runs = runIngest();

    // agent-4 (checker) is from agent-agent-99.jsonl with status "interrupted".
    const checkerRun = runs.find((r) => r.runId === 'agent-4');
    expect(checkerRun).toBeDefined();
    expect(checkerRun?.agentName).toBe('checker');
    expect(checkerRun?.tags).toContain('incomplete');
    // The lineage pointer still reflects the parent sidechain filename.
    expect(checkerRun?.parentAgentId).toBe('agent-99');
  });

  // Req 44 — annotation: resolveParentAnnotation resolves correctly for each run
  it('Req 44: resolveParentAnnotation resolves parentAgentId to a human-readable annotation', () => {
    const runs = runIngest();

    // worker (agent-2) was spawned by orchestrator (agent-1).
    const workerRun = runs.find((r) => r.runId === 'agent-2');
    expect(workerRun?.parentAgentId).toBeDefined();
    expect(resolveParentAnnotation(workerRun!.parentAgentId!, runs)).toBe(
      'spawned by orchestrator',
    );

    // validator (agent-3) was spawned by worker (agent-2).
    const validatorRun = runs.find((r) => r.runId === 'agent-3');
    expect(validatorRun?.parentAgentId).toBeDefined();
    expect(resolveParentAnnotation(validatorRun!.parentAgentId!, runs)).toBe('spawned by worker');

    // checker (agent-4) was spawned by a parent run (agent-99) that isn't in the store
    // (no transcript entry references agent-99 as a top-level run). Falls back to raw id.
    const checkerRun = runs.find((r) => r.runId === 'agent-4');
    expect(checkerRun?.parentAgentId).toBeDefined();
    expect(resolveParentAnnotation(checkerRun!.parentAgentId!, runs)).toBe('spawned by agent-99');
  });
});
