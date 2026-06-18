/**
 * Conventions staleness evaluation (spec Req 18).
 *
 * Given a loaded artifact (or a `missing` sentinel), decide whether the
 * conventions are stale and why. Conventions are stale when the artifact is
 * absent, when its recorded `sourceHash` no longer matches the rule set it was
 * distilled from (a hand-edited or corrupt artifact), or when its `lastSynced`
 * timestamp is older than the {@link STALE_TTL_DAYS} TTL. A stale result tells
 * the CLI to instruct the user to re-run the sync skill; handler never fetches.
 *
 * `hashRules` is the integrity contract between handler and the sync skill: the
 * skill records `sourceHash = hashRules(rules)` when it writes the artifact, and
 * this module recomputes it to detect tampering. Cross-machine clock skew is out
 * of scope.
 */
import { createHash } from 'node:crypto';

import type { ConventionRules, LoadedConventions } from './conventions-store';

/** Refresh interval before conventions are considered stale. */
export const STALE_TTL_DAYS = 30;

const TTL_MS = STALE_TTL_DAYS * 86_400_000;

export type StalenessState = 'missing' | 'hash-mismatch' | 'expired' | 'fresh';

/**
 * Canonical integrity hash over a rule set. Deterministic for equal rules
 * regardless of key order, so re-syncing unchanged docs yields a stable hash.
 */
export function hashRules(rules: ConventionRules): string {
  const canonical = JSON.stringify({
    allowedKeys: rules.allowedKeys,
    cuePatterns: rules.cuePatterns,
    descriptionMinLength: rules.descriptionMinLength,
    requiredKeys: rules.requiredKeys,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Evaluate the staleness state of the loaded conventions. */
export function evaluateStaleness(
  loaded: LoadedConventions,
  now: Date = new Date(),
): StalenessState {
  if (loaded.status === 'missing') {
    return 'missing';
  }
  const { artifact } = loaded;
  if (hashRules(artifact.rules) !== artifact.sourceHash) {
    return 'hash-mismatch';
  }
  if (isExpired(artifact.lastSynced, now)) {
    return 'expired';
  }
  return 'fresh';
}

/** True when `lastSynced` is unparseable or older than the TTL relative to `now`. */
function isExpired(lastSynced: string, now: Date): boolean {
  const synced = Date.parse(lastSynced);
  if (Number.isNaN(synced)) {
    return true;
  }
  return now.getTime() - synced > TTL_MS;
}
