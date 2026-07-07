/**
 * Check-suppression config store + precedence resolution (feature-static-assessment
 * FR-16–20).
 *
 * `assess`'s checks are opinions, not laws — this module lets a user or a repo
 * (via a committed `.handler/config.json`) re-level or disable individual
 * checks by id, entirely outside the agent definition itself (FR-16: no
 * frontmatter key, no in-body comment — external config only).
 *
 * Mirrors `conventions-store.ts`'s versioned, degrade-to-sentinel pattern: a
 * config file carries a schema `version`, and a corrupt/unparseable/wrong-version
 * file degrades to "as if absent" rather than throwing or migrating (FR-17).
 *
 * Precedence, lowest to highest (FR-19): built-in per-check defaults (hardcoded
 * in this module — the base layer) → user config (`~/.handler/config.json`) →
 * repo config (`<repo>/.handler/config.json`, caller-supplied path). Each
 * layer merges shallowly at the field level (`enabled`/`severity`/`options`),
 * so e.g. a user's `severity` override survives a repo override that only
 * touches `enabled`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { readJsonFile } from '../store/json-store';
import type { EffectivePolicy, PolicyEntry, Severity } from './check';

/** A single check id's config-file value: shorthand string or partial object. */
export type CheckConfigValue =
  | 'off'
  | 'error'
  | 'warn'
  | 'info'
  | { enabled?: boolean; severity?: Severity; options?: Record<string, unknown> };

/** The on-disk config file shape (`~/.handler/config.json` or `<repo>/.handler/config.json`). */
export interface ConfigFile {
  readonly version: number;
  readonly checks?: Record<string, CheckConfigValue>;
}

/** Why a config load did not yield usable overrides. All degrade to "no overrides". */
export type ConfigMissingReason = 'absent' | 'malformed' | 'version-mismatch';

/** Result of loading a single config file. */
export type LoadedConfig =
  | { readonly status: 'loaded'; readonly config: ConfigFile }
  | { readonly status: 'missing'; readonly reason: ConfigMissingReason };

/**
 * Config-file schema version. Bump when the config shape changes; a file
 * written under a different version degrades to `missing`/`version-mismatch`
 * (treated as no overrides from that file) rather than being migrated.
 */
export const CONFIG_STORE_VERSION = 1;

/** Default user-level config location: `~/.handler/config.json`. */
export function defaultUserConfigPath(): string {
  return join(homedir(), '.handler', 'config.json');
}

/** A sentinel distinguishing "file absent" from a file that read as JSON `null`. */
const ABSENT = Symbol('absent');

/**
 * Load a single config file, degrading to a typed `missing` sentinel on a
 * corrupt, unparseable, or wrong-version file. Never throws.
 */
export function loadConfig(filePath: string): LoadedConfig {
  let raw: unknown;
  try {
    raw = readJsonFile<unknown>(filePath, ABSENT);
  } catch {
    return { status: 'missing', reason: 'malformed' };
  }
  if (raw === ABSENT) {
    return { status: 'missing', reason: 'absent' };
  }
  return parseConfigFile(raw);
}

function parseConfigFile(raw: unknown): LoadedConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { status: 'missing', reason: 'malformed' };
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.version !== 'number') {
    return { status: 'missing', reason: 'malformed' };
  }
  if (candidate.version !== CONFIG_STORE_VERSION) {
    return { status: 'missing', reason: 'version-mismatch' };
  }
  const checksIsInvalid =
    candidate.checks !== undefined &&
    (typeof candidate.checks !== 'object' || candidate.checks === null);
  if (checksIsInvalid) {
    return { status: 'missing', reason: 'malformed' };
  }
  return {
    status: 'loaded',
    config: {
      version: candidate.version,
      checks: candidate.checks as Record<string, CheckConfigValue> | undefined,
    },
  };
}

/**
 * Built-in per-check defaults — the base layer of the precedence chain
 * (FR-19). Check ids and default severities come straight from the spec
 * (FR-9–FR-15); the check implementations themselves are later tasks, but
 * their ids and defaults are fully specified so the config store can be
 * built and tested against them now.
 *
 * `prompt/no-examples` MUST default to disabled (FR-13, resolved decision
 * #2): example blocks are not universally warranted, so this check ships
 * registered but off, enable-able via config.
 */
