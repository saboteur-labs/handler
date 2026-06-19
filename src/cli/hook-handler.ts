#!/usr/bin/env node
/**
 * `handler-hook` binary — thin entrypoint for Claude Code's SubagentStop hook.
 *
 * Reads JSON from stdin, calls `handleSubagentStop` with sources loaded from
 * the registered source registry and a RunStore, logs one line to stderr
 * describing the outcome, and ALWAYS exits 0 regardless of any error.
 *
 * stderr format:
 *   captured: <agentId>
 *   skipped:  <agentId>
 *   malformed: unknown
 *   error: <message>
 *
 * No stdout output is produced (Claude Code may capture it).
 */

import { handleSubagentStop, SourceRegistry } from '../core/index';
import { RunStore, defaultRunStorePath } from '../core/store/run-store';
import { defaultRegistryPath } from '../core/sources/registry';

/** Parse a raw stdin string as JSON; returns null on any parse failure. */
export function parseJsonInput(raw: string): unknown {
  if (raw.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const registryPath = process.env.HANDLER_REGISTRY ?? defaultRegistryPath();
  const storePath = process.env.HANDLER_STORE ?? defaultRunStorePath();

  const stdinText = await readStdin();
  const parsed = parseJsonInput(stdinText);

  const registry = new SourceRegistry(registryPath);
  const sources = registry.list();
  const store = new RunStore(storePath);

  const result = handleSubagentStop(parsed, sources, store);

  // Extract agentId from the parsed payload when available; fall back to 'unknown'
  let agentId = 'unknown';
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'agentId' in parsed &&
    typeof (parsed as Record<string, unknown>).agentId === 'string'
  ) {
    agentId = (parsed as Record<string, unknown>).agentId as string;
  }

  const label = result === 'malformed' ? 'malformed' : result;
  const id = result === 'malformed' ? 'unknown' : agentId;
  process.stderr.write(`${label}: ${id}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  })
  .finally(() => {
    process.exit(0);
  });
