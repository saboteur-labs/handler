/**
 * Local-store reset.
 *
 * handler's state is a set of small JSON files under `~/.handler/` (see the
 * store modules). Some are a *cache* — `runs.json` is re-derived from Claude
 * Code's transcripts on every read, and the score annotations are recomputed
 * from those runs — while the rest are *authored*: notes you wrote, sources you
 * registered, judge annotations you paid for. A rubric or scoring change makes
 * the first group stale without touching the second, so reset is scoped rather
 * than all-or-nothing.
 *
 * Planning and execution are split so a caller can show the user exactly which
 * files will go before anything is deleted, and so the CLI's confirmation
 * prompt describes the real plan instead of a guess.
 */
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { defaultUserConfigPath } from './assess/config-store';
import { defaultConventionsPath } from './conventions/conventions-store';
import { defaultRegistryPath } from './sources/registry';
import { defaultAnchorsPath } from './store/anchor-store';
import { defaultNotePath } from './store/note-store';
import { defaultRunStorePath } from './store/run-store';
import { defaultScoreStorePath } from './store/score-store';
import { defaultTierBStorePath } from './store/tier-b-store';
import { defaultTierCStorePath } from './store/tier-c-store';

/** Identifiers for the stores reset can remove. */
export type ResetTargetKey =
  | 'runs'
  | 'scores'
  | 'tierB'
  | 'tierC'
  | 'anchors'
  | 'notes'
  | 'sources'
  | 'conventions'
  | 'config';

/**
 * How much to clear.
 *
 * - `scores` — the recomputable score annotations, keeping attributed history.
 *   The reset for "the rubric changed, re-baseline everything".
 * - `derived` — the above plus the run cache, so the next read re-ingests from
 *   transcripts. Nothing authored is touched.
 * - `all` — every store, including authored notes, sources, and paid-for judge
 *   annotations. A true fresh install.
 */
export type ResetScope = 'scores' | 'derived' | 'all';

/** All scopes, narrowest first. */
export const RESET_SCOPES = ['scores', 'derived', 'all'] as const;

/** Store paths, each defaulting to that store's own default location. */
export type ResetPaths = Partial<Record<ResetTargetKey, string>>;

/** One store considered by a reset, resolved against the filesystem. */
export interface ResetTarget {
  readonly key: ResetTargetKey;
  readonly path: string;
  /** Human-readable description of what is lost, for the confirmation prompt. */
  readonly label: string;
  /**
   * Whether the store rebuilds itself for free. Derived stores are regenerated
   * from transcripts on the next read; the rest can only be recreated by hand
   * (or, for Tier C, by paying for another judge run).
   */
  readonly derived: boolean;
  readonly exists: boolean;
  /** Size on disk in bytes, or 0 when absent. */
  readonly sizeBytes: number;
}

export interface ResetPlan {
  readonly scope: ResetScope;
  readonly targets: readonly ResetTarget[];
}

export interface PlanResetOptions {
  readonly scope: ResetScope;
  readonly paths?: ResetPaths;
}

export interface ExecuteResetOptions {
  /** Copy every deleted file here first. Created if absent. */
  readonly backupDir?: string;
}

export interface ResetOutcome {
  /** Targets removed, by key. */
  readonly deleted: readonly ResetTargetKey[];
  /** Targets that were already absent. */
  readonly skipped: readonly ResetTargetKey[];
  /** Targets copied to the backup directory, by key. Empty without `backupDir`. */
  readonly backedUp: readonly ResetTargetKey[];
  /** Where backups were written, when a backup directory was given. */
  readonly backupDir?: string;
}

interface TargetSpec {
  readonly key: ResetTargetKey;
  readonly label: string;
  readonly derived: boolean;
  readonly defaultPath: () => string;
  /** Narrowest scope that includes this target. */
  readonly scope: ResetScope;
}

/**
 * Every store, tagged with the narrowest scope that clears it. Scopes nest, so
 * a target belongs to its own scope and every wider one.
 */
const SPECS: readonly TargetSpec[] = [
  {
    key: 'scores',
    label: 'Tier A deterministic scores',
    derived: true,
    defaultPath: defaultScoreStorePath,
    scope: 'scores',
  },
  {
    key: 'tierB',
    label: 'Tier B reference-relative signals',
    derived: true,
    defaultPath: defaultTierBStorePath,
    scope: 'scores',
  },
  {
    key: 'runs',
    label: 'attributed run history (re-ingested from transcripts)',
    derived: true,
    defaultPath: defaultRunStorePath,
    scope: 'derived',
  },
  {
    key: 'tierC',
    label: 'Tier C judge annotations (re-running them costs money)',
    derived: false,
    defaultPath: defaultTierCStorePath,
    scope: 'all',
  },
  {
    key: 'anchors',
    label: 'Tier C calibration anchors',
    derived: false,
    defaultPath: defaultAnchorsPath,
    scope: 'all',
  },
  {
    key: 'notes',
    label: 'per-agent notes',
    derived: false,
    defaultPath: defaultNotePath,
    scope: 'all',
  },
  {
    key: 'sources',
    label: 'registered agent sources',
    derived: false,
    defaultPath: defaultRegistryPath,
    scope: 'all',
  },
  {
    key: 'conventions',
    label: 'synced conventions artifact (re-syncable offline defaults ship inline)',
    derived: false,
    defaultPath: defaultConventionsPath,
    scope: 'all',
  },
  {
    key: 'config',
    label: 'user-level check suppressions',
    derived: false,
    defaultPath: defaultUserConfigPath,
    scope: 'all',
  },
];

const SCOPE_RANK: Record<ResetScope, number> = { scores: 0, derived: 1, all: 2 };

/**
 * Resolve which stores `scope` clears and whether each is present. Pure with
 * respect to handler's state: it stats files but changes nothing.
 */
export function planReset(options: PlanResetOptions): ResetPlan {
  const { scope, paths = {} } = options;
  const targets = SPECS.filter((spec) => SCOPE_RANK[spec.scope] <= SCOPE_RANK[scope]).map(
    (spec) => {
      const path = paths[spec.key] ?? spec.defaultPath();
      const sizeBytes = fileSize(path);
      return {
        key: spec.key,
        path,
        label: spec.label,
        derived: spec.derived,
        exists: sizeBytes !== undefined,
        sizeBytes: sizeBytes ?? 0,
      };
    },
  );
  return { scope, targets };
}

/**
 * Delete every existing target in `plan`. When `backupDir` is given, all copies
 * are made before the first deletion, so a failed backup leaves the originals
 * intact rather than half the state gone.
 */
export function executeReset(plan: ResetPlan, options: ExecuteResetOptions = {}): ResetOutcome {
  const { backupDir } = options;
  const present = plan.targets.filter((target) => target.exists);
  const skipped = plan.targets.filter((target) => !target.exists).map((target) => target.key);

  const backedUp: ResetTargetKey[] = [];
  if (backupDir !== undefined && present.length > 0) {
    mkdirSync(backupDir, { recursive: true });
    for (const target of present) {
      copyFileSync(target.path, join(backupDir, basename(target.path)));
      backedUp.push(target.key);
    }
  }

  const deleted: ResetTargetKey[] = [];
  for (const target of present) {
    rmSync(target.path, { force: true });
    deleted.push(target.key);
  }

  return { deleted, skipped, backedUp, ...(backupDir === undefined ? {} : { backupDir }) };
}

/** Size of `path` in bytes, or `undefined` when it is absent or not a file. */
function fileSize(path: string): number | undefined {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}
