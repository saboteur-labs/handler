/**
 * Pure static-check runner (feature-static-assessment FR-2, FR-3).
 *
 * Applies a resolved `EffectivePolicy` to a list of `StaticCheck` descriptors:
 * skips disabled checks entirely and stamps emitted findings with the
 * *effective* severity (the policy's severity when present, else the check's
 * own default). Full precedence resolution against built-in defaults is a
 * later task (the config store) — this runner only applies whatever
 * `EffectivePolicy` it is handed, falling back to the check's own
 * enabled-by-default / own-severity behavior when a check id is simply absent
 * from the map.
 */
import type { EffectivePolicy, Finding, StaticCheck } from './check';
import type { ParsedDefinition } from './parse';

/**
 * Run each check in `checks` against `agent` (with `fleet` available for
 * fleet-level checks), applying `policy` to decide whether the check runs and
 * what severity its findings are stamped with. Returns the flattened list of
 * findings across all enabled checks.
 */
export function runChecks(
  checks: readonly StaticCheck[],
  agent: ParsedDefinition,
  fleet: readonly ParsedDefinition[],
  policy: EffectivePolicy,
): Finding[] {
  const findings: Finding[] = [];
  for (const check of checks) {
    const entry = policy.get(check.id);
    const enabled = entry?.enabled ?? true;
    if (!enabled) {
      continue;
    }
    const effectiveSeverity = entry?.severity ?? check.severity;
    const results = check.run(agent, fleet, entry?.options);
    for (const finding of results) {
      findings.push({ ...finding, severity: effectiveSeverity });
    }
  }
  return findings;
}
