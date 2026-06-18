/**
 * Conventions artifact schema + offline reader store (spec Reqs 18, 19).
 *
 * The deterministic convention checks (16a–e) are parameterized by a distilled
 * conventions artifact — allowed/required frontmatter keys, the description
 * min-length, and triggering-cue patterns — so the standard stays current
 * without code changes. handler is **reader-only**: the sync skill (Reqs 18–19)
 * fetches and writes the artifact; this module only loads it, keeping handler
 * offline (no network calls).
 *
 * Mirrors `ScoreStore`/`RunStore` versioning, but unlike them a malformed or
 * wrong-version file degrades to a "missing" sentinel rather than throwing,
 * since every downstream check reads through this boundary.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { readJsonFile } from '../store/json-store';

/** Distilled rule set the convention checks (16a–e) are parameterized by. */
export interface ConventionRules {
  /** Frontmatter keys that must be present (16a). */
  readonly requiredKeys: readonly string[];
  /** Frontmatter keys that are recognized; anything else violates 16e. */
  readonly allowedKeys: readonly string[];
  /** Minimum `description` length in characters (16c). */
  readonly descriptionMinLength: number;
  /** Triggering-cue substrings; `description` must contain at least one (16c). */
  readonly cuePatterns: readonly string[];
}

/** Versioned conventions artifact, written by the sync skill, read by handler. */
export interface ConventionsArtifact {
  readonly version: number;
  /** Integrity hash over the distilled rule set (staleness detection, Req 18). */
  readonly sourceHash: string;
  /** ISO-8601 timestamp of the last successful sync (staleness TTL, Req 18). */
  readonly lastSynced: string;
  readonly rules: ConventionRules;
}

/** Why a load did not yield a usable artifact. All map to staleness `missing`. */
export type MissingReason = 'absent' | 'malformed' | 'version-mismatch';

/** Result of loading the conventions artifact. */
export type LoadedConventions =
  | { readonly status: 'loaded'; readonly artifact: ConventionsArtifact }
  | { readonly status: 'missing'; readonly reason: MissingReason };

/**
 * Conventions-artifact schema version. Bump when the artifact shape changes; a
 * file written under a different version degrades to `missing` (`version-mismatch`)
 * and the user is told to re-run the sync skill.
 */
export const CONVENTIONS_STORE_VERSION = 1;

/** Default conventions location: `~/.handler/conventions.json`. */
export function defaultConventionsPath(): string {
  return join(homedir(), '.handler', 'conventions.json');
}

/** A sentinel distinguishing "file absent" from a file that read as JSON `null`. */
const ABSENT = Symbol('absent');

/** Load the conventions artifact, degrading to a typed `missing` sentinel. */
export function loadConventions(filePath: string = defaultConventionsPath()): LoadedConventions {
  let raw: unknown;
  try {
    raw = readJsonFile<unknown>(filePath, ABSENT);
  } catch {
    // Corrupt/unreadable JSON — degrade rather than throw (every check reads through here).
    return { status: 'missing', reason: 'malformed' };
  }
  if (raw === ABSENT) {
    return { status: 'missing', reason: 'absent' };
  }
  return parseArtifact(raw);
}

function parseArtifact(raw: unknown): LoadedConventions {
  if (typeof raw !== 'object' || raw === null) {
    return { status: 'missing', reason: 'malformed' };
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.version !== 'number') {
    return { status: 'missing', reason: 'malformed' };
  }
  if (candidate.version !== CONVENTIONS_STORE_VERSION) {
    return { status: 'missing', reason: 'version-mismatch' };
  }
  if (typeof candidate.sourceHash !== 'string' || typeof candidate.lastSynced !== 'string') {
    return { status: 'missing', reason: 'malformed' };
  }
  const rules = parseRules(candidate.rules);
  if (rules === null) {
    return { status: 'missing', reason: 'malformed' };
  }
  return {
    status: 'loaded',
    artifact: {
      version: candidate.version,
      sourceHash: candidate.sourceHash,
      lastSynced: candidate.lastSynced,
      rules,
    },
  };
}

function parseRules(raw: unknown): ConventionRules | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    !isStringArray(candidate.requiredKeys) ||
    !isStringArray(candidate.allowedKeys) ||
    typeof candidate.descriptionMinLength !== 'number' ||
    !isStringArray(candidate.cuePatterns)
  ) {
    return null;
  }
  return {
    requiredKeys: candidate.requiredKeys,
    allowedKeys: candidate.allowedKeys,
    descriptionMinLength: candidate.descriptionMinLength,
    cuePatterns: candidate.cuePatterns,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
