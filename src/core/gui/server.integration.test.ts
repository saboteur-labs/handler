/**
 * End-to-end integration test for the GUI server (`startGuiServer`).
 *
 * Starts a real HTTP server bound to a random port, seeds it with fixture
 * transcript data on disk, and exercises the JSON API over real HTTP.
 * No mocking of transport or core functions — this verifies the full pipeline
 * from transcript JSONL files through ingest, listAgents/getAgentDetail, and
 * HTTP serialisation.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';

import type { CliContext } from '../../cli/commands/source';
import { readTranscript, SourceRegistry, userSource } from '../index';
import { RunStore } from '../store/run-store';
import type { Run } from '../run';
import { startGuiServer, type GuiServerHandle } from './server';
import { getRunTranscript } from './transcript';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a parent-session JSONL line that represents a completed subagent run.
 * This is the `toolUseResult` shape the ingest layer reads from transcript files.
 */
function completedEntry(opts: {
  agentId: string;
  agentName: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
}): string {
  return JSON.stringify({
    type: 'user',
    cwd: opts.cwd,
    sessionId: opts.sessionId,
    timestamp: opts.timestamp,
    toolUseResult: {
      status: 'completed',
      agentId: opts.agentId,
      agentType: opts.agentName,
      totalDurationMs: 1500,
      totalTokens: 800,
      totalToolUseCount: 4,
      toolStats: { readCount: 3, editCount: 1 },
    },
  });
}

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

/** Absolute path to the sidechain fixture JSONL used by transcript tests. */
const SIDECHAIN_FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../__fixtures__/transcript/sidechain.jsonl',
);

/** Run ID used for the pre-seeded transcript test run. */
const TRANSCRIPT_RUN_ID = 'test-transcript-run-1';

// ---------------------------------------------------------------------------
// Suite setup — create temp dir, write fixture files, start server
// ---------------------------------------------------------------------------

let tmpDir: string;
let serverHandle: GuiServerHandle;
let serverUrl: string;

/**
 * Computed after setup so the path is canonical (symlinks resolved, matching
 * what `normalizePath`/`userSource` will produce internally).
 */
let alphaIdentityKey: string;

beforeAll(async () => {
  // Use realpathSync.native to get a canonical path — tmpdir() on macOS often
  // returns a symlink path (/var/...) that differs from the resolved path
  // (/private/var/...). normalizePath() calls realpathSync.native internally,
  // so we must match it here when computing the expected identity key.
  tmpDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-gui-integration-')));

  const registryPath = join(tmpDir, 'sources.json');
  const storePath = join(tmpDir, 'runs.json');
  const scoreStorePath = join(tmpDir, 'scores.json');
  const noteStorePath = join(tmpDir, 'notes.json');
  const tierBStorePath = join(tmpDir, 'tier-b.json');
  const tierCStorePath = join(tmpDir, 'tier-c.json');
  const conventionsPath = join(tmpDir, 'conventions.json');
  const projectsRoot = join(tmpDir, 'projects');

  // Create a fake user-level agents directory with one agent definition.
  const agentsHome = join(tmpDir, 'home');
  const agentsDir = join(agentsHome, '.claude', 'agents');
  mkdirSync(agentsDir, { recursive: true });

  const agentDefinition = [
    '---',
    'description: An alpha test agent with enough description length for conventions.',
    'tools: [Read, Write]',
    '---',
    'You are alpha. Do alpha things carefully.',
  ].join('\n');
  writeFileSync(join(agentsDir, 'alpha.md'), agentDefinition, 'utf8');

  // Register the user source. Use `userSource` to get the same normalization
  // the server uses internally so the identity key we compute matches.
  const source = userSource(agentsHome);
  const registry = new SourceRegistry(registryPath);
  registry.register(source);

  // The identity key is [sourceType, sourcePath, agentName] where sourcePath
  // is the normalized root (from userSource).
  alphaIdentityKey = JSON.stringify(['user', source.root, 'alpha']);

  // Write fixture transcript files into projectsRoot.
  // Two completed runs for alpha in the same project directory.
  const projectDir = join(projectsRoot, '-home-encoded');
  mkdirSync(projectDir, { recursive: true });

  writeFileSync(
    join(projectDir, 'session-alpha-1.jsonl'),
    completedEntry({
      agentId: 'agent-alpha-1',
      agentName: 'alpha',
      timestamp: '2025-03-01T09:00:00.000Z',
      sessionId: 'session-alpha-1',
      cwd: agentsHome,
    }),
    'utf8',
  );

  writeFileSync(
    join(projectDir, 'session-alpha-2.jsonl'),
    completedEntry({
      agentId: 'agent-alpha-2',
      agentName: 'alpha',
      timestamp: '2025-03-10T14:00:00.000Z',
      sessionId: 'session-alpha-2',
      cwd: agentsHome,
    }),
    'utf8',
  );

  // Pre-seed the RunStore with a transcript test run so the server can serve
  // GET /api/runs/:runId/transcript without needing a matching JSONL in projectsRoot.
  // `ingest` preserves existing `source: 'transcript'` records, so this run
  // survives the ingest call the server makes on each request.
  // Use a distinct identity key (beta agent) so this run does not interfere
  // with the alpha-agent tests that assert run count and lastRunDate.
  const transcriptRun: Run = {
    identityKey: JSON.stringify(['user', source.root, 'beta']),
    runId: TRANSCRIPT_RUN_ID,
    agentName: 'beta',
    cwd: agentsHome,
    sessionId: 'session-transcript-1',
    sidechainPath: SIDECHAIN_FIXTURE_PATH,
    timestamp: '2025-04-01T10:00:00.000Z',
    status: 'completed',
    totalDurationMs: 2000,
    totalTokens: 600,
    totalToolUseCount: 1,
    toolStats: { bashCount: 1 },
    definitionSnapshot: agentDefinition,
    tags: [],
    source: 'transcript',
  };
  new RunStore(storePath).upsert(transcriptRun);

  // Create a minimal SPA assets directory (the server needs index.html to exist).
  const assetsDir = join(tmpDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, 'index.html'), '<html><body>GUI</body></html>', 'utf8');

  const ctx: CliContext = {
    out: () => {},
    readStdin: async () => '',
    runEditor: () => 0,
    registryPath,
    projectsRoot,
    storePath,
    scoreStorePath,
    noteStorePath,
    tierBStorePath,
    tierCStorePath,
    conventionsPath,
    anchorStorePath: undefined,
  };

  serverHandle = await startGuiServer(0, assetsDir, ctx);
  serverUrl = serverHandle.url;
});

