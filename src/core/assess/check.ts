/**
 * Static-check registry types (feature-static-assessment FR-2, FR-3).
 *
 * Checks are modeled as independent descriptors — each with a stable string
 * `id`, a `category`, a default `severity`, and a pure evaluation function —
 * rather than a monolithic function (contrast `conventions/checks.ts`'s
 * `checkConventions`). This lets the check set grow without editing a closed
 * union. `Finding.suggestion` is advisory-only text: there is no "apply" path
 * anywhere in this module or its consumers, and none should be added.
 */
import type { ParsedDefinition } from './parse';

/** Finding/check severity, ordered informally low → high: info, warn, error. */
export type Severity = 'error' | 'warn' | 'info';

/** The three static-check categories (feature-static-assessment FR-1). */
export type Category = 'tools' | 'prompt' | 'fleet';

/** A single deterministic static-check descriptor. */
export interface StaticCheck {
  /** Stable check id, e.g. `tools/spawn-loop`. */
  readonly id: string;
  readonly category: Category;
  /** The check's own built-in default severity (overridable by policy). */
  readonly severity: Severity;
  /**
   * Pure evaluation function. Single-agent checks ignore `fleet`; fleet-level
   * checks use it to compare across agents. `options` is this check's
   * resolved policy `options` (from `PolicyEntry.options`), `undefined` when
   * the policy has none configured; checks that need a configurable
   * threshold (e.g. `tools/over-broad`'s `maxTools`) read it here and fall
   * back to their own built-in default when absent. Never throws.
   */
  run(
    agent: ParsedDefinition,
    fleet: readonly ParsedDefinition[],
    options?: Record<string, unknown>,
  ): Finding[];
}

/** A single static-check result. */
export interface Finding {
  /** The id of the check that produced this finding. */
  readonly check: string;
  /** The *effective* severity (policy override applied, if any). */
  readonly severity: Severity;
  readonly message: string;
  /** Advisory-only suggested-fix text. There is no apply path for this. */
  readonly suggestion?: string;
}

/** A single check id's resolved policy entry. */
export interface PolicyEntry {
  readonly enabled: boolean;
  readonly severity: Severity;
  readonly options?: Record<string, unknown>;
}

/**
 * Resolved policy for the full check set, keyed by check id. Produced by the
 * config store (a later task) and consumed by `runChecks`. Modeled as a
 * `ReadonlyMap`, matching the prevailing style for config-shaped lookups
 * elsewhere in the codebase (see `ConventionRules`'s readonly fields).
 */
export type EffectivePolicy = ReadonlyMap<string, PolicyEntry>;
