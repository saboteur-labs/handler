/**
 * Tests for startGuiServer (HTTP transport layer).
 *
 * Each test starts a real server bound to 127.0.0.1 on a random port and
 * makes real HTTP requests via Node's built-in fetch. Stores are mocked so
 * no real filesystem I/O is required.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Run } from '../run';
import type { CliContext } from '../../cli/commands/source';
import { startGuiServer } from './server';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_KEY = JSON.stringify(['user', '/home/user/.claude/agents', 'alpha']);
const REPO_KEY = JSON.stringify(['repo', '/repo/.claude/agents', 'beta']);

function makeRun(overrides: Partial<Run> & { identityKey: string; runId: string }): Run {
  return {
    agentName: 'alpha',
    cwd: '/home/user',
    sessionId: 'session-1',
    sidechainPath: undefined,
    timestamp: '2024-01-01T00:00:00.000Z',
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 500,
    totalToolUseCount: 3,
    toolStats: {},
    definitionSnapshot: '---\ndescription: A test agent\ntools: []\n---\nDo stuff.',
    tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal CliContext whose store paths point nowhere real.
 * The server constructs store instances from these paths; the stores will
 * just read empty JSON from nonexistent files (that is the designed
 * degradation path).
 */
function makeCtx(overrides?: Partial<CliContext>): CliContext {
  return {
    out: vi.fn(),
    readStdin: vi.fn(async () => ''),
    runEditor: vi.fn(() => 0),
    registryPath: undefined,
    projectsRoot: undefined,
    storePath: undefined,
    scoreStorePath: undefined,
    conventionsPath: undefined,
    noteStorePath: undefined,
    tierBStorePath: undefined,
    anchorStorePath: undefined,
    tierCStorePath: undefined,
    ...overrides,
  };
}

// Mock `ingest` to return controlled runs without touching real disk.
vi.mock('../ingest', () => ({
  ingest: vi.fn(() => [] as Run[]),
}));

// We'll import the mock after vi.mock so we can control return values per test.
import { ingest } from '../ingest';
const mockIngest = vi.mocked(ingest);

// ---------------------------------------------------------------------------
// Temp assets directory
// ---------------------------------------------------------------------------

let assetsDir: string;

