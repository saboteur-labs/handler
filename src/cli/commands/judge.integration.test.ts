/**
 * End-to-end integration test for the Tier C judged-quality pipeline
 * (v1 Feature 3, Task 10).
 *
 * Exercises the full opt-in pipeline: seeded run → anchor creation →
 * judge invocation → display in `handler show`. All tests use a FAKE
 * JudgeClient — zero real network calls are made anywhere in this file.
 *
 * Scenarios:
 *   a. Anchor creation: calling the anchor command persists a TierCAnchor
 *      in AnchorStore.
 *   b. Judging with anchor: after creating an anchor, invoking the judge
 *      command (--yes, fake client) produces and persists a TierCResult in
 *      TierCStore; the prompt passed to the fake includes the anchor text.
 *   c. Show renders Tier C segregated from Tier A/B: after judging, `show`
 *      renders a "Tier C" section with a distinct label; Tier A/B sections
 *      are also present and unchanged.
 *   d. Abort path: user input "n" → ZERO fake judge calls, nothing written
 *      to TierCStore.
 *   e. Judge failure: fake judge throws → no TierCResult stored; existing
 *      Tier A ScoreAnnotation and Tier B annotation are untouched.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JudgeClient } from '../../core/index';
import { AnchorStore, ScoreStore, TierBStore, TierCStore } from '../../core/index';
import { run } from '../index';

// ---------------------------------------------------------------------------
// Fake judge clients
// ---------------------------------------------------------------------------

/**
 * Spy-able fake judge that always returns "pass".
 * The spy lets tests assert on the prompt that was passed in.
 */
function makePassFakeJudge(): JudgeClient & { judge: ReturnType<typeof vi.fn> } {
  return {
    judge: vi.fn().mockResolvedValue({
      label: 'pass',
      reasoning: 'The agent output is excellent.',
    }),
  };
}

/**
 * Fake judge that always throws — simulates an API failure.
 */
function makeFailFakeJudge(): JudgeClient {
  return {
    judge: vi.fn().mockRejectedValue(new Error('Judge API error: connection refused')),
  };
}

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a completed toolUseResult transcript entry.
 */
