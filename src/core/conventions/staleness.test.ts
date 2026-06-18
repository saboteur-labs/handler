import { describe, expect, it } from 'vitest';

import type { ConventionRules, LoadedConventions } from './conventions-store';
import { CONVENTIONS_STORE_VERSION } from './conventions-store';
import { STALE_TTL_DAYS, evaluateStaleness, hashRules } from './staleness';

const RULES: ConventionRules = {
  requiredKeys: ['name', 'description'],
  allowedKeys: ['name', 'description', 'tools', 'model'],
  descriptionMinLength: 40,
  cuePatterns: ['use when', 'when the user'],
};

const NOW = new Date('2026-06-17T00:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function loaded(
  overrides: Partial<{ sourceHash: string; lastSynced: string }> = {},
): LoadedConventions {
  return {
    status: 'loaded',
    artifact: {
      version: CONVENTIONS_STORE_VERSION,
      sourceHash: overrides.sourceHash ?? hashRules(RULES),
      lastSynced: overrides.lastSynced ?? daysAgo(1),
      rules: RULES,
    },
  };
}

describe('hashRules', () => {
  it('is deterministic for the same rule set', () => {
    expect(hashRules(RULES)).toBe(hashRules({ ...RULES }));
  });

  it('changes when the rule set changes', () => {
    expect(hashRules(RULES)).not.toBe(hashRules({ ...RULES, descriptionMinLength: 41 }));
  });
});

describe('evaluateStaleness', () => {
  it('returns missing when the artifact is absent', () => {
    expect(evaluateStaleness({ status: 'missing', reason: 'absent' }, NOW)).toBe('missing');
  });

  it('returns fresh for a matching hash within the TTL', () => {
    expect(evaluateStaleness(loaded(), NOW)).toBe('fresh');
  });

  it('returns hash-mismatch when the stored hash does not match the rule set', () => {
    expect(evaluateStaleness(loaded({ sourceHash: 'tampered' }), NOW)).toBe('hash-mismatch');
  });

  it('returns expired when lastSynced is older than the TTL', () => {
    expect(evaluateStaleness(loaded({ lastSynced: daysAgo(STALE_TTL_DAYS + 1) }), NOW)).toBe(
      'expired',
    );
  });

  it('treats exactly the TTL boundary as fresh', () => {
    expect(evaluateStaleness(loaded({ lastSynced: daysAgo(STALE_TTL_DAYS) }), NOW)).toBe('fresh');
  });

  it('checks hash before TTL (a tampered, expired artifact is hash-mismatch)', () => {
    expect(
      evaluateStaleness(
        loaded({ sourceHash: 'tampered', lastSynced: daysAgo(STALE_TTL_DAYS + 5) }),
        NOW,
      ),
    ).toBe('hash-mismatch');
  });

  it('treats an unparseable lastSynced as expired', () => {
    expect(evaluateStaleness(loaded({ lastSynced: 'not-a-date' }), NOW)).toBe('expired');
  });
});
