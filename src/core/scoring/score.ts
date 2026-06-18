/**
 * Scoring orchestrator (spec Reqs 1, 12, 14).
 *
 * Scores one run end-to-end and lazily: it returns the cached annotation when
 * the run was already scored under the current `RUBRIC_VERSION`; otherwise it
 * locates the run's sub-transcript, runs the deterministic checks, applies the
 * rubric, persists the annotation, and returns it. A run with no locatable
 * sidechain (interrupted, or never recorded) is unscored — it returns `null`
 * rather than a misleading zero. Pure composition over local data; no network.
 */
import { existsSync } from 'node:fs';

import type { Run } from '../run';
import type { ScoreStore } from '../store/score-store';
import { readActivity } from './activity';
import { activityChecks } from './checks-activity';
import { boundaryChecks } from './checks-boundary';
import { scopeChecks } from './checks-scope';
import { parseToolScope } from './scope';
import { applyRubric, RUBRIC_VERSION, type Score } from './rubric';

/**
 * Score `run`, caching the result in `store` keyed by the current rubric
 * version. Returns `null` when the run has no locatable sub-transcript.
 */
export function scoreRun(run: Run, store: ScoreStore): Score | null {
  const cached = store.get(run.runId, RUBRIC_VERSION);
  if (cached !== undefined) {
    return cached;
  }
  if (run.sidechainPath === undefined || !existsSync(run.sidechainPath)) {
    return null;
  }

  const activity = readActivity(run.sidechainPath);
  const score = applyRubric({
    activity: activityChecks(activity, run.status),
    scope: scopeChecks(activity, parseToolScope(run.definitionSnapshot)),
    boundary: boundaryChecks(activity, run.cwd),
  });
  store.add({ runId: run.runId, score });
  return score;
}
