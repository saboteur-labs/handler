/**
 * Tests for the Tier C judge prompt builder (tier-c-prompt.ts).
 *
 * The builder is a pure function — no I/O, fully deterministic. All tests
 * drive prompt structure: the correct sections appear (or don't) depending
 * on the inputs.
 */
import { describe, expect, it } from 'vitest';

import type { Run } from '../run';
import type { TierCAnchor } from './tier-c';
import { buildJudgePrompt } from './tier-c-prompt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: 'user::/home/user/.claude/agents::code-reviewer',
    runId: 'run-abc123',
    agentName: 'code-reviewer',
    cwd: '/home/user/project',
    sessionId: 'session-1',
    sidechainPath: undefined,
    timestamp: '2024-01-01T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 2000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: undefined,
    definitionSnapshot:
      'You are a code reviewer agent.\n\nYour job is to review code for correctness, style, and security.',
    tags: [],
    telemetry: undefined,
    ...overrides,
  };
}

function makeAnchor(overrides: Partial<TierCAnchor> = {}): TierCAnchor {
  return {
    identityKey: 'user::/home/user/.claude/agents::code-reviewer',
    runId: 'run-anchor-1',
    definitionSnapshot:
      'You are a code reviewer agent.\n\nYour job is to review code for correctness, style, and security.',
    runOutput: 'The code looks good. No issues found.',
    score: 'pass',
    reasoning: 'The agent correctly identified no issues in correct code.',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

describe('buildJudgePrompt — return type', () => {
  it('returns a non-empty string for minimal inputs', () => {
    const run = makeRun();
    const prompt = buildJudgePrompt(run, 'The output here.', []);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string even with null definition snapshot', () => {
    const run = makeRun({ definitionSnapshot: null });
    const prompt = buildJudgePrompt(run, 'Some output.', []);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string with anchors', () => {
    const run = makeRun();
    const anchors = [makeAnchor()];
    const prompt = buildJudgePrompt(run, 'The output here.', anchors);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Definition snapshot inclusion
// ---------------------------------------------------------------------------

describe('buildJudgePrompt — definition snapshot', () => {
  it('embeds the agent definition snapshot in the prompt', () => {
    const snapshot =
      'You are a code reviewer agent.\n\nYour job is to review code for correctness, style, and security.';
    const run = makeRun({ definitionSnapshot: snapshot });
    const prompt = buildJudgePrompt(run, 'Some output.', []);
    expect(prompt).toContain(snapshot);
  });

  it('handles null definition snapshot gracefully without throwing', () => {
    const run = makeRun({ definitionSnapshot: null });
    expect(() => buildJudgePrompt(run, 'Some output.', [])).not.toThrow();
  });

  it('includes agent name in the prompt', () => {
    const run = makeRun({ agentName: 'my-special-agent' });
    const prompt = buildJudgePrompt(run, 'Some output.', []);
    expect(prompt).toContain('my-special-agent');
  });
});

// ---------------------------------------------------------------------------
// Run output inclusion
// ---------------------------------------------------------------------------

describe('buildJudgePrompt — run output', () => {
  it('embeds the run output in the prompt', () => {
    const runOutput = 'This is the final output of the run: all checks passed.';
    const run = makeRun();
    const prompt = buildJudgePrompt(run, runOutput, []);
    expect(prompt).toContain(runOutput);
  });

  it('embeds a different run output when provided', () => {
    const runOutput = 'FAILURE: could not complete the task due to missing permissions.';
    const run = makeRun();
    const prompt = buildJudgePrompt(run, runOutput, []);
    expect(prompt).toContain(runOutput);
  });
});

// ---------------------------------------------------------------------------
// No-anchor path
// ---------------------------------------------------------------------------

describe('buildJudgePrompt — no anchors', () => {
  it('produces valid prompt with no few-shot section when anchors is empty', () => {
    const run = makeRun();
    const prompt = buildJudgePrompt(run, 'The output.', []);
    expect(prompt).toContain(run.definitionSnapshot as string);
    expect(prompt).toContain('The output.');
  });

  it('is deterministic — same inputs produce same output', () => {
    const run = makeRun();
    const output = 'Consistent output.';
    const p1 = buildJudgePrompt(run, output, []);
    const p2 = buildJudgePrompt(run, output, []);
    expect(p1).toBe(p2);
  });
});

// ---------------------------------------------------------------------------
// With-anchors path
// ---------------------------------------------------------------------------

describe('buildJudgePrompt — with anchors', () => {
  it('includes anchor run output in the prompt', () => {
    const run = makeRun();
    const anchor = makeAnchor({ runOutput: 'Anchor example output text here.' });
    const prompt = buildJudgePrompt(run, 'The output.', [anchor]);
    expect(prompt).toContain('Anchor example output text here.');
  });

  it('includes anchor score/label in the prompt', () => {
    const run = makeRun();
    const anchor = makeAnchor({ score: 'pass' });
    const prompt = buildJudgePrompt(run, 'The output.', [anchor]);
    expect(prompt).toContain('pass');
  });

  it('includes anchor reasoning in the prompt', () => {
    const run = makeRun();
    const anchor = makeAnchor({ reasoning: 'This was correct because it covered all edge cases.' });
    const prompt = buildJudgePrompt(run, 'The output.', [anchor]);
    expect(prompt).toContain('This was correct because it covered all edge cases.');
  });

  it('includes all anchors when multiple are provided', () => {
    const run = makeRun();
    const anchor1 = makeAnchor({
      runId: 'run-anchor-1',
      runOutput: 'First anchor output.',
      score: 'pass',
      reasoning: 'First reasoning.',
    });
    const anchor2 = makeAnchor({
      runId: 'run-anchor-2',
      runOutput: 'Second anchor output.',
      score: 'fail',
      reasoning: 'Second reasoning.',
    });
    const prompt = buildJudgePrompt(run, 'The output.', [anchor1, anchor2]);
    expect(prompt).toContain('First anchor output.');
    expect(prompt).toContain('Second anchor output.');
    expect(prompt).toContain('First reasoning.');
    expect(prompt).toContain('Second reasoning.');
  });

  it('prompts with anchors are longer than prompts without', () => {
    const run = makeRun();
    const withoutAnchors = buildJudgePrompt(run, 'The output.', []);
    const withAnchor = buildJudgePrompt(run, 'The output.', [makeAnchor()]);
    expect(withAnchor.length).toBeGreaterThan(withoutAnchors.length);
  });
});

// ---------------------------------------------------------------------------
// Output format — parseable JSON response requested
// ---------------------------------------------------------------------------

describe('buildJudgePrompt — requested output format', () => {
  it('asks for a "label" field in JSON response', () => {
    const run = makeRun();
    const prompt = buildJudgePrompt(run, 'Some output.', []);
    expect(prompt).toContain('label');
  });

  it('asks for a "reasoning" field in JSON response', () => {
    const run = makeRun();
    const prompt = buildJudgePrompt(run, 'Some output.', []);
    expect(prompt).toContain('reasoning');
  });

  it('instructs the judge to return pass or fail', () => {
    const run = makeRun();
    const prompt = buildJudgePrompt(run, 'Some output.', []);
    // "pass" and "fail" must both appear so the judge knows the valid labels
    expect(prompt).toContain('pass');
    expect(prompt).toContain('fail');
  });
});
