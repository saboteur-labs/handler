/**
 * Reader for the Claude Code runlog directory (FR-25, FR-26, FR-27, FR-31).
 *
 * `readRunlogStops(root)` scans `<root>/repos/*\/*.jsonl` (the `sessions/`
 * pointer files are not read, and there is no repo filter), unwraps the
 * `.payload` of `SubagentStop` envelopes through `parseHookPayload`, ignores
 * every other event, and deduplicates by `agent_id` with the latest stop
 * winning (by envelope `ts_ms`, falling back to file order).
 *
 * Files are only read, never written. The reader never throws: malformed
 * lines are counted, unreadable files and a missing root are treated as empty.
 * No identity or store logic lives here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type HookPayload, parseHookPayload } from '../hook/payload';

/** A deduplicated `SubagentStop`: the parsed payload plus its envelope time. */
export interface RunlogStop extends HookPayload {
  /** Envelope `ts` (ISO string); empty string if the envelope had none. */
  readonly ts: string;
  /** Envelope `ts_ms`; `undefined` when absent or not a finite number. */
  readonly tsMs: number | undefined;
}

export interface RunlogReadResult {
  /** One stop per `agent_id` (latest wins), in first-seen order. */
  readonly stops: RunlogStop[];
  /** `SubagentStop` envelopes skipped because `agent_type` was empty. */
  readonly skippedEmptyAgentType: number;
  /** Non-blank lines skipped as unparseable or not a usable envelope/payload. */
  readonly skippedMalformed: number;
}

/** `~/.claude/runlogs`. Computed only; nothing is read from it here. */
export function defaultRunlogsRoot(): string {
  return join(homedir(), '.claude', 'runlogs');
}

/** Read and deduplicate `SubagentStop` envelopes under a runlogs directory. */
export function readRunlogStops(root: string = defaultRunlogsRoot()): RunlogReadResult {
  const latest = new Map<string, RunlogStop>();
  let skippedEmptyAgentType = 0;
  let skippedMalformed = 0;

  for (const file of listRunlogFiles(root)) {
    for (const line of readLines(file)) {
      const outcome = parseLine(line);
      if (outcome === 'ignored') continue;
      if (outcome === 'malformed') {
        skippedMalformed++;
      } else if (outcome.agentType === '') {
        skippedEmptyAgentType++;
      } else {
        const previous = latest.get(outcome.agentId);
        if (previous === undefined || !isOlder(outcome, previous)) {
          // Re-set keeps the original Map position (first-seen order).
          latest.set(outcome.agentId, outcome);
        }
      }
    }
  }
  return { stops: [...latest.values()], skippedEmptyAgentType, skippedMalformed };
}

/** True when `candidate` is strictly older than `current` (both timed). */
function isOlder(candidate: RunlogStop, current: RunlogStop): boolean {
  return (
    candidate.tsMs !== undefined && current.tsMs !== undefined && candidate.tsMs < current.tsMs
  );
}

function parseLine(line: string): RunlogStop | 'ignored' | 'malformed' {
  if (line.trim() === '') return 'ignored';
  let envelope: unknown;
  try {
    envelope = JSON.parse(line);
  } catch {
    return 'malformed';
  }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    return 'malformed';
  }
  const record = envelope as Record<string, unknown>;
  if (record.event !== 'SubagentStop') return 'ignored';
  const payload = parseHookPayload(record.payload);
  if (payload === null) return 'malformed';
  return {
    ...payload,
    ts: typeof record.ts === 'string' ? record.ts : '',
    tsMs:
      typeof record.ts_ms === 'number' && Number.isFinite(record.ts_ms) ? record.ts_ms : undefined,
  };
}

/** `<root>/repos/<repo>/*.jsonl`, sorted for a deterministic file order. */
function listRunlogFiles(root: string): string[] {
  const files: string[] = [];
  const reposDir = join(root, 'repos');
  for (const repo of safeReaddir(reposDir)) {
    const repoDir = join(reposDir, repo);
    for (const name of safeReaddir(repoDir)) {
      if (name.endsWith('.jsonl')) files.push(join(repoDir, name));
    }
  }
  return files;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function readLines(file: string): string[] {
  try {
    return readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }
}
