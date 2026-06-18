import { describe, expect, it } from 'vitest';

import type { RunActivity, ToolCall } from './activity';
import { activityChecks } from './checks-activity';

function activity(toolCalls: ToolCall[], extra: Partial<RunActivity> = {}): RunActivity {
  return { toolCalls, denials: 0, errors: 0, cwd: '/r', ...extra };
}

const bash = (command: string): ToolCall => ({ name: 'Bash', input: { command } });

describe('activityChecks', () => {
  it('passes through denial and error counts', () => {
    const checks = activityChecks(activity([], { denials: 2, errors: 3 }), 'completed');
    expect(checks.denials).toBe(2);
    expect(checks.toolErrors).toBe(3);
  });

  it('reports terminal success only for a completed status', () => {
    expect(activityChecks(activity([]), 'completed').terminalSuccess).toBe(true);
    expect(activityChecks(activity([]), 'error').terminalSuccess).toBe(false);
    expect(activityChecks(activity([]), undefined).terminalSuccess).toBe(false);
  });

  it('flags a thrash event at three identical Bash commands, ignoring surrounding whitespace', () => {
    const checks = activityChecks(
      activity([bash('ls -la'), bash('ls -la '), bash(' ls -la')]),
      'completed',
    );
    expect(checks.thrashEvents).toBe(1);
  });

  it('does not flag thrash below three occurrences', () => {
    expect(activityChecks(activity([bash('pwd'), bash('pwd')]), 'completed').thrashEvents).toBe(0);
  });

  it('treats non-Bash args as thrash regardless of key order', () => {
    const a: ToolCall = { name: 'Grep', input: { pattern: 'x', path: '/r' } };
    const b: ToolCall = { name: 'Grep', input: { path: '/r', pattern: 'x' } };
    expect(activityChecks(activity([a, b, a]), 'completed').thrashEvents).toBe(1);
  });

  it('counts distinct thrash groups separately', () => {
    const checks = activityChecks(
      activity([bash('a'), bash('a'), bash('a'), bash('b'), bash('b'), bash('b')]),
      'completed',
    );
    expect(checks.thrashEvents).toBe(2);
  });

  it('does not conflate the same args across different tools', () => {
    const read: ToolCall = { name: 'Read', input: { file_path: '/x' } };
    const edit: ToolCall = { name: 'Edit', input: { file_path: '/x' } };
    expect(activityChecks(activity([read, read, edit, edit]), 'completed').thrashEvents).toBe(0);
  });
});