function completedEntry(opts: {
  agentType: string;
  agentId: string;
  sessionId: string;
  cwd: string;
  timestamp?: string;
}): string {
  return JSON.stringify({
    type: 'user',
    cwd: opts.cwd,
    sessionId: opts.sessionId,
    timestamp: opts.timestamp ?? '2026-06-01T10:00:00.000Z',
    toolUseResult: {
      status: 'completed',
      agentId: opts.agentId,
      agentType: opts.agentType,
      totalDurationMs: 3000,
      totalTokens: 1200,
      totalToolUseCount: 7,
      toolStats: { readCount: 4, editCount: 2 },
    },
  });
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('handler Tier C: end-to-end integration (opt-in pipeline)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let scoreStorePath: string;
  let tierBStorePath: string;
  let tierCStorePath: string;
  let anchorStorePath: string;
  let projectsRoot: string;
  let agentsHome: string;
  let out: string[];
  let errOut: string[];

  const AGENT_NAME = 'summariser';
  const RUN_ID = 'agent-e2e-run-1';
  const ANCHOR_RUN_ID = 'agent-e2e-run-1';

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-tier-c-e2e-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    scoreStorePath = join(dir, 'scores.json');
    tierBStorePath = join(dir, 'tier-b.json');
    tierCStorePath = join(dir, 'tier-c.json');
    anchorStorePath = join(dir, 'anchors.json');
    projectsRoot = join(dir, 'projects');

    // Create a user-level agents home with one agent definition.
    agentsHome = join(dir, 'home');
    const agentsDir = join(agentsHome, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, `${AGENT_NAME}.md`),
      '# Summariser\nProduce a concise summary of the provided content.',
      'utf8',
    );

    // Write a single completed transcript for the agent.
    const projectDir = join(projectsRoot, 'project-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session-e2e.jsonl'),
      completedEntry({
        agentType: AGENT_NAME,
        agentId: RUN_ID,
        sessionId: 'session-e2e',
        cwd: agentsHome,
      }),
      'utf8',
    );

    out = [];
    errOut = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Invoke helper — injects all store paths and the given fake judge.
  // -------------------------------------------------------------------------

  function makeInvoke(judgeClient: JudgeClient, stdin = 'n'): (args: string[]) => Promise<number> {
    return (args: string[]) =>
      run(args, {
        registryPath,
        storePath,
        scoreStorePath,
        tierBStorePath,
        tierCStorePath,
        anchorStorePath,
        projectsRoot,
        judgeClient,
        readStdin: () => Promise.resolve(stdin),
        runEditor: () => 0,
        out: (line) => out.push(line),
        err: (line) => errOut.push(line),
      });
  }

  async function registerSource(invoke: (args: string[]) => Promise<number>): Promise<void> {
    await invoke(['source', 'register', '--user', agentsHome]);
    out.length = 0;
    errOut.length = 0;
  }

  // ---------------------------------------------------------------------------
  // a. Anchor creation persists in AnchorStore
  // ---------------------------------------------------------------------------

  it('(a) anchor command persists a TierCAnchor in AnchorStore', async () => {
    const invoke = makeInvoke(makePassFakeJudge());
    await registerSource(invoke);

    const code = await invoke([
      'anchor',
      AGENT_NAME,
      ANCHOR_RUN_ID,
      '--score',
      'pass',
      '--reasoning',
      'The summary was accurate and concise.',
    ]);

    expect(code).toBe(0);

    const store = new AnchorStore(anchorStorePath);
    const anchors = store.list();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.runId).toBe(ANCHOR_RUN_ID);
    expect(anchors[0]?.score).toBe('pass');
    expect(anchors[0]?.reasoning).toBe('The summary was accurate and concise.');
    // The definition snapshot must have been captured.
    expect(anchors[0]?.definitionSnapshot).toContain('Summariser');
  });

  // ---------------------------------------------------------------------------
  // b. Judging with anchor: result persisted; prompt includes anchor content
  // ---------------------------------------------------------------------------

  it('(b) judge command persists a TierCResult and includes anchor in the prompt', async () => {
    const fakeJudge = makePassFakeJudge();
    const invoke = makeInvoke(fakeJudge, 'n');
    await registerSource(invoke);

    // First create an anchor so it becomes a few-shot example.
    await invoke([
      'anchor',
      AGENT_NAME,
      ANCHOR_RUN_ID,
      '--score',
      'pass',
      '--reasoning',
      'Excellent summary output',
    ]);
    out.length = 0;

    // Now invoke the judge with --yes.
    const code = await invoke(['judge', AGENT_NAME, RUN_ID, '--yes']);

    expect(code).toBe(0);
    expect(fakeJudge.judge).toHaveBeenCalledOnce();

    // The prompt passed to the judge must contain the anchor's few-shot content.
    const prompt = fakeJudge.judge.mock.calls[0]?.[0] as string;
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('Excellent summary output');
    // It should also include the agent definition.
    expect(prompt).toContain('Summariser');

    // The TierCResult must be persisted in the Tier C store.
    const tierCStore = new TierCStore(tierCStorePath);
    const annotations = tierCStore.list();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.result.label).toBe('pass');
    expect(annotations[0]?.result.reasoning).toBe('The agent output is excellent.');
    expect(annotations[0]?.runId).toBe(RUN_ID);
  });

  // ---------------------------------------------------------------------------
  // c. Show renders Tier C section segregated from Tier A/B
  // ---------------------------------------------------------------------------

  it('(c) show renders Tier C section distinctly, Tier A/B sections present and unchanged', async () => {
    const fakeJudge = makePassFakeJudge();
    const invoke = makeInvoke(fakeJudge, 'n');
    await registerSource(invoke);

    // Judge the run (writes a Tier C annotation).
    await invoke(['judge', AGENT_NAME, RUN_ID, '--yes']);
    out.length = 0;

    // Now show the agent.
    const code = await invoke(['show', AGENT_NAME]);

    expect(code).toBe(0);
    const output = out.join('\n');

    // Tier C section must appear with a distinct label.
    expect(output).toContain('Tier C');
    expect(output).toContain('judged quality');
    expect(output).toContain('pass');
    expect(output).toContain('The agent output is excellent.');

    // Tier A section must still appear (score line).
    expect(output).toContain('score:');

    // Tier B section must still appear.
    expect(output).toContain('Tier B:');
  });

  // ---------------------------------------------------------------------------
  // d. Abort path — no call, nothing written to TierCStore
  // ---------------------------------------------------------------------------

  it('(d) aborting the judge prompt makes ZERO judge calls and writes NOTHING to TierCStore', async () => {
    const fakeJudge = makePassFakeJudge();
    const invoke = makeInvoke(fakeJudge, 'n'); // stdin "n" → abort
    await registerSource(invoke);

    const code = await invoke(['judge', AGENT_NAME, RUN_ID]);

    // Exit 0 — abort is not an error.
    expect(code).toBe(0);

    // No judge call must have been made.
    expect(fakeJudge.judge).not.toHaveBeenCalled();

    // TierCStore must remain empty.
    const tierCStore = new TierCStore(tierCStorePath);
    expect(tierCStore.list()).toHaveLength(0);

    // Confirm abort message was printed.
    expect(out.join('\n')).toMatch(/[Aa]borted/);
    expect(out.join('\n')).toMatch(/[Nn]o data transmitted/);
  });

  // ---------------------------------------------------------------------------
  // e. Judge failure — no annotation, Tier A/B stores untouched
  // ---------------------------------------------------------------------------

  it('(e) judge failure leaves no TierCResult and does not alter ScoreStore or TierBStore', async () => {
    const failJudge = makeFailFakeJudge();
    const invoke = makeInvoke(failJudge, 'n');
    await registerSource(invoke);

    // Capture Tier A and Tier B state BEFORE the failed judge call.
    const scoreStoreBefore = new ScoreStore(scoreStorePath).list();
    const tierBStoreBefore = new TierBStore(tierBStorePath).list();

    // Invoke judge with --yes; the fake judge throws.
    const code = await invoke(['judge', AGENT_NAME, RUN_ID, '--yes']);

    // Must exit non-zero on judge failure.
    expect(code).toBe(1);

    // TierCStore must remain empty — no partial state.
    const tierCStore = new TierCStore(tierCStorePath);
    expect(tierCStore.list()).toHaveLength(0);

    // Tier A ScoreStore must be unchanged.
    const scoreStoreAfter = new ScoreStore(scoreStorePath).list();
    expect(scoreStoreAfter).toStrictEqual(scoreStoreBefore);

    // Tier B store must be unchanged.
    const tierBStoreAfter = new TierBStore(tierBStorePath).list();
    expect(tierBStoreAfter).toStrictEqual(tierBStoreBefore);

    // Error output must mention the failure reason.
    const allOutput = [...out, ...errOut].join('\n');
    expect(allOutput).toMatch(/Judge API error/);
  });
});
