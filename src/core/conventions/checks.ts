/**
 * Convention checks engine (spec Reqs 16, 17).
 *
 * Runs the deterministic starter checks 16a–e against a parsed definition using
 * the artifact's rule set, emitting one violation per failed check citing its
 * rule id. A failing 16d (no usable `tools` scope) additionally surfaces the
 * `undeclared-scope` definition smell (Req 17). Pure function — no I/O; the
 * filename stem is supplied by the caller (Task 5 orchestrator) for 16b.
 *
 * Cue detection (16c) matches the artifact's `cuePatterns` case-insensitively.
 * `tools` presence (16d) reuses `parseToolScope`; the rest read the parsed
 * frontmatter from `parseFrontmatter`.
 */
import { parseToolScope } from '../scoring/scope';
import type { ConventionRules } from './conventions-store';
import { parseFrontmatter } from './frontmatter';

export type RuleId = '16a' | '16b' | '16c' | '16d' | '16e';

export interface ConventionViolation {
  readonly rule: RuleId;
  readonly message: string;
}

/** Definition smells surfaced alongside violations (Req 17). */
export type ConventionSmell = 'undeclared-scope';

export interface CheckResult {
  readonly violations: readonly ConventionViolation[];
  readonly smells: readonly ConventionSmell[];
}

export interface CheckInput {
  /** The definition snapshot (or `null` for an orphan). */
  readonly snapshot: string | null;
  /** The definition's filename stem, for 16b's name-matches-filename check. */
  readonly filenameStem: string;
  /** The distilled rule set the checks are parameterized by. */
  readonly rules: ConventionRules;
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Run the convention checks against a single definition. */
export function checkConventions(input: CheckInput): CheckResult {
  const { snapshot, filenameStem, rules } = input;
  const frontmatter = parseFrontmatter(snapshot);

  const violations: ConventionViolation[] = [];
  const smells: ConventionSmell[] = [];
  const add = (rule: RuleId, message: string): void => {
    violations.push({ rule, message });
  };

  // 16a — frontmatter parses and contains the required keys.
  if (!frontmatter.present) {
    add('16a', 'definition has no frontmatter block');
  } else {
    const missing = rules.requiredKeys.filter((key) => !frontmatter.values.has(key));
    if (missing.length > 0) {
      add('16a', `frontmatter is missing required key(s): ${missing.join(', ')}`);
    }
  }

  // 16b — name is kebab-case and equals the filename stem.
  const name = frontmatter.values.get('name');
  if (name === undefined || name === '') {
    add('16b', 'name is absent');
  } else if (!KEBAB_CASE.test(name)) {
    add('16b', `name "${name}" is not kebab-case`);
  } else if (name !== filenameStem) {
    add('16b', `name "${name}" does not match filename stem "${filenameStem}"`);
  }

  // 16c — description is non-empty, long enough, and carries a triggering cue.
  const description = frontmatter.values.get('description') ?? '';
  if (description.trim() === '') {
    add('16c', 'description is empty');
  } else if (description.length < rules.descriptionMinLength) {
    add('16c', `description is shorter than ${rules.descriptionMinLength} characters`);
  } else if (!hasCue(description, rules.cuePatterns)) {
    add('16c', 'description has no triggering cue (e.g. "use when")');
  }

  // 16d — a usable tools scope is declared. A failure is the undeclared-scope smell.
  if (!parseToolScope(snapshot).declared) {
    add('16d', 'tools field is absent or empty');
    smells.push('undeclared-scope');
  }

  // 16e — no frontmatter key outside the allowed set.
  const allowed = new Set(rules.allowedKeys);
  const unrecognized = frontmatter.keys.filter((key) => !allowed.has(key));
  if (unrecognized.length > 0) {
    add('16e', `unrecognized frontmatter key(s): ${unrecognized.join(', ')}`);
  }

  return { violations, smells };
}

/** True when `description` contains at least one cue pattern (case-insensitive). */
function hasCue(description: string, cuePatterns: readonly string[]): boolean {
  const haystack = description.toLowerCase();
  return cuePatterns.some((pattern) => haystack.includes(pattern.toLowerCase()));
}
