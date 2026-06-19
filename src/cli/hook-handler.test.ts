/**
 * Tests for the `handler-hook` binary entrypoint (`hook-handler.ts`).
 *
 * Covers:
 * - JSON parse helper: valid JSON → object, invalid → null
 * - parseJsonInput: valid, invalid, empty string inputs
 * - The binary itself (subprocess): captured, skipped, malformed outcomes; always exits 0
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseJsonInput } from './hook-handler';

// ---------------------------------------------------------------------------
// Unit tests for parseJsonInput helper
// ---------------------------------------------------------------------------

describe('parseJsonInput', () => {
  it('returns parsed object for valid JSON object', () => {
    const result = parseJsonInput(
      '{"agentId":"agent-abc","agentType":"my-agent","cwd":"/tmp","sessionId":"s1","status":"completed"}',
    );
    expect(result).toEqual({
      agentId: 'agent-abc',
      agentType: 'my-agent',
      cwd: '/tmp',
      sessionId: 's1',
      status: 'completed',
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parseJsonInput('not-valid-json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseJsonInput('')).toBeNull();
  });

  it('returns parsed value for valid JSON array (non-object)', () => {
    // A JSON array is valid JSON; parseJsonInput only parses — handler.ts
    // will reject non-object payloads as malformed
    const result = parseJsonInput('[]');
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subprocess tests for the binary's process behaviour
// ---------------------------------------------------------------------------

describe('handler-hook binary (subprocess)', () => {
  let dir: string;
  let registryPath: string;
  let storePath: string;
  let agentsDir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-hook-bin-'));
    registryPath = join(dir, 'sources.json');
    storePath = join(dir, 'runs.json');
    repo = join(dir, 'repo');
    agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'my-agent.md'), '# my-agent\nDoes things.', 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Run hook-handler.ts with the given stdin and env overrides. */
  function runHook(
    stdin: string,
    env: Record<string, string> = {},
  ): { status: number; stderr: string; stdout: string } {
    // Use vite-node (available via vitest devDependency) to run the TypeScript source directly.
    const viteNodeBin = join(
      import.meta.dirname ?? __dirname,
      '..',
      '..',
      'node_modules',
      '.bin',
      'vite-node',
    );
    const hookSrc = join(import.meta.dirname ?? __dirname, 'hook-handler.ts');
    const result = spawnSync(viteNodeBin, [hookSrc], {
      input: stdin,
      env: {
        ...process.env,
        HANDLER_REGISTRY: registryPath,
        HANDLER_STORE: storePath,
        ...env,
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    return {
      status: result.status ?? -1,
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    };
  }

  it('exits 0 and logs "captured: <agentId>" for a valid captured payload', () => {
    // Register the repo source first by writing a minimal registry.
    // SourceRegistry stores sources as { type, root } (not { type, path }).
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        sources: [{ type: 'repo', root: repo }],
      }),
      'utf8',
    );

    const payload = JSON.stringify({
      agentId: 'agent-abc123',
      agentType: 'my-agent',
      cwd: repo,
      sessionId: 'session-xyz',
      status: 'completed',
      totalDurationMs: 1200,
      totalTokens: 500,
      totalToolUseCount: 3,
    });

    const { status, stderr, stdout } = runHook(payload);

    expect(status).toBe(0);
    expect(stderr.trim()).toBe('captured: agent-abc123');
    expect(stdout).toBe('');
  });

  it('exits 0 and logs "malformed: unknown" for invalid JSON', () => {
    const { status, stderr, stdout } = runHook('not-valid-json');

    expect(status).toBe(0);
    expect(stderr.trim()).toBe('malformed: unknown');
    expect(stdout).toBe('');
  });

  it('exits 0 and logs "malformed: unknown" for empty stdin', () => {
    const { status, stderr, stdout } = runHook('');

    expect(status).toBe(0);
    expect(stderr.trim()).toBe('malformed: unknown');
    expect(stdout).toBe('');
  });

  it('exits 0 and logs "skipped: <agentId>" for an unresolvable agent (no matching source)', () => {
    // No registry written → no sources → agent cannot be attributed
    const payload = JSON.stringify({
      agentId: 'agent-noresource',
      agentType: 'unknown-agent',
      cwd: '/tmp/nowhere',
      sessionId: 'session-xyz',
      status: 'completed',
    });

    const { status, stderr, stdout } = runHook(payload);

    expect(status).toBe(0);
    expect(stderr.trim()).toBe('skipped: agent-noresource');
    expect(stdout).toBe('');
  });
});
