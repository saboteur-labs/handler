/**
 * GUI core API — agent detail view.
 *
 * `getAgentDetail` assembles the full per-agent data structure the GUI
 * agent-detail endpoint serializes to JSON. It mirrors the data the
 * `handler show` command renders, but returns plain typed objects with no
 * ANSI/chalk formatting so the GUI can render them however it chooses.
 *
 * All data-access logic lives here; the HTTP server holds no logic and only
 * calls this function, then writes `JSON.stringify(result)`.
 */
import type { LoadedConventions } from '../conventions/conventions-store';
import { checkConventions } from '../conventions/checks';
import type { Run } from '../run';
import type { CheckStatus, ScoreBand } from '../scoring/rubric';
import { scoreRun } from '../scoring/score';
import type { TierBContractResult, TierBFlag, TierBStatus } from '../scoring/tier-b';
import { tierBForRun } from '../scoring/tier-b';
import type { TierCLabel } from '../scoring/tier-c';
import { TIER_C_VERSION } from '../scoring/tier-c';
import type { NoteStore } from '../store/note-store';
import type { ScoreStore } from '../store/score-store';
import type { TierBStore } from '../store/tier-b-store';
import type { TierCStore } from '../store/tier-c-store';
import type { SourceType } from '../sources/source';

export interface TierADetail {
  readonly composite: number;
  readonly band: ScoreBand;
  readonly failingChecks: ReadonlyArray<{ label: string; detail: string; status: 'warn' | 'fail' }>;
}

export interface TierBDetail {
  readonly status: TierBStatus;
  readonly flags?: readonly TierBFlag[];
  readonly contract?: TierBContractResult;
}

export interface TierCDetail {
  readonly label: TierCLabel;
  readonly reasoning: string;
}

export interface ConventionsCheckResult {
  readonly checkId: string;
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string | null;
}

export interface RunDetail {
  readonly runId: string;
  readonly status: string | undefined;
  readonly timestamp: string | undefined;
  readonly totalDurationMs: number | undefined;
  readonly totalTokens: number | undefined;
  readonly totalToolUseCount: number | undefined;
  /** null = unscored (no sub-transcript or no cached score). */
  readonly tierA: TierADetail | null;
  /** null = insufficient history, not computed, or not applicable. */
  readonly tierB: TierBDetail | null;
  /** null = not computed. */
  readonly tierC: TierCDetail | null;
}

export interface AgentDetail {
  readonly name: string;
  readonly sourceType: SourceType;
  readonly sourcePath: string;
  readonly identityKey: string;
  readonly runs: readonly RunDetail[];
  /** null = no conventions loaded or agent definition unavailable. */
  readonly conventionsResults: ConventionsCheckResult[] | null;
  /** null = no note set. */
  readonly note: string | null;
}

/**
 * Assemble the full detail object for the agent identified by `identityKey`.
 *
 * Returns `null` when no runs match the given identity key. Absent data
 * (no note, no Tier B/C, no conventions) is represented as typed `null`
 * rather than omitted keys so the GUI can distinguish "not loaded" from
 * "loaded but empty".
 *
 * This function is pure over its arguments and performs no I/O.
 */
export function getAgentDetail(
  identityKey: string,
  runs: readonly Run[],
  scoreStore: ScoreStore,
  tierBStore: TierBStore,
  tierCStore: TierCStore,
  noteStore: NoteStore,
  conventionsStore?: LoadedConventions | null,
  agentDefinition?: string | null,
): AgentDetail | null {
  const agentRuns = runs.filter((r) => r.identityKey === identityKey);

  if (agentRuns.length === 0) {
    return null;
  }

  const [sourceType, sourcePath, name] = JSON.parse(identityKey) as [SourceType, string, string];

  const sortedRuns = [...agentRuns].sort(byTimestamp);

  const runDetails: RunDetail[] = sortedRuns.map((run) =>
    assembleRunDetail(run, agentRuns, scoreStore, tierBStore, tierCStore),
  );

  const note = noteStore.get(identityKey);
  const definitionForConventions =
    agentDefinition !== undefined && agentDefinition !== null
      ? agentDefinition
      : (agentRuns[0]?.definitionSnapshot ?? null);
  const conventionsResults = assembleConventionsResults(
    name,
    conventionsStore ?? null,
    definitionForConventions,
  );

  return {
    name,
    sourceType,
    sourcePath,
    identityKey,
    runs: runDetails,
    conventionsResults,
    note: note?.body ?? null,
  };
}

function assembleRunDetail(
  run: Run,
  agentRuns: readonly Run[],
  scoreStore: ScoreStore,
  tierBStore: TierBStore,
  tierCStore: TierCStore,
): RunDetail {
  const score = scoreRun(run, scoreStore);
  const tierA: TierADetail | null =
    score === null
      ? null
      : {
          composite: score.composite,
          band: score.band,
          failingChecks: score.breakdown
            .filter((c): c is typeof c & { status: 'warn' | 'fail' } => isWarnOrFail(c.status))
            .map((c) => ({ label: c.label, detail: c.detail, status: c.status })),
        };

  const tierBResult = tierBForRun(run, agentRuns, tierBStore);
  const tierB: TierBDetail | null =
    tierBResult.status === 'insufficient-history'
      ? null
      : {
          status: tierBResult.status,
          flags: tierBResult.flags,
          contract: tierBResult.contract,
        };

  const tierCResult = tierCStore.get(run.identityKey, run.runId, TIER_C_VERSION);
  const tierC: TierCDetail | null =
    tierCResult === undefined
      ? null
      : { label: tierCResult.label, reasoning: tierCResult.reasoning };

  return {
    runId: run.runId,
    status: run.status,
    timestamp: run.timestamp,
    totalDurationMs: run.totalDurationMs,
    totalTokens: run.totalTokens,
    totalToolUseCount: run.totalToolUseCount,
    tierA,
    tierB,
    tierC,
  };
}

function assembleConventionsResults(
  name: string,
  conventionsStore: LoadedConventions | null,
  snapshot: string | null,
): ConventionsCheckResult[] | null {
  if (conventionsStore === null || conventionsStore.status === 'missing' || snapshot === null) {
    return null;
  }

  const { rules } = conventionsStore.artifact;
  const result = checkConventions({ snapshot, filenameStem: name, rules });

  const violationIds = new Set(result.violations.map((v) => v.rule));

  const checkLabels: ReadonlyArray<[string, string]> = [
    ['16a', 'Frontmatter present and complete'],
    ['16b', 'Name matches filename'],
    ['16c', 'Description meets minimum length'],
    ['16d', 'Tools scope declared'],
    ['16e', 'No unknown frontmatter keys'],
  ];

  return checkLabels.map(([checkId, label]) => {
    const violation = result.violations.find((v) => v.rule === checkId);
    return {
      checkId,
      label,
      passed: !violationIds.has(checkId as '16a' | '16b' | '16c' | '16d' | '16e'),
      detail: violation?.message ?? null,
    };
  });
}

function isWarnOrFail(status: CheckStatus): status is 'warn' | 'fail' {
  return status === 'warn' || status === 'fail';
}

/** Order runs chronologically; runs without a timestamp sort last. */
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
