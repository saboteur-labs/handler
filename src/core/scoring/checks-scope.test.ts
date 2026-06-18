import { describe, expect, it } from 'vitest';

import type { RunActivity, ToolCall } from './activity';
import { scopeChecks } from './checks-scope';
import type { ToolScope } from './scope';

function activity(...names: string[]): RunActivity {
  const toolCalls: ToolCall[] = names.map((name) => ({ name, input: {} }));
  return { toolCalls, denials: 0, errors: 0, cwd: '/r' };
}

const declared = (...tools: string[]): ToolScope => ({
  declared: true,
  granted: new Set(tools),
});

const undeclared: ToolScope = { declared: false, granted: new Set() };

describe('scopeChecks', () => {
  it('passes when every used tool is granted, and reports unused grants', () => {
    const checks = scopeChecks(activity('Read', 'Read'), declared('Read', 'Edit', 'Bash'));
    expect(checks.applicable).toBe(true);
    expect(checks.undeclaredScope).toBe(false);
    expect(checks.unauthorizedTools).toEqual([]);
    expect(checks.unusedTools).toEqual(['Bash', 'Edit']);
  });

  it('flags a used tool that the scope does not grant', () => {
    const checks = scopeChecks(activity('Read', 'Bash'), declared('Read'));
    expect(checks.unauthorizedTools).toEqual(['Bash']);
  });

  it('reports no unused tools when all grants are exercised', () => {
    expect(scopeChecks(activity('Read', 'Edit'), declared('Read', 'Edit')).unusedTools).toEqual([]);
  });

  it('marks scope checks not-applicable and surfaces undeclared scope', () => {
    const checks = scopeChecks(activity('Read', 'Bash'), undeclared);
    expect(checks.applicable).toBe(false);
    expect(checks.undeclaredScope).toBe(true);
    expect(checks.unauthorizedTools).toEqual([]);
    expect(checks.unusedTools).toEqual([]);
  });

  it('sorts results deterministically and de-duplicates used tools', () => {
    const checks = scopeChecks(activity('Write', 'Write', 'Read'), declared('Read'));
    expect(checks.unauthorizedTools).toEqual(['Write']);
  });
});
