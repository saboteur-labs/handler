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
export type { Run, RunTag } from './run';
export type { AgentIdentity } from './identity';
export { agentIdentity, identitiesEqual, identityKey } from './identity';
export { normalizePath } from './paths';
export { resolveAgent } from './resolve';
export type { CheckResult, CheckStatus, Score, ScoreBand } from './scoring/rubric';
export { RUBRIC_VERSION } from './scoring/rubric';
export { scoreRun } from './scoring/score';
export { defaultScoreStorePath, ScoreStore } from './store/score-store';
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
export { repoSource, userSource } from './sources/source';
