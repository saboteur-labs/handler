/**
 * handler core library.
 *
 * All behavior lives here so the CLI (and a future GUI) stay thin clients
 * over the same API. Feature modules are added under `src/core/` as the
 * MVP is built out (see `docs/tasks/`).
 */

/** Current handler version. Kept in sync with `package.json`. */
export const VERSION = '0.0.0';

export type { AgentResolution, AgentSummary, SourceFilter } from './agents';
export { resolveAgentByName, summarizeAgents } from './agents';
export { BUILTIN_AGENT_NAMES, isBuiltinAgent } from './denylist';
export { ingest } from './ingest';
export type { IngestOptions } from './ingest';
export type { AgentMetrics } from './metrics';
export { aggregateMetrics } from './metrics';
export type { Run, RunTag, RunTelemetrySummary } from './run';
export type { ChangePoint, DefinitionVersion, VersionSegmentation } from './correlation/versions';
export { segmentByDefinition } from './correlation/versions';
export type { DefinitionChangeDelta, SideAggregate } from './correlation/delta';
export { definitionChangeDeltas, MIN_RUNS_FOR_CONFIDENCE } from './correlation/delta';
export type { LatencyDistribution, RunTelemetry, StopReason } from './transcripts/telemetry';
export type { AgentIdentity } from './identity';
export { agentIdentity, identitiesEqual, identityKey } from './identity';
export { normalizePath } from './paths';
export { resolveAgent } from './resolve';
export type { CheckResult, CheckStatus, Score, ScoreBand } from './scoring/rubric';
export { RUBRIC_VERSION } from './scoring/rubric';
export { scoreRun } from './scoring/score';
export { defaultScoreStorePath, ScoreStore } from './store/score-store';
export type { Note } from './store/note-store';
export { defaultNotePath, NoteStore } from './store/note-store';
export type { AgentAssessment, AssessOptions, ConventionsAssessment } from './conventions/assess';
export { assessConventions } from './conventions/assess';
export type { ConventionSmell, ConventionViolation, RuleId } from './conventions/checks';
export { checkConventions } from './conventions/checks';
export type {
  ConventionRules,
  ConventionsArtifact,
  LoadedConventions,
  MissingReason,
} from './conventions/conventions-store';
export {
  CONVENTIONS_STORE_VERSION,
  defaultConventionsPath,
  loadConventions,
  loadConventionsWithDefault,
} from './conventions/conventions-store';
export type { StalenessState } from './conventions/staleness';
export { evaluateStaleness, hashRules, STALE_TTL_DAYS } from './conventions/staleness';
export { defaultRegistryPath, SourceRegistry } from './sources/registry';
export type { AgentSource, SourceType } from './sources/source';
export { enumerateDefinitionNames, repoSource, userSource } from './sources/source';
export type { TrendRow } from './trend/series';
export { buildTrendSeries } from './trend/series';
export type { BucketGranularity, BucketRow } from './trend/bucket';
export { bucket } from './trend/bucket';
export { filterLast, filterSince } from './trend/window';
export type { TierBContractResult, TierBFlag, TierBResult, TierBStatus } from './scoring/tier-b';
export {
  DEFAULT_MIN_RUNS,
  DEFAULT_OUTLIER_FACTOR,
  getMinRuns,
  getOutlierFactor,
  tierBForRun,
  TIER_B_VERSION,
} from './scoring/tier-b';
export type { TierCAnchor, TierCLabel, TierCResult } from './scoring/tier-c';
export { judgeRun, TIER_C_VERSION } from './scoring/tier-c';
export type { TierBAnnotation } from './store/tier-b-store';
export { defaultTierBStorePath, TierBStore, TIER_B_STORE_VERSION } from './store/tier-b-store';
export type { TierCAnnotation } from './store/tier-c-store';
export { defaultTierCStorePath, TierCStore, TIER_C_STORE_VERSION } from './store/tier-c-store';
export type { TierBReference, TierBReferenceResult } from './scoring/tier-b-reference';
export { computeReference } from './scoring/tier-b-reference';
export { computeOutlierFlags } from './scoring/tier-b-outliers';
export type { DetectedContract } from './scoring/tier-b-contract';
export { checkContract, detectContract, extractRunOutput } from './scoring/tier-b-contract';
export { ANCHOR_STORE_VERSION, AnchorStore, defaultAnchorsPath } from './store/anchor-store';
export { buildJudgePrompt } from './scoring/tier-c-prompt';
export type { JudgeClient, JudgeResponse } from './scoring/judge-client';
export { DefaultJudgeClient } from './scoring/judge-client';
export {
  DEFAULT_INSIGHTS_FAIL_SCORE,
  DEFAULT_INSIGHTS_RECENCY_DAYS,
  getInsightsFailScore,
  getInsightsRecencyDays,
} from './insights/config';
export type {
  AgentDescriptor,
  AgentInsight,
  ClassifierInput,
  ClassifierOptions,
  InsightCategory,
  InsightsResult,
} from './insights/classify';
export { classifyRoster } from './insights/classify';
export { enumerateAgentDescriptors } from './insights/roster';
export type { HookPayload } from './hook/payload';
export { parseHookPayload } from './hook/payload';
export type { HandleResult } from './hook/handler';
export { handleSubagentStop } from './hook/handler';
export type {
  AgentDetail,
  AgentListEntry,
  ConventionsCheckResult,
  GuiServerHandle,
  RunDetail,
  TierADetail,
  TierBDetail,
  TierCDetail,
} from './gui/index';
export { getAgentDetail, listAgents, startGuiServer } from './gui/index';
