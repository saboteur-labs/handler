/**
 * GUI HTTP server (thin transport layer).
 *
 * Starts a localhost-only HTTP server that:
 * - Serves the built SPA from `assetsDir` as static files with SPA fallback.
 * - Exposes a read-only JSON API that delegates entirely to the Task 1 core
 *   functions (`listAgents`, `getAgentDetail`). No business logic lives here.
 *
 * Binds only to 127.0.0.1, never 0.0.0.0.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

import type { CliContext } from '../../cli/commands/source';
import { ingest, NoteStore, ScoreStore, SourceRegistry, TierBStore, TierCStore } from '../index';
import { loadConventionsWithDefault } from '../conventions/conventions-store';
import { getAgentDetail, getRunTranscript, listAgents } from './index';

// ---------------------------------------------------------------------------
// MIME type lookup (covers the assets a typical SPA build produces)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function mimeFor(filepath: string): string {
  return MIME[extname(filepath).toLowerCase()] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendStatus(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { error: message });
}

// ---------------------------------------------------------------------------
// Static-asset serving with SPA fallback
// ---------------------------------------------------------------------------

function serveStatic(res: ServerResponse, assetsDir: string, urlPath: string): void {
  const normalizedPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const filePath = join(assetsDir, normalizedPath);

  if (existsSync(filePath)) {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
    res.end(content);
    return;
  }

  // SPA fallback: serve index.html for any unrecognized path.
  const indexPath = join(assetsDir, 'index.html');
  if (existsSync(indexPath)) {
    const content = readFileSync(indexPath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
    return;
  }

  sendStatus(res, 404, 'Not Found');
}

// ---------------------------------------------------------------------------
// API route handlers
// ---------------------------------------------------------------------------

/** Pattern: /api/agents or /api/agents/<identityKey> */
const API_AGENTS_BASE = '/api/agents';

function handleApiRequest(req: IncomingMessage, res: ServerResponse, ctx: CliContext): void {
  const method = req.method ?? 'GET';

  // Reject mutation verbs on any route.
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    sendStatus(res, 405, 'Method Not Allowed');
    return;
  }

  const urlPath = req.url ?? '/';
  // Strip query string.
  const pathname = urlPath.split('?')[0] ?? '/';

  if (!pathname.startsWith('/api/')) {
    // Should not reach here — caller routes non-api paths to serveStatic.
    sendStatus(res, 404, 'Not Found');
    return;
  }

  // Build the data layer (stores + runs) — all construction is cheap; the
  // real work is in ingest() and the core functions.
  const registry = new SourceRegistry(ctx.registryPath);
  const runs = ingest({
    sources: registry.list(),
    projectsRoot: ctx.projectsRoot,
    storePath: ctx.storePath,
  });

  const scoreStore = new ScoreStore(ctx.scoreStorePath);
  const tierBStore = new TierBStore(ctx.tierBStorePath);
  const tierCStore = new TierCStore(ctx.tierCStorePath);
  const noteStore = new NoteStore(ctx.noteStorePath);

  // GET /api/agents
  if (pathname === API_AGENTS_BASE || pathname === `${API_AGENTS_BASE}/`) {
    sendJson(res, 200, listAgents(runs));
    return;
  }

  // GET /api/agents/:identityKey
  if (pathname.startsWith(`${API_AGENTS_BASE}/`)) {
    const rawKey = pathname.slice(API_AGENTS_BASE.length + 1);
    const identityKey = decodeURIComponent(rawKey);

    const conventionsStore = loadConventionsWithDefault(ctx.conventionsPath);
    const detail = getAgentDetail(
      identityKey,
      runs,
      scoreStore,
      tierBStore,
      tierCStore,
      noteStore,
      conventionsStore,
    );

    if (detail === null) {
      sendStatus(res, 404, `No agent found for key: ${identityKey}`);
      return;
    }

    sendJson(res, 200, detail);
    return;
  }

  // GET /api/runs/:runId/transcript
  const transcriptMatch = pathname.match(/^\/api\/runs\/([^/]+)\/transcript$/);
  if (transcriptMatch !== null) {
    const runId = decodeURIComponent(transcriptMatch[1] ?? '');
    const runExists = runs.find((r) => r.runId === runId) !== undefined;
    if (!runExists) {
      sendStatus(res, 404, 'Run not found.');
      return;
    }
    const transcript = getRunTranscript(runId, runs);
    if (transcript === null) {
      sendStatus(res, 404, 'Transcript not available for this run.');
      return;
    }
    sendJson(res, 200, transcript);
    return;
  }

  // Unknown /api/* route.
  sendStatus(res, 404, 'Not Found');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GuiServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Start a localhost-only HTTP server.
 *
 * @param port - TCP port to bind; pass `0` to let the OS pick a free port.
 * @param assetsDir - Directory containing the built SPA assets.
 * @param ctx - CLI context providing store paths and configuration.
 * @returns A handle with the bound URL and a `close()` function.
 */
export function startGuiServer(
  port: number,
  assetsDir: string,
  ctx: CliContext,
): Promise<GuiServerHandle> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const urlPath = (req.url ?? '/').split('?')[0] ?? '/';

      if (urlPath.startsWith('/api/')) {
        handleApiRequest(req, res, ctx);
      } else {
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') {
          sendStatus(res, 405, 'Method Not Allowed');
          return;
        }
        serveStatic(res, assetsDir, urlPath);
      }
    });

    httpServer.once('error', reject);

    httpServer.listen(port, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('Unexpected server address format'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}`;

      resolve({
        url,
        close(): Promise<void> {
          return new Promise((res, rej) => {
            httpServer.close((err) => {
              if (err !== undefined && err !== null) {
                rej(err);
              } else {
                res();
              }
            });
          });
        },
      });
    });
  });
}
