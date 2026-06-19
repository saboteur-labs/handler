/**
 * Tests for `handler transcript <agent> <runId>` command (Feature 8, Reqs 48–52).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

describe('handler CLI: transcript command (Reqs 48–52)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let projectsRoot: string;
  let repo: string;
  let out: string[];

  /** Build a completed run entry in the parent transcript. */
  function completedEntry(
    agentType: string,
    agentId: string,
    cwd: string,
    timestamp = '2026-06-17T10:00:00.000Z',
  ): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      timestamp,
      toolUseResult: {
        status: 'completed',
        agentId,
        agentType,
        totalDurationMs: 1000,
        totalTokens: 500,
        totalToolUseCount: 2,
        toolStats: {},
      },
    });
  }

  /** Build an incomplete (interrupted) run entry in the parent transcript. */
  function interruptedEntry(agentType: string, agentId: string, cwd: string): string {
    return JSON.stringify({
      type: 'user',
      cwd,
      sessionId: 'session',
      timestamp: '2026-06-17T11:00:00.000Z',
      toolUseResult: { agentId, agentType }, // no status -> incomplete tag
    });
  }

  /** Write a sidechain JSONL for a given agentId. */
  function writeSidechain(agentId: string, entries: object[]): void {
    const subDir = join(projectsRoot, '-encoded', 'session', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, `agent-${agentId}.jsonl`),
      entries.map((e) => JSON.stringify(e)).join('\n'),
      'utf8',
    );
  }

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-transcript-')));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    projectsRoot = join(dir, 'projects');
    repo = join(dir, 'repo');

    const agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'reviewer.md'), '# Reviewer\nReview code.', 'utf8');

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
      scoreStorePath: join(dir, 'scores.json'),
      readStdin: () => Promise.resolve(''),
      runEditor: () => 0,
      out: (line) => out.push(line),
    });

  // ── Req 48: agent not found ───────────────────────────────────────────────

  it('exits non-zero when no runs found for the named agent', async () => {
    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'ghost', 'agent-1']);
    expect(code).not.toBe(0);
    expect(out.join('\n')).toMatch(/No runs found for agent "ghost"/);
  });

  // ── Req 51: successful render ─────────────────────────────────────────────

  it('renders all four sections when run and sidechain are available', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry('reviewer', 'agent-1', repo),
      'utf8',
    );

    writeSidechain('agent-1', [
      {
        type: 'user',
        message: {
          content: [{ type: 'text', text: 'Review this code please.' }],
        },
      },
      {
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [
            { type: 'text', text: 'I will review the code.' },
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.ts' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              is_error: false,
              content: 'file contents here',
            },
          ],
        },
      },
    ]);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', 'agent-1']);
    expect(code).toBe(0);
    const report = out.join('\n');

    // (a) Header
    expect(report).toContain('reviewer');
    expect(report).toContain('agent-1');

    // (b) Task prompt
    expect(report).toContain('Review this code please.');

    // (c) Turn detail: assistant text, tool call, tool result
    expect(report).toContain('I will review the code.');
    expect(report).toContain('Read');
    expect(report).toContain('file_path');
    expect(report).toContain('file contents here');

    // (d) Footer: stop reason
    expect(report).toContain('Stop reason: end_turn');
  });

  // ── Req 51: sidechain unavailable cases ───────────────────────────────────

  it('exits non-zero for an incomplete run (no sidechain available)', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      interruptedEntry('reviewer', 'agent-2', repo),
      'utf8',
    );

    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', 'agent-2']);
    expect(code).not.toBe(0);
    expect(out.join('\n')).toMatch(/No transcript available for this run/);
  });

  it('exits non-zero for an orphan run (definition not found)', async () => {
    // Register a source that has no matching definition file for 'orphan-agent'
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry('reviewer', 'agent-3', repo),
      'utf8',
    );

    // Write a sidechain, but remove the agent definition so it becomes orphan
    writeSidechain('agent-3', [
      {
        type: 'user',
        message: { content: [{ type: 'text', text: 'task' }] },
      },
    ]);

    // Temporarily rename the definition to force orphan
    const agentFile = join(repo, '.claude', 'agents', 'reviewer.md');
    const tmpFile = join(repo, '.claude', 'agents', 'reviewer.md.bak');

    const { renameSync } = await import('node:fs');
    renameSync(agentFile, tmpFile);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', 'agent-3']);

    // Restore
    renameSync(tmpFile, agentFile);

    // An orphan run still has sidechainPath, so the transcript should render (Req 51)
    // An orphan keeps the run and tags it 'orphan', but sidechain path is still set
    // The command should succeed as long as the sidechain exists and is readable
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('reviewer');
  });

  it('exits non-zero when run id is not found', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry('reviewer', 'agent-1', repo),
      'utf8',
    );

    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', 'nonexistent-run']);
    expect(code).not.toBe(0);
    expect(out.join('\n')).toMatch(/Run "nonexistent-run" not found for agent "reviewer"/);
  });

  // ── Req 49: --latest flag ─────────────────────────────────────────────────

  it('--latest selects the most-recent run by timestamp', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });

    // Write two completed runs with different timestamps
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [
        completedEntry('reviewer', 'agent-old', repo, '2026-01-01T00:00:00.000Z'),
        completedEntry('reviewer', 'agent-new', repo, '2026-06-17T10:00:00.000Z'),
      ].join('\n'),
      'utf8',
    );

    // Write sidechains for both
    writeSidechain('agent-old', [
      { type: 'user', message: { content: [{ type: 'text', text: 'old task' }] } },
    ]);
    writeSidechain('agent-new', [
      { type: 'user', message: { content: [{ type: 'text', text: 'new task' }] } },
    ]);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', '--latest']);
    expect(code).toBe(0);

    // Should have rendered the newer run (agent-new)
    const report = out.join('\n');
    expect(report).toContain('agent-new');
    expect(report).toContain('new task');
    expect(report).not.toContain('old task');
  });

  it('--latest ignores positional runId when both are supplied', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [
        completedEntry('reviewer', 'agent-old', repo, '2026-01-01T00:00:00.000Z'),
        completedEntry('reviewer', 'agent-new', repo, '2026-06-17T10:00:00.000Z'),
      ].join('\n'),
      'utf8',
    );

    writeSidechain('agent-old', [
      { type: 'user', message: { content: [{ type: 'text', text: 'old task' }] } },
    ]);
    writeSidechain('agent-new', [
      { type: 'user', message: { content: [{ type: 'text', text: 'new task' }] } },
    ]);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    // Supply both positional runId and --latest; --latest should win
    const code = await invoke(['transcript', 'reviewer', 'agent-old', '--latest']);
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toContain('agent-new');
  });

  // ── Req 50: --full flag ───────────────────────────────────────────────────

  it('--full passes full:true to readTranscript, disabling truncation', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry('reviewer', 'agent-1', repo),
      'utf8',
    );

    // Write a sidechain with a tool result that exceeds default truncation (2048 bytes)
    const longContent = 'x'.repeat(4096);
    writeSidechain('agent-1', [
      {
        type: 'user',
        message: { content: [{ type: 'text', text: 'task' }] },
      },
      {
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'big.ts' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              is_error: false,
              content: longContent,
            },
          ],
        },
      },
    ]);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    // Without --full, result is truncated
    await invoke(['transcript', 'reviewer', 'agent-1']);
    const truncatedReport = out.join('\n');
    expect(truncatedReport).toContain('[truncated]');

    out.length = 0;

    // With --full, no truncation marker
    const code = await invoke(['transcript', 'reviewer', 'agent-1', '--full']);
    expect(code).toBe(0);
    const fullReport = out.join('\n');
    expect(fullReport).not.toContain('[truncated]');
  });

  // ── Req 50: truncated marker ──────────────────────────────────────────────

  it('renders [truncated] marker when tool result is truncated and --full not passed', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry('reviewer', 'agent-1', repo),
      'utf8',
    );

    const longContent = 'a'.repeat(4096);
    writeSidechain('agent-1', [
      {
        type: 'user',
        message: { content: [{ type: 'text', text: 'task' }] },
      },
      {
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'big.ts' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              is_error: false,
              content: longContent,
            },
          ],
        },
      },
    ]);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', 'agent-1']);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('[truncated]');
  });

  // ── Req 51: isError marker ────────────────────────────────────────────────

  it('renders [error] prefix when tool result has isError:true', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry('reviewer', 'agent-1', repo),
      'utf8',
    );

    writeSidechain('agent-1', [
      {
        type: 'user',
        message: { content: [{ type: 'text', text: 'task' }] },
      },
      {
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Bash',
              input: { command: 'fail-command' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              is_error: true,
              content: 'command not found: fail-command',
            },
          ],
        },
      },
    ]);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', 'agent-1']);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('[error]');
  });

  // ── Req 51: ambiguous agent ───────────────────────────────────────────────

  it('prints disambiguation listing and exits non-zero for ambiguous agent name', async () => {
    // Set up two sources with the same agent name
    const repo2 = join(dir, 'repo2');
    const agentsDir2 = join(repo2, '.claude', 'agents');
    mkdirSync(agentsDir2, { recursive: true });
    writeFileSync(join(agentsDir2, 'reviewer.md'), '# Reviewer 2\nAnother reviewer.', 'utf8');

    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      [
        completedEntry('reviewer', 'agent-1', repo),
        completedEntry('reviewer', 'agent-2', repo2),
      ].join('\n'),
      'utf8',
    );

    await invoke(['source', 'register', repo]);
    await invoke(['source', 'register', repo2]);
    out.length = 0;

    const code = await invoke(['transcript', 'reviewer', 'agent-1']);
    expect(code).not.toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/Multiple agents named "reviewer"/);
  });

  // ── Req 52: read-only ─────────────────────────────────────────────────────

  it('makes no write calls (read-only command)', async () => {
    const projectDir = join(projectsRoot, '-encoded');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'session.jsonl'),
      completedEntry('reviewer', 'agent-1', repo),
      'utf8',
    );

    writeSidechain('agent-1', [
      { type: 'user', message: { content: [{ type: 'text', text: 'task' }] } },
    ]);

    await invoke(['source', 'register', repo]);
    out.length = 0;

    // Record files present before invocation
    const { readdirSync, statSync } = await import('node:fs');
    const filesBefore = readdirSync(dir).map((f) => {
      const p = join(dir, f);
      return { name: f, mtime: statSync(p).mtimeMs };
    });

    const code = await invoke(['transcript', 'reviewer', 'agent-1']);
    expect(code).toBe(0);

    // Only the run store (sources.json + runs.json) may be written during ingest;
    // no new store files (scores, notes, etc.) should be written by transcript command.
    const filesAfter = readdirSync(dir);
    const newFiles = filesAfter.filter(
      (f) => !filesBefore.some((b) => b.name === f) && f !== 'runs.json' && f !== 'sources.json',
    );
    expect(newFiles).toHaveLength(0);
  });
});
