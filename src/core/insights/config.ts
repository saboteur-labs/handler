/**
 * Insights thresholds & config.
 *
 * Exposes four tunable thresholds used by the `insights` command:
 *  - Recency window: how many days back to look when classifying unused agents.
 *  - Failing-score threshold: the composite score below which an agent is
 *    classified as failing.
 *  - Minimum-run count: re-exported from Tier B (single source of truth).
 *  - Outlier factor: re-exported from Tier B (single source of truth).
 *
 * Each threshold reads an env-var override and falls back to its documented
 * default when the env var is absent, non-numeric, or out of range.
 *
 * Req 8 (V1 Feature 4): All thresholds and windows MUST be configurable and
 * MUST have documented defaults; the command MUST NOT embed hard-coded judgments.
 */

export {
  DEFAULT_MIN_RUNS,
  DEFAULT_OUTLIER_FACTOR,
  getMinRuns,
  getOutlierFactor,
} from '../scoring/tier-b';

/** Default recency window in days. Agents with no runs within this window are considered unused. */
export const DEFAULT_INSIGHTS_RECENCY_DAYS = 30;

/**
 * Returns the configured recency window in days.
 *
 * Reads `HANDLER_INSIGHTS_RECENCY_DAYS`. Falls back to `DEFAULT_INSIGHTS_RECENCY_DAYS`
 * when the env var is absent, non-numeric, or not a positive integer.
 */
export function getInsightsRecencyDays(): number {
  const raw = process.env['HANDLER_INSIGHTS_RECENCY_DAYS'];
  if (raw === undefined) {
    return DEFAULT_INSIGHTS_RECENCY_DAYS;
  }
  const parsed = parseInt(raw, 10);
  if (!isFinite(parsed) || parsed <= 0) {
    return DEFAULT_INSIGHTS_RECENCY_DAYS;
  }
  return parsed;
}

/** Default failing-score threshold. Agents whose most-recent composite score falls below this are classified as failing. */
export const DEFAULT_INSIGHTS_FAIL_SCORE = 50;

/**
 * Returns the configured failing-score threshold.
 *
 * Reads `HANDLER_INSIGHTS_FAIL_SCORE`. Falls back to `DEFAULT_INSIGHTS_FAIL_SCORE`
 * when the env var is absent, non-numeric, or outside the valid 0–100 range.
 */
export function getInsightsFailScore(): number {
  const raw = process.env['HANDLER_INSIGHTS_FAIL_SCORE'];
  if (raw === undefined) {
    return DEFAULT_INSIGHTS_FAIL_SCORE;
  }
  const parsed = parseInt(raw, 10);
  if (!isFinite(parsed) || parsed < 0 || parsed > 100) {
    return DEFAULT_INSIGHTS_FAIL_SCORE;
  }
  return parsed;
}