beforeEach(() => {
  assetsDir = mkdtempSync(join(tmpdir(), 'handler-gui-test-'));
  writeFileSync(join(assetsDir, 'index.html'), '<html><body>SPA</body></html>');
  writeFileSync(join(assetsDir, 'app.js'), 'console.log("app");');
  // Reset mock before each test
  mockIngest.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Server lifecycle helper
// ---------------------------------------------------------------------------

interface ServerHandle {
  url: string;
  close(): Promise<void>;
}

let server: ServerHandle | undefined;

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startGuiServer', () => {
  describe('lifecycle', () => {
    it('returns a url and a close function', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(typeof server.close).toBe('function');
    });

    it('close() shuts down the server (subsequent requests fail)', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const { url } = server;
      await server.close();
      server = undefined;

      await expect(fetch(`${url}/api/agents`)).rejects.toThrow();
    });
  });

  describe('GET /api/agents', () => {
    it('returns 200 with an empty array when there are no runs', async () => {
      mockIngest.mockReturnValue([]);
      server = await startGuiServer(0, assetsDir, makeCtx());

      const res = await fetch(`${server.url}/api/agents`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns 200 with listAgents result when runs exist', async () => {
      mockIngest.mockReturnValue([
        makeRun({ identityKey: USER_KEY, runId: 'run-1', agentName: 'alpha' }),
        makeRun({ identityKey: REPO_KEY, runId: 'run-2', agentName: 'beta' }),
      ]);
      server = await startGuiServer(0, assetsDir, makeCtx());

      const res = await fetch(`${server.url}/api/agents`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string; identityKey: string }>;
      expect(body).toHaveLength(2);
      const names = body.map((e) => e.name).sort();
      expect(names).toEqual(['alpha', 'beta']);
      expect(body[0]).toHaveProperty('identityKey');
      expect(body[0]).toHaveProperty('lastRunDate');
    });
  });

  describe('GET /api/agents/:identityKey', () => {
    it('returns 200 with agent detail for a known agent', async () => {
      mockIngest.mockReturnValue([
        makeRun({ identityKey: USER_KEY, runId: 'run-1', agentName: 'alpha' }),
      ]);
      server = await startGuiServer(0, assetsDir, makeCtx());

      const encoded = encodeURIComponent(USER_KEY);
      const res = await fetch(`${server.url}/api/agents/${encoded}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; identityKey: string; runs: unknown[] };
      expect(body.name).toBe('alpha');
      expect(body.identityKey).toBe(USER_KEY);
      expect(Array.isArray(body.runs)).toBe(true);
    });

    it('returns 404 for an unknown identity key', async () => {
      mockIngest.mockReturnValue([]);
      server = await startGuiServer(0, assetsDir, makeCtx());

      const unknown = encodeURIComponent(JSON.stringify(['user', '/none', 'ghost']));
      const res = await fetch(`${server.url}/api/agents/${unknown}`);
      expect(res.status).toBe(404);
    });

    it('URL-decodes the identity key before lookup', async () => {
      mockIngest.mockReturnValue([
        makeRun({ identityKey: USER_KEY, runId: 'run-1', agentName: 'alpha' }),
      ]);
      server = await startGuiServer(0, assetsDir, makeCtx());

      // USER_KEY contains brackets and quotes — must be percent-encoded.
      const encoded = encodeURIComponent(USER_KEY);
      const res = await fetch(`${server.url}/api/agents/${encoded}`);
      expect(res.status).toBe(200);
    });
  });

  describe('mutation verbs', () => {
    it('returns 405 for POST /api/agents', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/api/agents`, { method: 'POST' });
      expect(res.status).toBe(405);
    });

    it('returns 405 for PUT /api/agents/:id', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/api/agents/somekey`, { method: 'PUT' });
      expect(res.status).toBe(405);
    });

    it('returns 405 for DELETE /api/agents/:id', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/api/agents/somekey`, { method: 'DELETE' });
      expect(res.status).toBe(405);
    });
  });

  describe('GET /api/runs/:runId/transcript', () => {
    it('returns 200 with RunTranscript JSON for a known run with sidechain (Req 53)', async () => {
      const mockTranscript = {
        taskPrompt: 'Do something useful',
        turns: [{ textBlocks: ['I will help.'], toolCalls: [] }],
        stopReason: 'end_turn',
      };
      mockIngest.mockReturnValue([
        makeRun({
          identityKey: USER_KEY,
          runId: 'run-transcript-1',
          agentName: 'alpha',
          sidechainPath: '/fake/sidechain.jsonl',
          status: 'completed',
        }),
      ]);

      // Mock getRunTranscript to return a transcript without hitting disk.
      const transcriptMod = await import('./transcript');
      vi.spyOn(transcriptMod, 'getRunTranscript').mockReturnValue(
        mockTranscript as unknown as Awaited<ReturnType<typeof transcriptMod.getRunTranscript>>,
      );

      server = await startGuiServer(0, assetsDir, makeCtx());

      const res = await fetch(`${server.url}/api/runs/run-transcript-1/transcript`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const body = (await res.json()) as {
        taskPrompt: string;
        turns: unknown[];
        stopReason: string;
      };
      expect(body.taskPrompt).toBe('Do something useful');
      expect(Array.isArray(body.turns)).toBe(true);
      expect(body.stopReason).toBe('end_turn');

      vi.restoreAllMocks();
    });

    it('returns 404 with "Run not found." for an unknown runId (Req 53)', async () => {
      mockIngest.mockReturnValue([]);
      server = await startGuiServer(0, assetsDir, makeCtx());

      const res = await fetch(`${server.url}/api/runs/nonexistent-run/transcript`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Run not found.');
    });

    it('returns 404 with "Transcript not available for this run." when run exists but sidechain is unavailable (Req 53)', async () => {
      mockIngest.mockReturnValue([
        makeRun({
          identityKey: USER_KEY,
          runId: 'run-incomplete-1',
          agentName: 'alpha',
          sidechainPath: undefined,
          status: 'incomplete' as Run['status'],
          tags: ['incomplete'],
        }),
      ]);
      server = await startGuiServer(0, assetsDir, makeCtx());

      const res = await fetch(`${server.url}/api/runs/run-incomplete-1/transcript`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Transcript not available for this run.');
    });

    it('returns 405 for POST /api/runs/:runId/transcript (Req 53)', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/api/runs/run-1/transcript`, { method: 'POST' });
      expect(res.status).toBe(405);
    });
  });

  describe('unknown /api/* routes', () => {
    it('returns 404 for unknown API routes', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/api/unknown-route`);
      expect(res.status).toBe(404);
    });
  });

  describe('static assets / SPA fallback', () => {
    it('serves app.js as a static file', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/app.js`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('console.log');
    });

    it('falls back to index.html for unrecognized non-api paths', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/some/nested/route`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('SPA');
    });

    it('serves index.html for the root path', async () => {
      server = await startGuiServer(0, assetsDir, makeCtx());
      const res = await fetch(`${server.url}/`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('SPA');
    });
  });
});
