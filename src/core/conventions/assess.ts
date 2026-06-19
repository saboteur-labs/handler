/**
 * Conventions assessment orchestrator (spec Reqs 16–18).
 *
 * For every registered source, enumerate its user-authored agent definitions,
 * load each snapshot, run the deterministic checks against the distilled rule
 * set, and return per-agent violations plus the overall staleness state. The
 * pure checks live in `checks.ts`; this module holds only the orchestration —
 * enumeration, snapshot loading, identity, and the conventions/staleness read.
 *
 * Builtin/plugin agents are excluded (the user-authored-only invariant). An
 * orphan (definition that vanished between enumeration and load) is tagged, not
 * thrown. When conventions are missing, the staleness state is returned with no
 * agents rather than failing — there is no rule set to check against.
 */
import { isBuiltinAgent } from '../denylist';
import type { AgentIdentity } from '../identity';
import { agentIdentity } from '../identity';
import { loadDefinitionSnapshot } from '../snapshot';
import type { AgentSource } from '../sources/source';
import { enumerateDefinitionNames } from '../sources/source';
import type { ConventionSmell, ConventionViolation } from './checks';
import { checkConventions } from './checks';
import { loadConventionsWithDefault } from './conventions-store';
import type { StalenessState } from './staleness';
import { evaluateStaleness } from './staleness';

export interface AgentAssessment {
  readonly identity: AgentIdentity;
  /** True when the definition could not be loaded (orphan); checks are skipped. */
  readonly orphan: boolean;
  readonly violations: readonly ConventionViolation[];
  readonly smells: readonly ConventionSmell[];
}

export interface ConventionsAssessment {
  readonly staleness: StalenessState;
  readonly agents: readonly AgentAssessment[];
}

export interface AssessOptions {
  readonly sources: readonly AgentSource[];
  /** Conventions-artifact path; defaults to `defaultConventionsPath()`. */
  readonly conventionsPath?: string;
}

/** Assess every registered source's definitions against the conventions. */
export function assessConventions(options: AssessOptions): ConventionsAssessment {
  const loaded = loadConventionsWithDefault(options.conventionsPath);
  const staleness = evaluateStaleness(loaded);
  if (loaded.status === 'missing') {
    return { staleness, agents: [] };
  }

  const { rules } = loaded.artifact;
  const agents: AgentAssessment[] = [];
  for (const source of options.sources) {
    for (const name of enumerateDefinitionNames(source)) {
      if (isBuiltinAgent(name)) {
        continue;
      }
      const identity = agentIdentity(source, name);
      const snapshot = loadDefinitionSnapshot(source, name);
      if (snapshot === null) {
        agents.push({ identity, orphan: true, violations: [], smells: [] });
        continue;
      }
      const result = checkConventions({ snapshot, filenameStem: name, rules });
      agents.push({
        identity,
        orphan: false,
        violations: result.violations,
        smells: result.smells,
      });
    }
  }
  return { staleness, agents };
}