afterAll(async () => {
  await serverHandle.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GUI server integration — GET /api/agents', () => {
  it('returns HTTP 200 with application/json content-type', async () => {
    const res = await fetch(`${serverUrl}/api/agents`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('returns a JSON array', async () => {
    const res = await fetch(`${serverUrl}/api/agents`);
    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains the seeded alpha agent', async () => {
    const res = await fetch(`${serverUrl}/api/agents`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const alpha = body.find((e) => e['name'] === 'alpha');
    expect(alpha).toBeDefined();
  });

  it('each entry has the required AgentListEntry fields', async () => {
    const res = await fetch(`${serverUrl}/api/agents`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(1);
    for (const entry of body) {
      expect(typeof entry['name']).toBe('string');
      expect(typeof entry['sourceType']).toBe('string');
      expect(typeof entry['sourcePath']).toBe('string');
      expect(typeof entry['identityKey']).toBe('string');
      // lastRunDate is string or null
      expect(entry['lastRunDate'] === null || typeof entry['lastRunDate'] === 'string').toBe(true);
    }
  });

  it('alpha entry has a lastRunDate from the most recent run', async () => {
    const res = await fetch(`${serverUrl}/api/agents`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const alpha = body.find((e) => e['name'] === 'alpha');
    expect(alpha).toBeDefined();
    // The second run (2025-03-10) is the most recent.
    expect(alpha!['lastRunDate']).toContain('2025-03-10');
  });
});

describe('GUI server integration — GET /api/agents/:identityKey', () => {
  it('returns HTTP 200 for a known agent identity key', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('returns a detail object with correct name and identityKey', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['name']).toBe('alpha');
    expect(body['identityKey']).toBe(alphaIdentityKey);
  });

  it('detail object has a runs array with both seeded runs', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`);
    const body = (await res.json()) as { runs: unknown[] };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs).toHaveLength(2);
  });

  it('each run in the detail has expected fields', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`);
    const body = (await res.json()) as {
      runs: Array<Record<string, unknown>>;
    };
    for (const run of body.runs) {
      expect(typeof run['runId']).toBe('string');
      expect(run['status']).toBe('completed');
      expect(typeof run['timestamp']).toBe('string');
      expect(typeof run['totalDurationMs']).toBe('number');
      expect(typeof run['totalTokens']).toBe('number');
      expect(typeof run['totalToolUseCount']).toBe('number');
      // tierA, tierB, tierC are present as keys (may be null)
      expect('tierA' in run).toBe(true);
      expect('tierB' in run).toBe(true);
      expect('tierC' in run).toBe(true);
    }
  });

  it('Tier C is null (not opt-in judged)', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`);
    const body = (await res.json()) as {
      runs: Array<{ tierC: unknown }>;
    };
    // With no judge invocation, tierC is null for all runs.
    for (const run of body.runs) {
      expect(run.tierC).toBeNull();
    }
  });

  it('note is null when no note has been set', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`);
    const body = (await res.json()) as { note: unknown };
    expect(body.note).toBeNull();
  });

  it('returns 404 for an unknown identity key', async () => {
    const unknown = encodeURIComponent(JSON.stringify(['user', '/no/such/path', 'ghost']));
    const res = await fetch(`${serverUrl}/api/agents/${unknown}`);
    expect(res.status).toBe(404);
  });
});

describe('GUI server integration — method rejection', () => {
  it('POST /api/agents returns 405', async () => {
    const res = await fetch(`${serverUrl}/api/agents`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('PUT /api/agents/:id returns 405', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  it('DELETE /api/agents/:id returns 405', async () => {
    const encoded = encodeURIComponent(alphaIdentityKey);
    const res = await fetch(`${serverUrl}/api/agents/${encoded}`, { method: 'DELETE' });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Unit-level checks (no server) — Reqs 45, 46, 47
// ---------------------------------------------------------------------------

test('readTranscript over fixture returns correct taskPrompt (Req 45, 46)', () => {
  const result = readTranscript(SIDECHAIN_FIXTURE_PATH);
  expect(result.taskPrompt).toBe('Implement the new feature as described in the spec.');
});

test('readTranscript over fixture returns 1 turn with 1 tool call (Req 45)', () => {
  const result = readTranscript(SIDECHAIN_FIXTURE_PATH);
  expect(result.turns).toHaveLength(1);
  expect(result.turns[0]?.toolCalls).toHaveLength(1);
  expect(result.turns[0]?.toolCalls[0]?.name).toBe('Bash');
});

test('readTranscript fixture tool result is truncated (Req 47)', () => {
  const result = readTranscript(SIDECHAIN_FIXTURE_PATH);
  const toolCall = result.turns[0]?.toolCalls[0];
  expect(toolCall?.result?.truncated).toBe(true);
});

test('readTranscript fixture stop reason is end_turn (Req 45)', () => {
  const result = readTranscript(SIDECHAIN_FIXTURE_PATH);
  expect(result.stopReason).toBe('end_turn');
});

test('getRunTranscript returns same RunTranscript as readTranscript (Req 45, 46)', () => {
  const run: Run = {
    identityKey: JSON.stringify(['user', '/test/path', 'alpha']),
    runId: 'unit-test-run-1',
    agentName: 'alpha',
    cwd: '/test',
    sessionId: 'session-unit-1',
    sidechainPath: SIDECHAIN_FIXTURE_PATH,
    timestamp: '2025-04-01T10:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 300,
    totalToolUseCount: 1,
    toolStats: {},
    definitionSnapshot: 'description: alpha',
    tags: [],
  };
  const result = getRunTranscript(run.runId, [run]);
  expect(result).not.toBeNull();
  expect(result?.taskPrompt).toBe('Implement the new feature as described in the spec.');
  expect(result?.turns).toHaveLength(1);
  expect(result?.turns[0]?.toolCalls[0]?.name).toBe('Bash');
  expect(result?.turns[0]?.toolCalls[0]?.result?.truncated).toBe(true);
});

// ---------------------------------------------------------------------------
// Server endpoint tests — GET /api/runs/:runId/transcript (Req 53)
// ---------------------------------------------------------------------------

describe('GUI server integration — GET /api/runs/:runId/transcript', () => {
  it('returns HTTP 200 with correct shape for a known run (Reqs 45, 47, 53)', async () => {
    const res = await fetch(`${serverUrl}/api/runs/${TRANSCRIPT_RUN_ID}/transcript`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = (await res.json()) as {
      taskPrompt: unknown;
      turns: Array<{
        toolCalls: Array<{
          name: string;
          result: { truncated: boolean } | null | undefined;
        }>;
      }>;
      stopReason: unknown;
    };

    // Req 45: correct shape
    expect(body.taskPrompt).toBe('Implement the new feature as described in the spec.');
    expect(Array.isArray(body.turns)).toBe(true);
    expect(body.turns).toHaveLength(1);
    expect(body.turns[0]?.toolCalls).toHaveLength(1);
    expect(body.turns[0]?.toolCalls[0]?.name).toBe('Bash');
    expect(body.stopReason).toBe('end_turn');

    // Req 47: truncation
    expect(body.turns[0]?.toolCalls[0]?.result?.truncated).toBe(true);
  });

  it('returns HTTP 404 for an unknown run ID (Req 53)', async () => {
    const res = await fetch(`${serverUrl}/api/runs/unknown-run-id/transcript`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Run not found.');
  });

  it('returns HTTP 405 for POST (Req 53)', async () => {
    const res = await fetch(`${serverUrl}/api/runs/${TRANSCRIPT_RUN_ID}/transcript`, {
      method: 'POST',
    });
    expect(res.status).toBe(405);
  });
});
