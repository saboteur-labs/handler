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

import { buildSubagentStopPayload } from '../core/__fixtures__/capture/fixtures';
import { parseJsonInput } from './hook-handler';

// ---------------------------------------------------------------------------
// Unit tests for parseJsonInput helper
// ---------------------------------------------------------------------------

describe('parseJsonInput', () => {
  it('returns parsed object for valid JSON object', () => {
    const result = parseJsonInput(
      '{"agent_id":"agent-abc","agent_type":"my-agent","cwd":"/tmp","session_id":"s1"}',
    );
    expect(result).toEqual({
      agent_id: 'agent-abc',
      agent_type: 'my-agent',
      cwd: '/tmp',
      session_id: 's1',
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

  it('exits 0 and logs "captured: <agent_id>" for a valid captured payload', () => {
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

    const payload = JSON.stringify(
      buildSubagentStopPayload({
        agentId: 'agent-abc123',
        agentType: 'my-agent',
        agentTranscriptPath: join(dir, 'agent-abc123.jsonl'),
        cwd: repo,
      }),
    );

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

  it('exits 0 and logs "skipped: <agent_id>" for an unresolvable agent (no matching source)', () => {
    // No registry written → no sources → agent cannot be attributed
    const payload = JSON.stringify(
      buildSubagentStopPayload({
        agentId: 'agent-noresource',
        agentType: 'unknown-agent',
        agentTranscriptPath: join(dir, 'agent-noresource.jsonl'),
        cwd: '/tmp/nowhere',
      }),
    );

    const { status, stderr, stdout } = runHook(payload);

    expect(status).toBe(0);
    expect(stderr.trim()).toBe('skipped: agent-noresource');
    expect(stdout).toBe('');
  });
  it('exits 0 and logs "skipped: <agent_id>" for an empty agent_type', () => {
    const payload = JSON.stringify(
      buildSubagentStopPayload({
        agentId: 'agent-empty-type',
        agentType: '',
        agentTranscriptPath: join(dir, 'agent-empty-type.jsonl'),
        cwd: repo,
      }),
    );

    const { status, stderr, stdout } = runHook(payload);

    expect(status).toBe(0);
    expect(stderr.trim()).toBe('skipped: agent-empty-type');
    expect(stdout).toBe('');
  });

  it.each([['[]'], ['"a string"'], ['42'], ['null']])(
    'exits 0 and logs "malformed: unknown" for non-object JSON %s',
    (raw) => {
      const { status, stderr, stdout } = runHook(raw);

      expect(status).toBe(0);
      expect(stderr.trim()).toBe('malformed: unknown');
      expect(stdout).toBe('');
    },
  );

  it('exits 0 with an "error: <message>" line and no stdout when the store fails', () => {
    writeFileSync(
      registryPath,
      JSON.stringify({ version: 1, sources: [{ type: 'repo', root: repo }] }),
      'utf8',
    );
    // A directory where the store file should be makes the write fail.
    mkdirSync(storePath, { recursive: true });
    const payload = JSON.stringify(
      buildSubagentStopPayload({
        agentId: 'agent-store-fail',
        agentType: 'my-agent',
        agentTranscriptPath: join(dir, 'agent-store-fail.jsonl'),
        cwd: repo,
      }),
    );

    const { status, stderr, stdout } = runHook(payload);

    expect(status).toBe(0);
    expect(stderr.trim()).toMatch(/^error: .+/);
    expect(stdout).toBe('');
  });
});
