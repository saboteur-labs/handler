/**
 * `fleet` category static checks (feature-static-assessment FR-15).
 *
 * Both checks are fleet-aware (they compare `agent` against every other
 * member of `fleet`) and pure — no store reads/writes, no file I/O, no
 * network/LLM calls. Similarity is computed once via the shared
 * `similarity` helper (`../similarity.ts`) — one implementation for both
 * checks, per the spec's resolved decision.
 */
import type { Finding, StaticCheck } from '../check';
import type { ParsedDefinition } from '../parse';
import { jaccard, tokenize } from '../similarity';

/**
 * Per-agent normalized token-set caches for the fields the fleet checks
 * compare (`description`, `body`). A fleet check runs once per agent and
 * compares against every other member, so without memoization each agent's
 * field is re-tokenized once per comparison — O(n²) tokenizations over a
 * fleet of n. `ParsedDefinition` instances are stable for the lifetime of an
 * `assess` run, so a `WeakMap` keyed by the agent computes each set once and
 * reuses it across every comparison (and across both checks, for the fields
 * they share). Entries are released once the fleet is unreferenced.
 */
const descriptionTokens = new WeakMap<ParsedDefinition, ReadonlySet<string>>();
const bodyTokens = new WeakMap<ParsedDefinition, ReadonlySet<string>>();

function descriptionTokensFor(agent: ParsedDefinition): ReadonlySet<string> {
  let tokens = descriptionTokens.get(agent);
  if (tokens === undefined) {
    tokens = tokenize(agent.description ?? '');
    descriptionTokens.set(agent, tokens);
  }
  return tokens;
}

function bodyTokensFor(agent: ParsedDefinition): ReadonlySet<string> {
  let tokens = bodyTokens.get(agent);
  if (tokens === undefined) {
    tokens = tokenize(agent.body);
    bodyTokens.set(agent, tokens);
  }
  return tokens;
}

/**
 * Default similarity threshold (Jaccard, 0–1) for both fleet checks when
 * policy `options` does not configure one (FR-15). 0.8 is the spec's stated
 * "tunable starter default".
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

/**
 * Shared option-key convention: both `fleet/duplicate-trigger` (over
 * `description`) and `fleet/duplicate-definition`'s body-similarity path
 * read the SAME option key, `similarityThreshold`, off policy
 * `options` — per FR-15's "the same similarity threshold, one
 * implementation for both fleet checks". The neutral, field-agnostic name
 * avoids implying it only governs `description` similarity, since
 * `duplicate-definition` reuses the very same key for `body` similarity
 * rather than introducing a second, differently-named knob a config author
 * would have to keep in sync.
 */
const THRESHOLD_OPTION_KEY = 'similarityThreshold';

/** Read the configured similarity threshold from `options`, falling back to the default. */
function resolveThreshold(options?: Record<string, unknown>): number {
  const configured = options?.[THRESHOLD_OPTION_KEY];
  return typeof configured === 'number' ? configured : DEFAULT_SIMILARITY_THRESHOLD;
}

/**
 * Memoized position-in-fleet lookup, keyed by the `fleet` array (stable within
 * an `assess` run). Built once per fleet so `precedesInFleet` is an O(1) map
 * read rather than two O(n) `Array.indexOf` scans per pair — the latter is
 * O(n³) across a full fleet run.
 */
const fleetIndex = new WeakMap<
  readonly ParsedDefinition[],
  ReadonlyMap<ParsedDefinition, number>
>();

function indexInFleet(fleet: readonly ParsedDefinition[], def: ParsedDefinition): number {
  let index = fleetIndex.get(fleet);
  if (index === undefined) {
    const built = new Map<ParsedDefinition, number>();
    fleet.forEach((member, position) => built.set(member, position));
    index = built;
    fleetIndex.set(fleet, index);
  }
  return index.get(def) ?? -1;
}

/**
 * True when `agent` "precedes" `other` in the fleet's fixed iteration order —
 * used to emit a symmetric pairwise finding exactly once across a full
 * fleet run (each pair is compared when `check.run` is called once per
 * fleet member, per `runChecks`'s per-agent-call contract; see
 * `tools/spawn-loop`'s precedent in `tools.ts`). Convention: index position
 * within the `fleet` array as passed to `.run`, found via reference
 * equality (`===`) rather than by value, since `ParsedDefinition` objects in
 * a real fleet are distinct instances even when two share a `name`.
 */
