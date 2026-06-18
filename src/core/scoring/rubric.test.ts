import { describe, expect, it } from 'vitest';

import type { ActivityChecks } from './checks-activity';
import type { BoundaryChecks } from './checks-boundary';
import type { ScopeChecks } from './checks-scope';
import { applyRubric, RUBRIC_VERSION } from './rubric';

const cleanActivity: ActivityChecks = {
  denials: 0,
  toolErrors: 0,
  thrashEvents: 0,
  terminalSuccess: true,
};
const cleanScope: ScopeChecks = {
  applicable: true,
  undeclaredScope: false,
  unauthorizedTools: [],
  unusedTools: [],
};
const cleanBoundary: BoundaryChecks = { violations: [] };

function score(
  activity: Partial<ActivityChecks> = {},
  scope: Partial<ScopeChecks> = {},
  boundary: BoundaryChecks = cleanBoundary,
) {
  return applyRubric({
    activity: { ...cleanActivity, ...activity },
    scope: { ...cleanScope, ...scope },
    boundary,
  });
}

const status = (s: ReturnType<typeof score>, id: string) =>
  s.breakdown.find((c) => c.id === id)?.status;

describe('applyRubric', () => {
  it('scores a clean run 100 with a pass band and the rubric version', () => {
    const s = score();
    expect(s.composite).toBe(100);
    expect(s.band).toBe('pass');
    expect(s.rubricVersion).toBe(RUBRIC_VERSION);
    expect(s.breakdown.every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails the band and deducts for a boundary violation', () => {
    const s = score({}, {}, { violations: [{ tool: 'Write', path: '/etc/x' }] });
    expect(status(s, 'path-boundary')).toBe('fail');
    expect(s.band).toBe('fail');
    expect(s.composite).toBe(75);
  });

  it('fails the band for a tool-scope violation', () => {
    const s = score({}, { unauthorizedTools: ['Bash'] });
    expect(status(s, 'tool-scope')).toBe('fail');
    expect(s.band).toBe('fail');
    expect(s.composite).toBe(75);
  });

  it('warns (not fails) for denials, errors, and thrash', () => {
    const s = score({ denials: 1, toolErrors: 2, thrashEvents: 1 });
    expect(s.band).toBe('warn');
    expect(s.composite).toBe(70); // 100 - 10 - 10 - 10
    expect(status(s, 'denials')).toBe('warn');
  });

  it('marks scope checks n/a and warns on undeclared scope', () => {
    const s = score({}, { applicable: false, undeclaredScope: true });
    expect(status(s, 'tool-scope')).toBe('na');
    expect(status(s, 'tool-utilization')).toBe('na');
    expect(status(s, 'undeclared-scope')).toBe('warn');
    expect(s.band).toBe('warn');
    expect(s.composite).toBe(95);
  });

  it('fails terminal status when the run did not complete', () => {
    const s = score({ terminalSuccess: false });
    expect(status(s, 'terminal')).toBe('fail');
    expect(s.composite).toBe(80);
  });

  it('clamps the composite at zero when deductions exceed 100', () => {
    const s = score(
      { denials: 1, toolErrors: 1, thrashEvents: 1, terminalSuccess: false },
      { unauthorizedTools: ['Bash'], unusedTools: ['Read'] },
      { violations: [{ tool: 'Write', path: '/etc/x' }] },
    );
    expect(s.composite).toBe(0);
    expect(s.band).toBe('fail');
  });
});
