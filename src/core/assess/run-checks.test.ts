import { describe, expect, it } from 'vitest';

import type { EffectivePolicy, Finding, StaticCheck } from './check';
import type { ParsedDefinition } from './parse';
import { runChecks } from './run-checks';

function stubAgent(overrides: Partial<ParsedDefinition> = {}): ParsedDefinition {
  return {
    name: 'reviewer',
    description: 'Reviews code',
    model: undefined,
    scope: { declared: false, granted: new Set(), spawnTargets: new Set() },
    body: 'You review code.',
    hasFrontmatter: true,
    ...overrides,
  };
}

function makeCheck(overrides: Partial<StaticCheck> = {}): StaticCheck {
  return {
    id: 'stub/check',
    category: 'prompt',
    severity: 'info',
    run: (): Finding[] => [{ check: 'stub/check', severity: 'info', message: 'stub finding' }],
    ...overrides,
  };
}

describe('runChecks', () => {
  it('runs an enabled stub check and returns its finding', () => {
    const agent = stubAgent();
    const check = makeCheck();
    const policy: EffectivePolicy = new Map();

    const findings = runChecks([check], agent, [agent], policy);

    expect(findings).toEqual([{ check: 'stub/check', severity: 'info', message: 'stub finding' }]);
  });

  it('skips a check whose policy entry is disabled', () => {
    const agent = stubAgent();
    const check = makeCheck();
    const policy: EffectivePolicy = new Map([['stub/check', { enabled: false, severity: 'info' }]]);

    const findings = runChecks([check], agent, [agent], policy);

    expect(findings).toEqual([]);
  });

  it('stamps findings with the effective (policy-overridden) severity', () => {
    const agent = stubAgent();
    const check = makeCheck({ severity: 'info' });
    const policy: EffectivePolicy = new Map([['stub/check', { enabled: true, severity: 'error' }]]);

    const findings = runChecks([check], agent, [agent], policy);

    expect(findings).toEqual([{ check: 'stub/check', severity: 'error', message: 'stub finding' }]);
  });

  it('falls back to the check own default severity and enabled=true when absent from policy', () => {
    const agent = stubAgent();
    const check = makeCheck({ severity: 'warn' });
    const policy: EffectivePolicy = new Map();

    const findings = runChecks([check], agent, [agent], policy);

    expect(findings).toEqual([{ check: 'stub/check', severity: 'warn', message: 'stub finding' }]);
  });

  it('flattens findings across multiple checks', () => {
    const agent = stubAgent();
    const checkA = makeCheck({
      id: 'a',
      run: (): Finding[] => [{ check: 'a', severity: 'info', message: 'a finding' }],
    });
    const checkB = makeCheck({
      id: 'b',
      severity: 'warn',
      run: (): Finding[] => [{ check: 'b', severity: 'warn', message: 'b finding' }],
    });
    const policy: EffectivePolicy = new Map();

    const findings = runChecks([checkA, checkB], agent, [agent], policy);

    expect(findings).toEqual([
      { check: 'a', severity: 'info', message: 'a finding' },
      { check: 'b', severity: 'warn', message: 'b finding' },
    ]);
  });
});
