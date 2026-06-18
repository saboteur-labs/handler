import { describe, expect, it } from 'vitest';

import type { RunActivity, ToolCall } from './activity';
import { boundaryChecks } from './checks-boundary';

const CWD = '/home/u/repo';

function activity(...toolCalls: ToolCall[]): RunActivity {
  return { toolCalls, denials: 0, errors: 0, cwd: CWD };
}

const write = (file_path: string): ToolCall => ({ name: 'Write', input: { file_path } });
const bash = (command: string): ToolCall => ({ name: 'Bash', input: { command } });

describe('boundaryChecks', () => {
  it('does not flag a write inside the cwd subtree', () => {
    expect(boundaryChecks(activity(write(`${CWD}/src/a.ts`)), CWD).violations).toEqual([]);
    expect(boundaryChecks(activity(write('src/a.ts')), CWD).violations).toEqual([]);
  });

  it('flags a write to an absolute path outside the subtree', () => {
    const { violations } = boundaryChecks(activity(write('/etc/passwd')), CWD);
    expect(violations).toEqual([{ tool: 'Write', path: '/etc/passwd' }]);
  });

  it('flags a write that escapes via a relative path', () => {
    const { violations } = boundaryChecks(activity(write('../sibling/x.ts')), CWD);
    expect(violations).toEqual([{ tool: 'Write', path: '/home/u/sibling/x.ts' }]);
  });

  it('never flags reads', () => {
    const read: ToolCall = { name: 'Read', input: { file_path: '/etc/hosts' } };
    expect(boundaryChecks(activity(read), CWD).violations).toEqual([]);
  });

  it('flags destructive Bash targeting outside the subtree', () => {
    expect(boundaryChecks(activity(bash('rm -rf /tmp/out')), CWD).violations).toEqual([
      { tool: 'Bash', path: '/tmp/out' },
    ]);
    expect(boundaryChecks(activity(bash('mv a.txt /etc/x')), CWD).violations).toEqual([
      { tool: 'Bash', path: '/etc/x' },
    ]);
  });

  it('does not flag destructive Bash staying inside the subtree', () => {
    expect(boundaryChecks(activity(bash('rm -rf build')), CWD).violations).toEqual([]);
  });

  it('flags an output redirection that escapes the subtree', () => {
    expect(boundaryChecks(activity(bash('echo hi > ../out.txt')), CWD).violations).toEqual([
      { tool: 'Bash', path: '/home/u/out.txt' },
    ]);
  });

  it('ignores fd-dup and /dev redirections (real-world noise)', () => {
    expect(boundaryChecks(activity(bash('pnpm lint 2>&1')), CWD).violations).toEqual([]);
    expect(boundaryChecks(activity(bash('pnpm test 2>/dev/null')), CWD).violations).toEqual([]);
  });

  it('does not flag non-destructive Bash', () => {
    expect(boundaryChecks(activity(bash('cat /etc/hosts')), CWD).violations).toEqual([]);
  });

  it('reports nothing when the run cwd is unknown', () => {
    const noCwd: RunActivity = {
      toolCalls: [write('/etc/x')],
      denials: 0,
      errors: 0,
      cwd: undefined,
    };
    expect(boundaryChecks(noCwd, undefined).violations).toEqual([]);
  });
});
