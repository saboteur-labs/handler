/**
 * GUI core API — run transcript view (Req 53).
 *
 * `getRunTranscript` retrieves the structured transcript for a single run.
 * It guards against runs that are not found, have no locatable sidechain, or
 * are in a terminal non-readable state ('incomplete', 'orphan'). The GUI
 * always uses default truncation — no `--full` toggle is exposed.
 *
 * No rendering logic lives here; callers receive plain typed objects.
 */
import type { Run } from '../run';
import { readTranscript } from '../transcripts/transcript';
export type { RunTranscript } from '../transcripts/transcript';
import type { RunTranscript } from '../transcripts/transcript';

/**
 * Return the `RunTranscript` for the run identified by `runId`, or `null` when:
 * - the run is not present in `allRuns`,
 * - the run has no `sidechainPath`, or
 * - the run's status is `'incomplete'` or `'orphan'`.
 */
export function getRunTranscript(runId: string, allRuns: readonly Run[]): RunTranscript | null {
  const run = allRuns.find((r) => r.runId === runId);

  if (run === undefined) {
    return null;
  }

  if (run.sidechainPath === undefined) {
    return null;
  }

  if (run.status === 'incomplete' || run.status === 'orphan') {
    return null;
  }

  return readTranscript(run.sidechainPath);
}