const BUILTIN_POLICY_DEFAULTS: Readonly<Record<string, PolicyEntry>> = {
  'tools/spawn-loop': { enabled: true, severity: 'error' },
  'tools/redundant-wildcard': { enabled: true, severity: 'warn' },
  'tools/over-broad': { enabled: true, severity: 'info' },
  'prompt/empty-body': { enabled: true, severity: 'error' },
  'prompt/no-examples': { enabled: false, severity: 'info' },
  'prompt/size': { enabled: true, severity: 'info' },
  'fleet/duplicate-trigger': { enabled: true, severity: 'warn' },
  'fleet/duplicate-definition': { enabled: true, severity: 'info' },
};

/**
 * Fallback base entry for a check id with no built-in default (e.g. a future
 * `conventions/*` id, per FR-20's "general, keyed by check id" intent). The
 * engine must tolerate unknown ids rather than dropping them, but has no
 * severity to inherit for a check it has never heard of — `info` is chosen
 * as the least disruptive neutral severity, and `enabled: true` so an
 * unrecognized id isn't silently suppressed by default. Any explicit config
 * value for that id (shorthand or object) still overrides this immediately.
 */
const UNKNOWN_CHECK_DEFAULT: PolicyEntry = { enabled: true, severity: 'info' };

/** Parse one config check-value into a partial policy-entry override, or `null` if malformed. */
function parseCheckValue(raw: CheckConfigValue): Partial<PolicyEntry> | null {
  if (raw === 'off') {
    return { enabled: false };
  }
  if (raw === 'error' || raw === 'warn' || raw === 'info') {
    return { enabled: true, severity: raw };
  }
  if (typeof raw !== 'object' || raw === null) {
    // Intentional: skip only this malformed entry rather than degrading the whole file (finer-grained than FR-17's file-level floor).
    return null;
  }
  const override: { enabled?: boolean; severity?: Severity; options?: Record<string, unknown> } =
    {};
  if (typeof raw.enabled === 'boolean') {
    override.enabled = raw.enabled;
  }
  if (raw.severity === 'error' || raw.severity === 'warn' || raw.severity === 'info') {
    override.severity = raw.severity;
  }
  if (typeof raw.options === 'object' && raw.options !== null) {
    override.options = raw.options;
  }
  return override;
}

/** Merge a partial override onto a base `PolicyEntry`, field by field. */
function mergeEntry(
  base: PolicyEntry,
  override: Partial<PolicyEntry> | null | undefined,
): PolicyEntry {
  if (!override) {
    return base;
  }
  return {
    enabled: override.enabled ?? base.enabled,
    severity: override.severity ?? base.severity,
    options: override.options ?? base.options,
  };
}

/** Read a loaded config's `checks` map, defaulting to `{}` when absent/missing. */
function checksFrom(loaded: LoadedConfig): Record<string, CheckConfigValue> {
  return loaded.status === 'loaded' ? (loaded.config.checks ?? {}) : {};
}

export interface ResolvePolicyOptions {
  /** User-level config path. Defaults to `~/.handler/config.json`. */
  readonly userConfigPath?: string;
  /**
   * Per-repo config path. There is no default the way there is for the user
   * path — it depends on which repo — so omitting it means "no repo overrides".
   */
  readonly repoConfigPath?: string;
}

/**
 * Resolve the full `EffectivePolicy` for the check set: built-in defaults,
 * overridden by user config, overridden by repo config (FR-19). Covers every
 * built-in-defaulted id plus any id mentioned only in user/repo config (see
 * `UNKNOWN_CHECK_DEFAULT`).
 */
export function resolvePolicy(options: ResolvePolicyOptions = {}): EffectivePolicy {
  const userConfig = loadConfig(options.userConfigPath ?? defaultUserConfigPath());
  const repoConfig = options.repoConfigPath
    ? loadConfig(options.repoConfigPath)
    : ({ status: 'missing', reason: 'absent' } as const);

  const userChecks = checksFrom(userConfig);
  const repoChecks = checksFrom(repoConfig);

  const ids = new Set<string>([
    ...Object.keys(BUILTIN_POLICY_DEFAULTS),
    ...Object.keys(userChecks),
    ...Object.keys(repoChecks),
  ]);

  const resolved = new Map<string, PolicyEntry>();
  for (const id of ids) {
    const base = BUILTIN_POLICY_DEFAULTS[id] ?? UNKNOWN_CHECK_DEFAULT;
    const afterUser = mergeEntry(base, parseCheckValueSafe(userChecks[id]));
    const afterRepo = mergeEntry(afterUser, parseCheckValueSafe(repoChecks[id]));
    resolved.set(id, afterRepo);
  }
  return resolved;
}

/** `parseCheckValue`, tolerating an absent entry (no override for this id from this layer). */
function parseCheckValueSafe(raw: CheckConfigValue | undefined): Partial<PolicyEntry> | null {
  return raw === undefined ? null : parseCheckValue(raw);
}
