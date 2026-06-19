/**
 * Browser-side type definitions mirroring the server-side GUI API shapes.
 *
 * These interfaces are structurally compatible with the types defined in
 * `src/core/gui/agents.ts` and `src/core/gui/agent-detail.ts`. They use
 * `string` in place of narrow server-side union types (e.g. `SourceType`,
 * `ScoreBand`) so that the browser bundle has no dependency on core modules.
 */

/** Mirror of AgentListEntry from src/core/gui/agents.ts */
export interface AgentSummary {
  readonly name: string;
  readonly sourceType: string; // 'user' | 'repo'
  readonly sourcePath: string;
  readonly identityKey: string;
  /** ISO timestamp of the most recent run, or null when no run has a timestamp. */
  readonly lastRunDate: string | null;
}

/** Mirror of AgentDetail from src/core/gui/agent-detail.ts */
export interface AgentDetail {
  readonly name: string;
  readonly sourceType: string;
  readonly sourcePath: string;
  readonly identityKey: string;
  readonly runs: readonly RunDetail[];
  /** null = no conventions loaded or agent definition unavailable. */
  readonly conventionsResults: ConventionsCheckResult[] | null;
  /** null = no note set. */
  readonly note: string | null;
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

export interface TierADetail {
  readonly composite: number;
  readonly band: string; // 'pass' | 'warn' | 'fail'
  readonly failingChecks: Array<{ label: string; detail: string; status: string }>;
}

export interface TierBDetail {
  readonly status: string;
  readonly flags?: Array<{ dimension: string; status: string }>;
  readonly contract?: { status: string };
}

export interface TierCDetail {
  readonly label: string; // 'pass' | 'fail'
  readonly reasoning: string;
}

export interface ConventionsCheckResult {
  readonly checkId: string;
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string | null;
}
