/**
 * Static-assessment orchestrator (`assess`) (feature-static-assessment FR-1,
 * FR-4, FR-5, FR-6, FR-21).
 *
 * Mirrors `conventions/assess.ts`'s `assessConventions` shape and orchestration
 * pattern (source enumeration, orphan handling, builtin exclusion, identity),
 * but is otherwise fully independent of the `conventions` feature: it never
 * reads the conventions artifact or its staleness state, and this module
 * writes nothing to any store, file, or definition — read-only, deterministic,
 * no network/LLM calls.
 *
 * Orchestration, in order:
 *   1. Build the whole fleet FIRST, across every registered source, before
 *      running any checks — fleet-level checks (e.g. `fleet/duplicate-definition`)
 *      need every sibling present, including ones from other sources. Each
 *      loaded (non-orphan) definition is parsed with a `sourceKey` derived from
 *      its originating `AgentSource` (`${type}:${root}`), so fleet checks can
 *      tell "same name, different source" apart from "same name, same source".
 *   2. Resolve the check-suppression policy per source (`resolvePolicy`):
 *      built-in defaults -> global user config -> that source's own
 *      `<root>/.handler/config.json` (repo sources only). Each agent is judged
 *      by its own source's policy — there is no cwd-derived global repo layer.
 *   3. Run the full check registry (`tools` + `prompt` + `fleet`) against each
 *      non-orphan agent over the whole fleet, once, using an "all-enabled"
 *      variant of the resolved policy (every entry's `enabled` forced `true`,
 *      `severity`/`options` unchanged). Partitioning that single result set by
 *      the REAL policy's `enabled` flag yields both the surfaced findings (FR-3,
 *      FR-21's suppression behavior) and the suppressed ones, without running
 *      `runChecks` twice per agent.
 *   4. Orphans (a definition that vanished between enumeration and snapshot
 *      load) are tagged, not thrown, and excluded from the fleet passed to
 *      `runChecks` — same convention as `assessConventions`.
 */
import { join } from 'node:path';

import { isBuiltinAgent } from '../denylist';
import type { AgentIdentity } from '../identity';
import { agentIdentity } from '../identity';
import { loadDefinitionSnapshot } from '../snapshot';
import type { AgentSource } from '../sources/source';
import { enumerateDefinitionNames } from '../sources/source';
import type {
  Category,
  EffectivePolicy,
  Finding,
  PolicyEntry,
  Severity,
  StaticCheck,
} from './check';
import { FLEET_CHECKS } from './checks/fleet';
import { PROMPT_CHECKS } from './checks/prompt';
import { TOOLS_CHECKS } from './checks/tools';
import { resolvePolicy } from './config-store';
import type { ParsedDefinition } from './parse';
import { parseDefinition } from './parse';
import { runChecks } from './run-checks';
import { meetsOrExceedsSeverity } from './severity';

/** A single agent's static-assessment result. */
export interface StaticAgentAssessment {
  readonly identity: AgentIdentity;
  /** True when the definition could not be loaded (orphan); checks are skipped. */
  readonly orphan: boolean;
  /** Findings from checks currently enabled by the resolved policy. */
  readonly findings: readonly Finding[];
  /**
   * Findings that WOULD have fired had their check not been disabled by the
   * resolved policy — still attributed to this agent so a caller (e.g. a
   * future `--all` flag) can render them, visually marked as suppressed.
   */
  readonly suppressedFindings: readonly Finding[];
}

/** Run-level accounting of how many findings were suppressed, and by which checks (FR-21). */
export interface SuppressedSummary {
  readonly count: number;
  readonly checkIds: readonly string[];
}

/** The full result of a static-assessment run. */
export interface StaticAssessReport {
  readonly agents: readonly StaticAgentAssessment[];
  readonly suppressedSummary: SuppressedSummary;
}

/**
 * Whether a report should trip a non-zero exit at the `failOn` threshold — the
 * `--fail-on` CI-gate decision (FR-23). True when any SURFACED finding (not a
 * suppressed one) meets or exceeds `failOn`. This is domain logic; the CLI
 * only maps the boolean to a process exit code.
 */
export function reportTripsThreshold(report: StaticAssessReport, failOn: Severity): boolean {
  return report.agents.some((agent) =>
    agent.findings.some((finding) => meetsOrExceedsSeverity(finding.severity, failOn)),
  );
}

export interface StaticAssessOptions {
  readonly sources: readonly AgentSource[];
  /**
   * User-level check-suppression config path; defaults to `~/.handler/config.json`.
   * Applied as the global layer over every source. Each repo source's own
   * `<root>/.handler/config.json` is resolved automatically from its `root`
   * and layered on top for that source's agents only — there is no
   * cwd-derived global repo config.
   */
  readonly userConfigPath?: string;
  /**
   * Restrict which check categories run (e.g. a CLI `assess tools` invocation).
   * The fleet is always built in full regardless of this filter — fleet-level
   * checks (and any check needing sibling definitions) still see every
   * definition across every source. Omit to run all categories (default).
   */
  readonly categories?: readonly Category[];
}

