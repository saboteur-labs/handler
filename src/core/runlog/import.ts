/**
 * Runlog import (subagent-run-capture FR-16, FR-28, FR-29, FR-30, FR-31).
 *
 * Reads deduplicated `SubagentStop` stops from a runlogs directory, assembles
 * each through the shared `assembleCapturedRun` (builtin denylist, identity
 * rules, FR-3 metrics from `agent_transcript_path`) and writes it to the
 * `RunStore` with `source: 'runlog'`. Local-only: nothing leaves the machine.
 *
 * A runlog record never replaces an existing hook or transcript record
 * (`canOverwrite`), and re-importing identical input changes nothing.
 */
import { assembleCapturedRun } from '../capture-run';
import type { Run } from '../run';
import type { AgentSource } from '../sources/source';
import { canOverwrite } from '../store/precedence';
import { RunStore } from '../store/run-store';
import { type RunlogStop, readRunlogStops } from './reader';

export interface ImportRunlogOptions {
  /** Runlogs directory; defaults to `~/.claude/runlogs`. */
  readonly runlogsRoot?: string;
  /** Registered agent sources used for attribution. */
  readonly sources: readonly AgentSource[];
  /** Run-store location; defaults to `~/.handler/runs.json`. */
  readonly storePath?: string;
}

export interface ImportRunlogResult {
  /** Runs newly written or changed in the store. */
  readonly imported: number;
  /** Runs already stored with identical content, or protected by precedence. */
  readonly unchanged: number;
  /** Stops dropped silently: built-in/plugin agents or no matching source. */
  readonly dropped: number;
  /** Reader count: stops skipped because `agent_type` was empty. */
  readonly skippedEmptyAgentType: number;
  /** Reader count: lines skipped as unparseable or not a usable envelope. */
  readonly skippedMalformed: number;
}

/** Assemble one stop as a `runlog` run, or `null` when it is dropped. */
function assembleStop(stop: RunlogStop, sources: readonly AgentSource[]): Run | null {
  const run = assembleCapturedRun(
    {
      agentId: stop.agentId,
      agentType: stop.agentType,
      sidechainPath: stop.agentTranscriptPath ?? '',
      fallback: {
        cwd: stop.cwd,
        sessionId: stop.sessionId,
        timestamp: stop.ts === '' ? undefined : stop.ts,
      },
    },
    sources,
  );
  if (run === null) return null;
  return { ...run, sidechainPath: stop.agentTranscriptPath, source: 'runlog' };
}

/** Import runlog stops into the run store. Never throws. */
export function importRunlog(options: ImportRunlogOptions): ImportRunlogResult {
  const read = readRunlogStops(options.runlogsRoot);
  let imported = 0;
  let unchanged = 0;
  let dropped = 0;
  let store: RunStore | undefined;

  for (const stop of read.stops) {
    try {
      const run = assembleStop(stop, options.sources);
      if (run === null) {
        dropped++;
        continue;
      }
      store ??= new RunStore(options.storePath);
      const existing = store.forRun(run.identityKey, run.runId);
      if (
        !canOverwrite(existing?.source, 'runlog') ||
        (existing !== undefined && JSON.stringify(existing) === JSON.stringify(run))
      ) {
        unchanged++;
        continue;
      }
      store.upsert(run);
      imported++;
    } catch {
      // A single bad stop or store error must not abort the import.
      dropped++;
    }
  }

  return {
    imported,
    unchanged,
    dropped,
    skippedEmptyAgentType: read.skippedEmptyAgentType,
    skippedMalformed: read.skippedMalformed,
  };
}
