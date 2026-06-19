/**
 * Tests for `handler anchor <agent> <runId> --score <s> --reasoning <text>`.
 *
 * Covers: successful anchor creation, unknown agent error, unknown run error.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnchorStore } from '../../core/index';
import { run } from '../index';

describe('handler CLI: anchor command', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let projectsRoot: string;
  let anchorStorePath: string;
  let repo: string;
  let out: string[];

  function completed(agentType: string, agentId: string, cwd: string): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      timestamp: '2026-06-17T10:00:00.000Z',
      toolUseResult: {
        status: 'completed',
        agentId,
        agentType,
        totalDurationMs: 1000,
        totalTokens: 500,
        totalToolUseCount: 3,
      },
    });
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-anchor-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    projectsRoot = join(dir, 'projects');
    anchorStorePath = join(dir, 'anchors.json');
    repo = join(dir, 'repo');

    const agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'reviewer.md'), '# Reviewer\nReview code thoroughly.', 'utf8');

    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completed('reviewer', 'agent-1', repo),
      'utf8',
    );

    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, {
      registryPath,
      storePath,
      projectsRoot,
      anchorStorePath,
      readStdin: () => Promise.resolve(''),
      runEditor: () => 0,
      out: (line) => out.push(line),
    });

  it('persists a TierCAnchor for a known agent and run', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;

    const exitCode = await invoke([
      'anchor',
      'reviewer',
      'agent-1',
      '--score',
      'pass',
      '--reasoning',
      'Excellent code review',
    ]);

    expect(exitCode).toBe(0);
    expect(out.join('\n')).toMatch(/anchor/i);

    const store = new AnchorStore(anchorStorePath);
    const anchors = store.list();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.score).toBe('pass');
    expect(anchors[0]?.reasoning).toBe('Excellent code review');
    expect(anchors[0]?.runId).toBe('agent-1');
  });

  it('includes the definition snapshot in the persisted anchor', async () => {
    await invoke(['source', 'register', repo]);

    await invoke([
      'anchor',
      'reviewer',
      'agent-1',
      '--score',
      'fail',
      '--reasoning',
      'Missed critical issues',
    ]);

    const store = new AnchorStore(anchorStorePath);
    const anchor = store.list()[0];
    expect(anchor?.definitionSnapshot).toBeTruthy();
    expect(anchor?.score).toBe('fail');
  });

  it('exits with an error for an unknown agent', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;

    const exitCode = await invoke([
      'anchor',
      'ghost',
      'agent-1',
      '--score',
      'pass',
      '--reasoning',
      'test',
    ]);

    expect(exitCode).toBe(1);
    expect(out.join('\n')).toMatch(/ghost/);
  });

  it('exits with an error for an unknown run', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;

    const exitCode = await invoke([
      'anchor',
      'reviewer',
      'no-such-run',
      '--score',
      'pass',
      '--reasoning',
      'test',
    ]);

    expect(exitCode).toBe(1);
    expect(out.join('\n')).toMatch(/no-such-run/);
  });

  it('is idempotent: re-adding the same anchor is a no-op', async () => {
    await invoke(['source', 'register', repo]);

    await invoke(['anchor', 'reviewer', 'agent-1', '--score', 'pass', '--reasoning', 'First time']);
    await invoke([
      'anchor',
      'reviewer',
      'agent-1',
      '--score',
      'fail',
      '--reasoning',
      'Second time',
    ]);

    const store = new AnchorStore(anchorStorePath);
    // AnchorStore.add is a no-op for duplicate (identityKey, runId) pairs
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.score).toBe('pass');
  });
});