/** A stable, deterministic per-source discriminator for `ParsedDefinition.sourceKey`. */
function sourceKeyFor(source: AgentSource): string {
  return `${source.type}:${source.root}`;
}

/** A source's resolved suppression policy plus its all-enabled variant (for suppressed accounting). */
interface ResolvedPolicy {
  readonly policy: EffectivePolicy;
  readonly allEnabled: EffectivePolicy;
}

/**
 * One enumerated definition's identity, its parsed content when it loaded
 * (orphan otherwise), and the resolved policy of the source it came from.
 */
interface EnumeratedEntry {
  readonly identity: AgentIdentity;
  readonly parsed: ParsedDefinition | null;
  readonly resolved: ResolvedPolicy;
}

/** Force every policy entry's `enabled` to `true`, keeping `severity`/`options` as resolved. */
function withAllEnabled(policy: EffectivePolicy): EffectivePolicy {
  const forced = new Map<string, PolicyEntry>();
  for (const [id, entry] of policy) {
    forced.set(id, { ...entry, enabled: true });
  }
  return forced;
}

/**
 * Assess every registered source's definitions against the static check
 * registry (`tools`/`prompt`/`fleet`), applying the resolved check-suppression
 * policy. Read-only: no store writes, no definition mutation, no network/LLM
 * calls, and no dependency on the `conventions` feature's artifact or
 * staleness state.
 *
 * `options.categories`, when provided, narrows which check descriptors run
 * (e.g. a CLI `assess tools` invocation) — the fleet is always built in full
 * regardless, so fleet-level checks still see every sibling definition.
 */
export function assess(options: StaticAssessOptions): StaticAssessReport {
  // Resolve each registered source's policy once (built-in defaults -> global
  // user config -> that source's own `<root>/.handler/config.json`, repo
  // sources only) and attach it to every definition enumerated from that
  // source, so each agent is judged by its own repo's committed policy.
  const policyBySource = new Map<string, ResolvedPolicy>();
  const entries: EnumeratedEntry[] = [];
  for (const source of options.sources) {
    const sourceKey = sourceKeyFor(source);
    let resolved = policyBySource.get(sourceKey);
    if (resolved === undefined) {
      const repoConfigPath =
        source.type === 'repo' ? join(source.root, '.handler', 'config.json') : undefined;
      const policy = resolvePolicy({ userConfigPath: options.userConfigPath, repoConfigPath });
      resolved = { policy, allEnabled: withAllEnabled(policy) };
      policyBySource.set(sourceKey, resolved);
    }
    for (const name of enumerateDefinitionNames(source)) {
      if (isBuiltinAgent(name)) {
        continue;
      }
      const identity = agentIdentity(source, name);
      const snapshot = loadDefinitionSnapshot(source, name);
      entries.push({
        identity,
        resolved,
        parsed: snapshot === null ? null : parseDefinition(snapshot, sourceKey),
      });
    }
  }

  const allChecks: readonly StaticCheck[] = [...TOOLS_CHECKS, ...PROMPT_CHECKS, ...FLEET_CHECKS];
  const categories = options.categories;
  const selectedChecks: readonly StaticCheck[] =
    categories === undefined
      ? allChecks
      : allChecks.filter((check) => categories.includes(check.category));
  const fleet: readonly ParsedDefinition[] = entries
    .map((entry) => entry.parsed)
    .filter((parsed): parsed is ParsedDefinition => parsed !== null);

  let suppressedCount = 0;
  const suppressedCheckIds = new Set<string>();

  const agents: StaticAgentAssessment[] = entries.map((entry) => {
    if (entry.parsed === null) {
      return { identity: entry.identity, orphan: true, findings: [], suppressedFindings: [] };
    }
    const full = runChecks(selectedChecks, entry.parsed, fleet, entry.resolved.allEnabled);
    const findings: Finding[] = [];
    const suppressedFindings: Finding[] = [];
    for (const finding of full) {
      const enabled = entry.resolved.policy.get(finding.check)?.enabled ?? true;
      if (enabled) {
        findings.push(finding);
      } else {
        suppressedFindings.push(finding);
        suppressedCheckIds.add(finding.check);
        suppressedCount += 1;
      }
    }
    return { identity: entry.identity, orphan: false, findings, suppressedFindings };
  });

  return {
    agents,
    suppressedSummary: {
      count: suppressedCount,
      checkIds: [...suppressedCheckIds].sort(),
    },
  };
}
