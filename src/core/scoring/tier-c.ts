/**
 * Tier C (judged quality) types, rubric version constant, and orchestrator.
 *
 * Tier C is an opt-in LLM-judged quality signal. It is strictly segregated
 * from Tier A (deterministic) and Tier B (reference-relative) — never blended,
 * never triggered automatically. Only user-initiated judge calls produce Tier C
 * annotations.
 *
 * `TierCResult` holds the LLM's verdict and reasoning for a single run.
 * `TierCAnchor` holds a user-supplied ground-truth example used to calibrate
 * the LLM judge (few-shot anchors).
 *
 * `judgeRun` is the orchestrator: it extracts run output, builds the judge
 * prompt, calls the judge, persists the result, and returns it. On any judge
 * failure it re-throws without persisting anything.
 */

/** Tier C annotation version. Increment when Tier C checks or semantics change. */
export const TIER_C_VERSION = 'tier-c-v1';

/** The label assigned by the LLM judge for a single run. */
export type TierCLabel = 'pass' | 'fail';

/** The full Tier C result for one run, as produced by the LLM judge. */
export interface TierCResult {
  /** The judge's verdict. */
  label: TierCLabel;
  /** The judge's chain-of-thought reasoning behind the label. */
  reasoning: string;
  /** The rubric version under which this result was produced. */
  rubricVersion: string;
  /** ISO 8601 timestamp of when this result was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Orchestrator imports (deferred to bottom of types section to avoid polluting
// the pure-types section and to mirror the tier-b.ts pattern).
// ---------------------------------------------------------------------------
import type { Run } from '../run';
import type { TierCStore } from '../store/tier-c-store';
import type { JudgeClient } from './judge-client';
import { buildJudgePrompt } from './tier-c-prompt';
import { extractRunOutput } from './tier-b-contract';

/**
 * A user-supplied ground-truth anchor for the Tier C judge.
 *
 * Anchors are few-shot calibration examples that tell the LLM judge what
 * "pass" and "fail" look like for a specific agent. They are keyed by
 * `identityKey` and `runId` so they survive agent renames and edits.
 */
export interface TierCAnchor {
  /** The agent's identity key (source-type::normalized-path::name). */
  identityKey: string;
  /** The run being used as a calibration example. */
  runId: string;
  /**
   * The agent's definition content at the time of the run (description +
   * system prompt). Snapshotted so anchors survive definition changes.
   */
  definitionSnapshot: string;
  /** The run's output or summary, as fed to the judge. */
  runOutput: string;
  /** The user-supplied quality verdict for this anchor. */
  score: 'pass' | 'fail';
  /** The user-supplied reasoning that explains the verdict. */
  reasoning: string;
  /** ISO 8601 timestamp of when this anchor was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Judge a single run using the Tier C LLM judge, persist the result, and
 * return it.
 *
 * **Failure contract:** when `judgeClient.judge` throws, the error is
 * re-propagated and nothing is written to `store`. Tier A and Tier B state
 * are never touched.
 *
 * **No automatic trigger:** this function must only be called explicitly by
 * the user-facing command. It is never invoked by ingestion or scoring code.
 *
 * @param run          - The attributed run to evaluate.
 * @param anchors      - Few-shot calibration anchors (may be empty).
 * @param judgeClient  - Injectable LLM client; use a fake in tests.
 * @param store        - The Tier C annotation store to persist the result to.
 * @returns The persisted `TierCResult`.
 * @throws When `judgeClient.judge` fails for any reason.
 */
export async function judgeRun(
  run: Run,
  anchors: TierCAnchor[],
  judgeClient: JudgeClient,
  store: TierCStore,
): Promise<TierCResult> {
  const runOutput = extractRunOutput(run) ?? '';
  const prompt = buildJudgePrompt(run, runOutput, anchors);

  // May throw — intentionally not caught so the caller sees the failure and
  // the store remains unpolluted.
  const { label, reasoning } = await judgeClient.judge(prompt);

  const result: TierCResult = {
    label,
    reasoning,
    rubricVersion: TIER_C_VERSION,
    createdAt: new Date().toISOString(),
  };

  store.add({ identityKey: run.identityKey, runId: run.runId, result });

  return result;
}
