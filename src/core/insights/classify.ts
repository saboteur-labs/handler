/**
 * Roster classifier (V1 Feature 4, Tasks 2 & 3).
 *
 * Classifies each known agent as unused, failing, expensive, no-history, or healthy.
 * An agent may carry multiple categories (e.g. both unused and failing).
 * Zero-run agents land in the `noHistory` bucket and are never labeled.
 *
 * This function is read-only and mutates nothing. It resolves Tier A scores
 * from the pre-computed `scoresByRunId` map and Tier B annotations from the
 * pre-computed `tierBAnnotationsByIdentityKey` map — it never re-derives from
 * transcripts (Req 9).
 *
 * Rules (Task 2 scope):
 *  - Zero runs → `noHistory` bucket, never labeled unused/failing (Req 7).
 *  - No runs within recency window → `unused` (Req 2).
 *  - Tier A tool-utilization warns across ALL stored runs → `unused` (Req 2).
 *  - Any run has a Tier A failure in its breakdown → `failing` (Req 3).
 *  - Most-recent composite score below fail threshold → `failing` (Req 3).
 *  - An agent may carry both labels (Req 5).
 *  - An agent with runs and no triggered rules → `categories: []` (healthy).
 *
 * Rules (Task 3 scope):
 *  - Tier B outlier flag fires for tokens/duration/turns → `expensive` (Req 4).
 *  - When no Tier B annotations exist for an agent, `expensive` is OMITTED (Req 4).
 *  - Agents with fewer runs than `minRuns` have `lowConfidence: true` on
 *    `unused` and `expensive` assessments, but NEVER on `failing` (Req 6).
 */

import type { Run } from '../run';
import type { Score } from '../scoring/rubric';
import type { TierBAnnotation } from '../store/tier-b-store';
import { getInsightsFailScore, getInsightsRecencyDays, getMinRuns } from './config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Insight category label for an agent. */
export type InsightCategory = 'unused' | 'failing' | 'expensive' | 'no-history';

/** Minimal identity descriptor passed in via ClassifierInput. */
export interface AgentDescriptor {
  /** Serialized agent identity key (the `["type","path","name"]` triple). */
  readonly identityKey: string;
  readonly name: string;
}

/** A single agent's insight classification result. */
export interface AgentInsight {
  /** Serialized agent identity key. */
  readonly identityKey: string;
  readonly name: string;
  /**
   * Active insight categories. Empty means the agent is healthy.
   * Never contains `'no-history'` — zero-run agents are in `InsightsResult.noHistory`.
   */
  readonly categories: InsightCategory[];
  /** Reserved for Task 3 (confidence signal). Always `false` in Task 2. */
  readonly lowConfidence: boolean;
}

/** The full roster classification result. */
export interface InsightsResult {
  /** Agents that have at least one run. May be healthy (empty `categories`) or flagged. */
  readonly agents: AgentInsight[];
  /** Agents with zero stored runs. Never labeled unused, failing, or expensive. */
  readonly noHistory: AgentInsight[];
}

/** Data the classifier needs: the known agents, their runs, and pre-computed scores. */
export interface ClassifierInput {
  /** All known agents to classify. */
  readonly agents: readonly AgentDescriptor[];
  /** Runs keyed by `identityKey`. Absent key means zero runs for that agent. */
  readonly runsByIdentityKey: ReadonlyMap<string, readonly Run[]>;
  /** Pre-computed Tier A scores keyed by `runId`. Absent key means run is unscored. */
  readonly scoresByRunId: ReadonlyMap<string, Score>;
  /**
   * Pre-fetched Tier B annotations keyed by `identityKey`.
   * Absent key or absent map means no Tier B data for that agent; the
   * `expensive` category is OMITTED for that agent (Req 4).
   */
  readonly tierBAnnotationsByIdentityKey?: ReadonlyMap<string, readonly TierBAnnotation[]>;
}

