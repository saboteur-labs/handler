import { describe, expect, it } from 'vitest';

import type { Finding, StaticCheck } from './check';
import type { ParsedDefinition } from './parse';

function stubAgent(): ParsedDefinition {
  return {
    name: 'reviewer',
    description: 'Reviews code',
    model: undefined,
    scope: { declared: false, granted: new Set(), spawnTargets: new Set() },
    body: 'You review code.',
    hasFrontmatter: true,
  };
}

describe('StaticCheck / Finding shape', () => {
  it('a stub check emits a well-formed finding, with fleet arg ignored', () => {
    const check: StaticCheck = {
      id: 'tools/stub',
      category: 'tools',
      severity: 'warn',
      run: (agent): Finding[] => [
        {
          check: 'tools/stub',
          severity: 'warn',
          message: `stub finding for ${agent.name}`,
          suggestion: 'consider doing something else',
        },
      ],
    };

    const agent = stubAgent();
    const findings = check.run(agent, [agent]);

    expect(findings).toEqual([
      {
        check: 'tools/stub',
        severity: 'warn',
        message: 'stub finding for reviewer',
        suggestion: 'consider doing something else',
      },
    ]);
  });

  it('suggestion is optional', () => {
    const finding: Finding = { check: 'x', severity: 'info', message: 'no suggestion here' };
    expect(finding.suggestion).toBeUndefined();
  });
});
