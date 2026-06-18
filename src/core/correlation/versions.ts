/**
 * Definition-version segmentation (feature-6 Req 4).
 *
 * Given the runs of a single agent identity, orders them by timestamp and
 * groups contiguous runs that share the same definition-snapshot content into
 * versions, locating the change points between consecutive versions. The
 * snapshot is keyed by a content hash so identical definitions group regardless
 * of where they came from.
 *
 * An orphan run (no snapshot — `definitionSnapshot === null`) is an *unknown*
 * boundary: it never merges, not with a known version nor with another orphan,
 * so a real definition can never be assumed continuous across a run whose
 * definition we couldn't capture. Downstream correlation (Task 6) decides which
 * change points are usable (e.g. only known→known).
 */
import { createHash } from 'node:crypto';

import type { Run } from '../run';

export interface DefinitionVersion {
  /** Definition content shared by the version's runs, or `null` for an orphan. */
  readonly snapshot: string | null;
  /** Content hash of `snapshot`, or `null` for an orphan (never matches). */
  readonly snapshotHash: string | null;
  readonly runs: readonly Run[];
}

export interface ChangePoint {
  readonly before: DefinitionVersion;
  readonly after: DefinitionVersion;
}

export interface VersionSegmentation {
  readonly versions: readonly DefinitionVersion[];
  readonly changePoints: readonly ChangePoint[];
}

interface MutableVersion {
  readonly snapshot: string | null;
  readonly snapshotHash: string | null;
  readonly runs: Run[];
}

/** Segment one agent identity's runs into definition versions and change points. */
export function segmentByDefinition(runs: readonly Run[]): VersionSegmentation {
  const ordered = [...runs].sort(byTimestamp);
  const versions: MutableVersion[] = [];

  for (const run of ordered) {
    const snapshotHash = hashSnapshot(run.definitionSnapshot);
    const current = versions[versions.length - 1];
    // Merge only into a known version with the same hash; null never merges.
    if (current !== undefined && snapshotHash !== null && current.snapshotHash === snapshotHash) {
      current.runs.push(run);
    } else {
      versions.push({ snapshot: run.definitionSnapshot, snapshotHash, runs: [run] });
    }
  }

  const changePoints: ChangePoint[] = [];
  for (let i = 1; i < versions.length; i += 1) {
    changePoints.push({ before: versions[i - 1]!, after: versions[i]! });
  }

  return { versions, changePoints };
}

/** Order by ISO timestamp ascending; runs without a timestamp sort last. */
function byTimestamp(a: Run, b: Run): number {
  if (a.timestamp === b.timestamp) {
    return 0;
  }
  if (a.timestamp === undefined) {
    return 1;
  }
  if (b.timestamp === undefined) {
    return -1;
  }
  return a.timestamp < b.timestamp ? -1 : 1;
}

/** SHA-256 hex of the snapshot content, or `null` for an orphan run. */
function hashSnapshot(snapshot: string | null): string | null {
  return snapshot === null ? null : createHash('sha256').update(snapshot).digest('hex');
}
