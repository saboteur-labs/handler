/**
 * Run-source precedence (subagent-run-capture FR-22).
 *
 * Runs can be written by three paths: transcript ingest (authoritative), the
 * SubagentStop hook, and an imported runlog. Precedence is
 * transcript > hook > runlog: a lower-ranked source never replaces a
 * higher-ranked record.
 */
import type { Run } from '../run';

/** How a run record was written. */
export type RunSource = NonNullable<Run['source']>;

const RANK: Readonly<Record<RunSource, number>> = {
  runlog: 0,
  hook: 1,
  transcript: 2,
};

/**
 * Whether a record from `incomingSource` may replace an existing record whose
 * source is `existingSource`. `undefined` means there is no existing record or
 * a legacy record written before `source` existed; both are upgradable by any
 * source. Equal ranks may overwrite (a source can refresh its own record).
 */
export function canOverwrite(
  existingSource: RunSource | undefined,
  incomingSource: RunSource,
): boolean {
  if (existingSource === undefined) return true;
  return RANK[incomingSource] >= RANK[existingSource];
}
