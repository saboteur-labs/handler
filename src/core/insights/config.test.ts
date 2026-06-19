/**
 * Tests for insights thresholds & config.
 * Spec: Task 1 of V1 Feature 4 (Roster-level insights), Req 8.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_INSIGHTS_FAIL_SCORE,
  DEFAULT_INSIGHTS_RECENCY_DAYS,
  DEFAULT_MIN_RUNS,
  DEFAULT_OUTLIER_FACTOR,
  getInsightsFailScore,
  getInsightsRecencyDays,
  getMinRuns,
  getOutlierFactor,
} from './config';

describe('DEFAULT_INSIGHTS_RECENCY_DAYS', () => {
  it('is 30', () => {
    expect(DEFAULT_INSIGHTS_RECENCY_DAYS).toBe(30);
  });
});

describe('getInsightsRecencyDays()', () => {
  const ENV_VAR = 'HANDLER_INSIGHTS_RECENCY_DAYS';

  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('returns the default when env var is absent', () => {
    expect(getInsightsRecencyDays()).toBe(DEFAULT_INSIGHTS_RECENCY_DAYS);
  });

  it('returns the parsed value when env var is a valid positive integer', () => {
    process.env[ENV_VAR] = '14';
    expect(getInsightsRecencyDays()).toBe(14);
  });

  it('returns the default when env var is a non-numeric string', () => {
    process.env[ENV_VAR] = 'abc';
    expect(getInsightsRecencyDays()).toBe(DEFAULT_INSIGHTS_RECENCY_DAYS);
  });

  it('returns the default when env var is zero', () => {
    process.env[ENV_VAR] = '0';
    expect(getInsightsRecencyDays()).toBe(DEFAULT_INSIGHTS_RECENCY_DAYS);
  });

  it('returns the default when env var is a negative number', () => {
    process.env[ENV_VAR] = '-5';
    expect(getInsightsRecencyDays()).toBe(DEFAULT_INSIGHTS_RECENCY_DAYS);
  });

  it('returns the default when env var is a float that rounds to zero', () => {
    process.env[ENV_VAR] = '0.9';
    expect(getInsightsRecencyDays()).toBe(DEFAULT_INSIGHTS_RECENCY_DAYS);
  });

  it('accepts a large positive integer', () => {
    process.env[ENV_VAR] = '365';
    expect(getInsightsRecencyDays()).toBe(365);
  });
});

describe('DEFAULT_INSIGHTS_FAIL_SCORE', () => {
  it('is 50', () => {
    expect(DEFAULT_INSIGHTS_FAIL_SCORE).toBe(50);
  });
});

describe('getInsightsFailScore()', () => {
  const ENV_VAR = 'HANDLER_INSIGHTS_FAIL_SCORE';

  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('returns the default when env var is absent', () => {
    expect(getInsightsFailScore()).toBe(DEFAULT_INSIGHTS_FAIL_SCORE);
  });

  it('returns the parsed value when env var is a valid value in 0–100 range', () => {
    process.env[ENV_VAR] = '75';
    expect(getInsightsFailScore()).toBe(75);
  });

  it('accepts 0 as a valid threshold', () => {
    process.env[ENV_VAR] = '0';
    expect(getInsightsFailScore()).toBe(0);
  });

  it('accepts 100 as a valid threshold', () => {
    process.env[ENV_VAR] = '100';
    expect(getInsightsFailScore()).toBe(100);
  });

  it('returns the default when env var is a non-numeric string', () => {
    process.env[ENV_VAR] = 'bad';
    expect(getInsightsFailScore()).toBe(DEFAULT_INSIGHTS_FAIL_SCORE);
  });

  it('returns the default when env var is below 0', () => {
    process.env[ENV_VAR] = '-1';
    expect(getInsightsFailScore()).toBe(DEFAULT_INSIGHTS_FAIL_SCORE);
  });

  it('returns the default when env var exceeds 100', () => {
    process.env[ENV_VAR] = '101';
    expect(getInsightsFailScore()).toBe(DEFAULT_INSIGHTS_FAIL_SCORE);
  });
});

describe('re-exported Tier B constants and getters', () => {
  it('re-exports DEFAULT_MIN_RUNS from tier-b', () => {
    expect(DEFAULT_MIN_RUNS).toBe(5);
  });

  it('re-exports DEFAULT_OUTLIER_FACTOR from tier-b', () => {
    expect(DEFAULT_OUTLIER_FACTOR).toBe(2);
  });

  it('re-exports getMinRuns() from tier-b', () => {
    expect(typeof getMinRuns).toBe('function');
    expect(getMinRuns()).toBe(DEFAULT_MIN_RUNS);
  });

  it('re-exports getOutlierFactor() from tier-b', () => {
    expect(typeof getOutlierFactor).toBe('function');
    expect(getOutlierFactor()).toBe(DEFAULT_OUTLIER_FACTOR);
  });
});