function precedesInFleet(
  fleet: readonly ParsedDefinition[],
  agent: ParsedDefinition,
  other: ParsedDefinition,
): boolean {
  return indexInFleet(fleet, agent) < indexInFleet(fleet, other);
}

/**
 * `fleet/duplicate-trigger` (warn): fires when `agent`'s `description`
 * similarity to another fleet member's `description` meets or exceeds the
 * configured threshold (default 0.8), flagging routing ambiguity (FR-15).
 *
 * Emits each duplicate pair exactly once: only when `agent` precedes the
 * `other` member in the `fleet` array (see `precedesInFleet`), and never
 * compares an agent against itself (skipped via reference equality).
 */
export const duplicateTriggerCheck: StaticCheck = {
  id: 'fleet/duplicate-trigger',
  category: 'fleet',
  severity: 'warn',
  run: (agent, fleet, options): Finding[] => {
    const threshold = resolveThreshold(options);
    const findings: Finding[] = [];
    for (const other of fleet) {
      if (other === agent || !precedesInFleet(fleet, agent, other)) {
        continue;
      }
      const score = jaccard(descriptionTokensFor(agent), descriptionTokensFor(other));
      if (score >= threshold) {
        const agentLabel = agent.name ?? '(unnamed)';
        const otherLabel = other.name ?? '(unnamed)';
        findings.push({
          check: 'fleet/duplicate-trigger',
          severity: 'warn',
          message:
            `"${agentLabel}" and "${otherLabel}" have highly similar descriptions ` +
            `(similarity ${score.toFixed(2)} >= ${threshold}), risking routing ambiguity`,
          suggestion:
            'differentiate the descriptions so automatic delegation can distinguish the two agents',
        });
      }
    }
    return findings;
  },
};

/**
 * True when `a` and `b` share a `name` and are provably from different
 * sources: both `sourceKey` values are defined AND differ. When either
 * side's `sourceKey` is `undefined` (unknown source, e.g. a bare unit-test
 * fixture), this is treated as "cannot prove different sources" — the
 * name-duplicate path stays silent for that pair (though the independent
 * body-similarity path may still fire).
 */
function sameNameDifferentSource(a: ParsedDefinition, b: ParsedDefinition): boolean {
  if (a.name === undefined || b.name === undefined || a.name !== b.name) {
    return false;
  }
  return a.sourceKey !== undefined && b.sourceKey !== undefined && a.sourceKey !== b.sourceKey;
}

/**
 * `fleet/duplicate-definition` (info): fires when `agent` shares a `name`
 * with another fleet member across provably different sources, OR when
 * their `body` similarity meets or exceeds the same threshold used by
 * `fleet/duplicate-trigger` (FR-15; see `THRESHOLD_OPTION_KEY`'s doc comment
 * for why both checks share one option key, `similarityThreshold`).
 *
 * Emits each duplicate pair exactly once, using the same
 * `precedesInFleet` convention as `duplicateTriggerCheck`, and never
 * compares an agent against itself.
 */
export const duplicateDefinitionCheck: StaticCheck = {
  id: 'fleet/duplicate-definition',
  category: 'fleet',
  severity: 'info',
  run: (agent, fleet, options): Finding[] => {
    const threshold = resolveThreshold(options);
    const findings: Finding[] = [];
    for (const other of fleet) {
      if (other === agent || !precedesInFleet(fleet, agent, other)) {
        continue;
      }

      const agentLabel = agent.name ?? '(unnamed)';
      const otherLabel = other.name ?? '(unnamed)';

      if (sameNameDifferentSource(agent, other)) {
        findings.push({
          check: 'fleet/duplicate-definition',
          severity: 'info',
          message:
            `"${agentLabel}" is defined under the same name in more than one source ` +
            `(different sources)`,
          suggestion: 'rename one of the definitions, or consolidate to a single source of truth',
        });
        continue;
      }

      const bodyScore = jaccard(bodyTokensFor(agent), bodyTokensFor(other));
      if (bodyScore >= threshold) {
        findings.push({
          check: 'fleet/duplicate-definition',
          severity: 'info',
          message:
            `"${agentLabel}" and "${otherLabel}" have highly similar system-prompt body content ` +
            `(body similarity ${bodyScore.toFixed(2)} >= ${threshold})`,
          suggestion:
            'consolidate the two definitions, or differentiate their bodies if the overlap is ' +
            'unintentional',
        });
      }
    }
    return findings;
  },
};

/** The `fleet` category's checks, in a stable registration order. */
export const FLEET_CHECKS: readonly StaticCheck[] = [
  duplicateTriggerCheck,
  duplicateDefinitionCheck,
];