/** Options that control classification thresholds. All have documented defaults. */
export interface ClassifierOptions {
  /** How many days back to look for recent activity. Default: `getInsightsRecencyDays()`. */
  readonly recencyDays?: number;
  /** Composite score below which the most-recent run is failing. Default: `getInsightsFailScore()`. */
  readonly failScoreThreshold?: number;
  /**
   * The current time in milliseconds since epoch.
   * Override in tests to pin `Date.now()`. Default: `Date.now()`.
   */
  readonly nowMs?: number;
  /**
   * Minimum run count for a confident assessment. Agents with fewer runs
   * than this have their `unused` and `expensive` results labeled
   * `lowConfidence: true`. Default: `getMinRuns()`.
   *
   * Note: `failing` is NEVER marked low-confidence — a Tier A failure is
   * definitive regardless of run count.
   */
  readonly minRuns?: number;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify every agent in `input` and return the partitioned result.
 *
 * @param input - Agents, their runs, and their pre-computed Tier A scores.
 * @param options - Threshold overrides (all optional; defaults come from config).
 * @returns Agents split into flagged/healthy (`agents`) and zero-run (`noHistory`).
 */
export function classifyRoster(
  input: ClassifierInput,
  options?: ClassifierOptions,
): InsightsResult {
  const recencyDays = options?.recencyDays ?? getInsightsRecencyDays();
  const failScoreThreshold = options?.failScoreThreshold ?? getInsightsFailScore();
  const nowMs = options?.nowMs ?? Date.now();
  const minRuns = options?.minRuns ?? getMinRuns();

  const cutoffMs = nowMs - recencyDays * 24 * 60 * 60 * 1000;

  const agents: AgentInsight[] = [];
  const noHistory: AgentInsight[] = [];

  for (const descriptor of input.agents) {
    const runs = input.runsByIdentityKey.get(descriptor.identityKey) ?? [];

    if (runs.length === 0) {
      noHistory.push({
        identityKey: descriptor.identityKey,
        name: descriptor.name,
        categories: [],
        lowConfidence: false,
      });
      continue;
    }

    const tierBAnnotations = input.tierBAnnotationsByIdentityKey?.get(descriptor.identityKey);
    const categories = classifyAgent(
      runs,
      input.scoresByRunId,
      cutoffMs,
      failScoreThreshold,
      tierBAnnotations,
    );

    const thinHistory = runs.length < minRuns;
    const lowConfidence = thinHistory && hasLowConfidenceCategory(categories);

    agents.push({
      identityKey: descriptor.identityKey,
      name: descriptor.name,
      categories,
      lowConfidence,
    });
  }

  return { agents, noHistory };
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

/**
 * Apply all classification rules to an agent that has at least one run.
 * Returns a deduplicated array of triggered categories (may be empty for healthy).
 *
 * Task 3 additions:
 *  - `expensive`: fired when any Tier B annotation has an `outlier` flag. Omitted
 *    entirely when `tierBAnnotations` is undefined (no Tier B data for this agent).
 */
function classifyAgent(
  runs: readonly Run[],
  scoresByRunId: ReadonlyMap<string, Score>,
  cutoffMs: number,
  failScoreThreshold: number,
  tierBAnnotations: readonly TierBAnnotation[] | undefined,
): InsightCategory[] {
  const categories = new Set<InsightCategory>();

  // --- Unused rules ---

  if (isUnusedByRecency(runs, cutoffMs)) {
    categories.add('unused');
  }

  if (isUnusedByToolUtilization(runs, scoresByRunId)) {
    categories.add('unused');
  }

  // --- Failing rules ---

  if (hasAnyTierAFailure(runs, scoresByRunId)) {
    categories.add('failing');
  }

  if (isMostRecentCompositeBelowThreshold(runs, scoresByRunId, failScoreThreshold)) {
    categories.add('failing');
  }

  // --- Expensive rules (only when Tier B data is present) ---
  // When tierBAnnotations is undefined, expensive is OMITTED entirely (Req 4).

  if (tierBAnnotations !== undefined && isExpensive(tierBAnnotations)) {
    categories.add('expensive');
  }

  return [...categories];
}

/**
 * Returns true when the agent should be marked low-confidence.
 * Low-confidence applies to `unused` and `expensive` only — never to `failing`.
 * So: true when categories includes 'unused' or 'expensive'.
 */
function hasLowConfidenceCategory(categories: InsightCategory[]): boolean {
  return categories.includes('unused') || categories.includes('expensive');
}

/**
 * Expensive rule: true when any Tier B annotation with status `'applicable'`
 * contains at least one flag with status `'outlier'`.
 *
 * When `annotations` is empty or all annotations have `insufficient-history`
 * status, returns false (not expensive — no applicable data to judge by).
 */
function isExpensive(annotations: readonly TierBAnnotation[]): boolean {
  return annotations.some(
    (annotation) =>
      annotation.result.status === 'applicable' &&
      annotation.result.flags !== undefined &&
      annotation.result.flags.some((flag) => flag.status === 'outlier'),
  );
}

/**
 * Unused rule 1: no run has a timestamp within the recency window.
 * Runs with undefined timestamps are treated as outside the window.
 */
function isUnusedByRecency(runs: readonly Run[], cutoffMs: number): boolean {
  return !runs.some((run) => {
    if (run.timestamp === undefined) {
      return false;
    }
    return new Date(run.timestamp).getTime() >= cutoffMs;
  });
}

/**
 * Unused rule 2: the Tier A `tool-utilization` check warns (granted-but-unused
 * tools) in ALL stored runs that have a score. If no scored runs exist, this
 * rule does not fire (cannot determine utilization without a score).
 */
function isUnusedByToolUtilization(
  runs: readonly Run[],
  scoresByRunId: ReadonlyMap<string, Score>,
): boolean {
  const scoredRuns = runs.filter((run) => scoresByRunId.has(run.runId));
  if (scoredRuns.length === 0) {
    return false;
  }
  return scoredRuns.every((run) => {
    const score = scoresByRunId.get(run.runId);
    if (score === undefined) {
      return false;
    }
    return hasToolUtilizationWarn(score);
  });
}

/** Returns true when the score's `tool-utilization` check has status `'warn'`. */
function hasToolUtilizationWarn(score: Score): boolean {
  return score.breakdown.some(
    (check) => check.id === 'tool-utilization' && check.status === 'warn',
  );
}

/**
 * Failing rule 1: any run's score contains at least one breakdown check with
 * status `'fail'`. This captures Tier A failures (tool-scope, path-boundary,
 * terminal failures, etc.).
 */
function hasAnyTierAFailure(
  runs: readonly Run[],
  scoresByRunId: ReadonlyMap<string, Score>,
): boolean {
  return runs.some((run) => {
    const score = scoresByRunId.get(run.runId);
    if (score === undefined) {
      return false;
    }
    return score.breakdown.some((check) => check.status === 'fail');
  });
}

/**
 * Failing rule 2: the most-recent run's composite score (by `byTimestamp`
 * ordering) is strictly below `failScoreThreshold`. Runs with no score are
 * skipped when identifying the most-recent scored run.
 */
function isMostRecentCompositeBelowThreshold(
  runs: readonly Run[],
  scoresByRunId: ReadonlyMap<string, Score>,
  failScoreThreshold: number,
): boolean {
  const sorted = [...runs].sort(byTimestamp);
  // Walk newest → oldest (reverse of sorted order)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const run = sorted[i];
    if (run === undefined) {
      continue;
    }
    const score = scoresByRunId.get(run.runId);
    if (score === undefined) {
      continue; // skip unscored runs
    }
    return score.composite < failScoreThreshold;
  }
  // No scored run found
  return false;
}

/**
 * Chronological ordering (oldest → newest), matching `buildTrendSeries`.
 * Runs with undefined timestamps sort last.
 */
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
