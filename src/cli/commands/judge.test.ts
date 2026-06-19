/**
 * Tests for `handler judge <agent> <runId>` command (v1 Feature 3, Task 8).
 *
 * All tests use a fake JudgeClient — no real network calls are made.
 *
 * Scenarios covered:
 *   1. Abort path: user inputs "n" → no judge call, no store write, exits with abort message
 *   2. Confirm path: --yes flag → judge called (injected fake), result printed, annotation stored
 *   3. Failure path: judge throws → error reported, no annotation written, existing state untouched
 *   4. Pre-flight warning: must always fire before any judge call
 *   5. Unknown agent / unknown run: clear error messages, non-zero exit
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JudgeClient } from '../../core/index';
import { TierCStore } from '../../core/index';
import { run } from '../index';

// ---------------------------------------------------------------------------
// Fake judge clients
// ---------------------------------------------------------------------------

/** A fake judge client that always returns a successful "pass" result. */
const passFakeJudge: JudgeClient = {
  judge: vi.fn().mockResolvedValue({ label: 'pass', reasoning: 'Looks good to me.' }),
};

/** A fake judge client that always throws. */
const failFakeJudge: JudgeClient = {
  judge: vi.fn().mockRejectedValue(new Error('Judge API error: timeout')),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function completedEntry(agentType: string, agentId: string, cwd: string): string {
  return JSON.stringify({
    type: 'user',
    cwd,
    sessionId: 'session-1',
    timestamp: '2026-06-01T10:00:00.000Z',
    toolUseResult: {
      status: 'completed',
      agentId,
      agentType,
      totalDurationMs: 2000,
      totalTokens: 1000,
      totalToolUseCount: 5,
      toolStats: {},
    },
  });
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

describe('handler CLI: judge command (v1 Feature 3, Task 8)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let projectsRoot: string;
  let tierCStorePath: string;
  let agentsHome: string;
  let out: string[];
  let errOut: string[];

  const AGENT_NAME = 'reviewer';
  const RUN_ID = 'agent-run-1';

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-judge-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    projectsRoot = join(dir, 'projects');
    tierCStorePath = join(dir, 'tier-c.json');
    agentsHome = join(dir, 'home');

    // Create agent definition
    const agentsDir = join(agentsHome, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, `${AGENT_NAME}.md`), 'You are a code reviewer.', 'utf8');

    // Create a completed run transcript
    const projectDir = join(projectsRoot, 'project-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry(AGENT_NAME, RUN_ID, agentsHome),
      'utf8',
    );

    out = [];
    errOut = [];

    // Reset mock call counts between tests
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Register the source and clear output, returning the invoke helper. */
  const makeInvoke =
    (judgeClient: JudgeClient, stdin = 'n') =>
    (args: string[]): Promise<number> =>
      run(args, {
        registryPath,
        storePath,
        projectsRoot,
        tierCStorePath,
        judgeClient,
        readStdin: () => Promise.resolve(stdin),
        runEditor: () => 0,
        out: (line) => out.push(line),
        err: (line) => errOut.push(line),
      });

  // -------------------------------------------------------------------------
  // Test: pre-flight warning always fires
  // -------------------------------------------------------------------------

  it('always prints a warning before any judge action', async () => {
    const invoke = makeInvoke(passFakeJudge, 'n');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    // Even on abort (input "n"), the warning must have been printed first
    await invoke(['judge', AGENT_NAME, RUN_ID]);
    const output = out.join('\n');

    expect(output).toMatch(/WARNING/i);
    expect(output).toMatch(/transmit/i);
  });

  // -------------------------------------------------------------------------
  // Test: abort path — user says "n"
  // -------------------------------------------------------------------------

  it('aborts with no judge call and no store write when user inputs "n"', async () => {
    const invoke = makeInvoke(passFakeJudge, 'n');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    const code = await invoke(['judge', AGENT_NAME, RUN_ID]);

    // Exit 0 — the user chose to abort, this is not an error
    expect(code).toBe(0);

    // Judge must not have been called
    expect(passFakeJudge.judge).not.toHaveBeenCalled();

    // Nothing must have been written to the Tier C store
    const store = new TierCStore(tierCStorePath);
    expect(store.list()).toHaveLength(0);

    // Output must confirm abort
    expect(out.join('\n')).toMatch(/[Aa]borted/);
    expect(out.join('\n')).toMatch(/[Nn]o data transmitted/);
  });

  it('aborts when user inputs "N" (case-insensitive)', async () => {
    const invoke = makeInvoke(passFakeJudge, 'N');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    await invoke(['judge', AGENT_NAME, RUN_ID]);

    expect(passFakeJudge.judge).not.toHaveBeenCalled();
    const store = new TierCStore(tierCStorePath);
    expect(store.list()).toHaveLength(0);
  });

  it('aborts when user inputs empty string (default is N)', async () => {
    const invoke = makeInvoke(passFakeJudge, '');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    await invoke(['judge', AGENT_NAME, RUN_ID]);

    expect(passFakeJudge.judge).not.toHaveBeenCalled();
    const store = new TierCStore(tierCStorePath);
    expect(store.list()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test: confirm path — --yes flag skips interactive prompt
  // -------------------------------------------------------------------------

  it('calls the judge and stores the result when --yes flag is provided', async () => {
    const invoke = makeInvoke(passFakeJudge, 'n'); // stdin "n" should be ignored with --yes
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    const code = await invoke(['judge', AGENT_NAME, RUN_ID, '--yes']);

    expect(code).toBe(0);
    expect(passFakeJudge.judge).toHaveBeenCalledOnce();

    // Tier C annotation must have been persisted
    const store = new TierCStore(tierCStorePath);
    const annotations = store.list();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.result.label).toBe('pass');
    expect(annotations[0]?.result.reasoning).toBe('Looks good to me.');
    expect(annotations[0]?.runId).toBe(RUN_ID);
  });

  it('calls the judge and stores the result when --confirm flag is provided', async () => {
    const invoke = makeInvoke(passFakeJudge, 'n');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    const code = await invoke(['judge', AGENT_NAME, RUN_ID, '--confirm']);

    expect(code).toBe(0);
    expect(passFakeJudge.judge).toHaveBeenCalledOnce();

    const store = new TierCStore(tierCStorePath);
    expect(store.list()).toHaveLength(1);
  });

  it('calls the judge when user inputs "y"', async () => {
    const invoke = makeInvoke(passFakeJudge, 'y');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    const code = await invoke(['judge', AGENT_NAME, RUN_ID]);

    expect(code).toBe(0);
    expect(passFakeJudge.judge).toHaveBeenCalledOnce();

    const store = new TierCStore(tierCStorePath);
    expect(store.list()).toHaveLength(1);
  });

  it('calls the judge when user inputs "yes"', async () => {
    const invoke = makeInvoke(passFakeJudge, 'yes');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    const code = await invoke(['judge', AGENT_NAME, RUN_ID]);

    expect(code).toBe(0);
    expect(passFakeJudge.judge).toHaveBeenCalledOnce();
  });

  it('prints the Tier C result label and reasoning on success', async () => {
    const invoke = makeInvoke(passFakeJudge, 'n');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    await invoke(['judge', AGENT_NAME, RUN_ID, '--yes']);
    const output = out.join('\n');

    expect(output).toMatch(/[Tt]ier C/i);
    expect(output).toMatch(/pass/i);
    expect(output).toMatch(/Looks good to me\./);
  });

  // -------------------------------------------------------------------------
  // Test: failure path — judge throws
  // -------------------------------------------------------------------------

  it('reports the error and exits non-zero when the judge throws', async () => {
    const invoke = makeInvoke(failFakeJudge, 'n');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;
    errOut.length = 0;

    const code = await invoke(['judge', AGENT_NAME, RUN_ID, '--yes']);

    expect(code).toBe(1);

    // Error message must mention the failure
    const allOutput = [...out, ...errOut].join('\n');
    expect(allOutput).toMatch(/Judge API error: timeout/);
  });

  it('writes no annotation when the judge throws', async () => {
    const invoke = makeInvoke(failFakeJudge, 'n');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    await invoke(['judge', AGENT_NAME, RUN_ID, '--yes']);

    // Store must remain empty — no partial annotation
    const store = new TierCStore(tierCStorePath);
    expect(store.list()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test: unknown agent / run
  // -------------------------------------------------------------------------

  it('exits non-zero with a clear error when the agent is not found', async () => {
    const invoke = makeInvoke(passFakeJudge, 'y');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    const code = await invoke(['judge', 'unknown-agent', RUN_ID, '--yes']);

    expect(code).toBe(1);
    expect([...out, ...errOut].join('\n')).toMatch(/unknown-agent/);
  });

  it('exits non-zero with a clear error when the run id is not found', async () => {
    const invoke = makeInvoke(passFakeJudge, 'y');
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;

    const code = await invoke(['judge', AGENT_NAME, 'nonexistent-run-id', '--yes']);

    expect(code).toBe(1);
    expect([...out, ...errOut].join('\n')).toMatch(/nonexistent-run-id/);
  });
});
