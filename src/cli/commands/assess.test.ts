import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../index';

function def(opts: {
  readonly name: string;
  readonly description?: string;
  readonly tools?: string;
  readonly body?: string;
}): string {
  const lines = ['---', `name: ${opts.name}`];
  const description = opts.description ?? 'Use when the user needs this agent for work.';
  lines.push(`description: ${description}`);
  if (opts.tools !== undefined) {
    lines.push(`tools: ${opts.tools}`);
  }
  lines.push('---');
  lines.push(opts.body ?? 'You are a helpful agent that does its one job well.');
  return lines.join('\n');
}

describe('handler CLI: assess command family (feature-static-assessment FR-1, FR-21-23)', () => {
  let dir: string;
  let registryPath: string;
  let userConfigPath: string;
  let repo: string;
  let agentsDir: string;
  let out: string[];

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-assess-cli-')));
    registryPath = join(dir, 'sources.json');
    userConfigPath = join(dir, 'user-config.json');
    repo = join(dir, 'repo');
    agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, { registryPath, userConfigPath, out: (line) => out.push(line) });

  /** Writes a fixture fleet with one finding in each of the three categories. */
  function writeMultiCategoryFleet(): void {
    // tools/spawn-loop (error): self-spawn.
    writeFileSync(
      join(agentsDir, 'looper.md'),
      def({
        name: 'looper',
        tools: 'Agent(looper)',
        body: 'You are a looping agent, on purpose.',
      }),
      'utf8',
    );
    // prompt/empty-body (error): frontmatter present, empty body.
    writeFileSync(
      join(agentsDir, 'empty.md'),
      '---\nname: empty\ndescription: does nothing\n---\n',
      'utf8',
    );
    // fleet/duplicate-trigger (warn): near-identical descriptions.
    const sharedDescription =
      'Use when the user wants a thorough review of changed code before merge for quality control.';
    writeFileSync(
      join(agentsDir, 'reviewer-a.md'),
      def({
        name: 'reviewer-a',
        description: sharedDescription,
        body: 'You review changes carefully, line by line.',
      }),
      'utf8',
    );
    writeFileSync(
      join(agentsDir, 'reviewer-b.md'),
      def({
        name: 'reviewer-b',
        description: sharedDescription,
        body: 'You audit diffs for correctness and safety.',
      }),
      'utf8',
    );
  }

  it('runs all categories on bare `assess`', async () => {
    writeMultiCategoryFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess']);
    const report = out.join('\n');

    expect(report).toContain('tools/spawn-loop');
    expect(report).toContain('prompt/empty-body');
    expect(report).toContain('fleet/duplicate-trigger');
  });

  it('`assess tools` runs only the tools category', async () => {
    writeMultiCategoryFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess', 'tools']);
    const report = out.join('\n');

    expect(report).toContain('tools/spawn-loop');
    expect(report).not.toContain('prompt/empty-body');
    expect(report).not.toContain('fleet/duplicate-trigger');
  });

  it('`assess prompt` runs only the prompt category', async () => {
    writeMultiCategoryFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess', 'prompt']);
    const report = out.join('\n');

    expect(report).not.toContain('tools/spawn-loop');
    expect(report).toContain('prompt/empty-body');
    expect(report).not.toContain('fleet/duplicate-trigger');
  });

  it('`assess fleet` runs only the fleet category', async () => {
    writeMultiCategoryFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess', 'fleet']);
    const report = out.join('\n');

    expect(report).not.toContain('tools/spawn-loop');
    expect(report).not.toContain('prompt/empty-body');
    expect(report).toContain('fleet/duplicate-trigger');
  });

  it('prints a clear "no findings" line for a clean agent', async () => {
    writeFileSync(join(agentsDir, 'clean.md'), def({ name: 'clean' }), 'utf8');
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess']);
    const report = out.join('\n');
    expect(report).toContain('clean');
    expect(report).toMatch(/no findings/);
  });

  it('always prints a suppressed-findings footer, even with nothing suppressed', async () => {
    // Include an <example> block so prompt/no-examples (disabled by default)
    // has nothing to fire on — otherwise it would itself be suppressed and
    // the count would be nonzero, which is not what this test is checking.
    writeFileSync(
      join(agentsDir, 'clean.md'),
      def({
        name: 'clean',
        body: 'You are a clean agent.\n\n<example>\nExample usage.\n</example>',
      }),
      'utf8',
    );
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess']);
    const report = out.join('\n');
    expect(report).toMatch(/suppressed: 0/);
  });

  it('reflects a suppressed check (prompt/no-examples, off by default) in the footer', async () => {
    writeFileSync(
      join(agentsDir, 'plain.md'),
      def({
        name: 'plain',
        body: 'You are a plain agent with no examples in the body at all here.',
      }),
      'utf8',
    );
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess']);
    const report = out.join('\n');
    expect(report).toMatch(/suppressed: 1 \(prompt\/no-examples\)/);
    expect(report).toContain('no findings');
    expect(report).not.toContain('(suppressed)');
  });

  it('`--all` surfaces suppressed findings, visually marked', async () => {
    writeFileSync(
      join(agentsDir, 'plain.md'),
      def({
        name: 'plain',
        body: 'You are a plain agent with no examples in the body at all here.',
      }),
      'utf8',
    );
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess', '--all']);
    const report = out.join('\n');
    expect(report).toContain('prompt/no-examples');
    expect(report).toContain('(suppressed)');
  });

  it('exits 0 by default when only a warn-level finding trips', async () => {
    writeMultiCategoryFleet();
    // Remove the two error-severity agents, leaving only the warn-level fleet finding.
    rmSync(join(agentsDir, 'looper.md'));
    rmSync(join(agentsDir, 'empty.md'));
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['assess'])).toBe(0);
  });

  it('exits 1 under --fail-on warn when a warn-level finding trips', async () => {
    writeMultiCategoryFleet();
    rmSync(join(agentsDir, 'looper.md'));
    rmSync(join(agentsDir, 'empty.md'));
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['assess', '--fail-on', 'warn'])).toBe(1);
  });

  it('exits 1 under default --fail-on (error) when an error-level finding trips', async () => {
    writeMultiCategoryFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['assess'])).toBe(1);
  });

  it('exits 0 when --fail-on is raised above the tripped severity', async () => {
    writeMultiCategoryFleet();
    rmSync(join(agentsDir, 'looper.md'));
    rmSync(join(agentsDir, 'empty.md'));
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['assess', '--fail-on', 'error'])).toBe(0);
  });

  it('does not let suppressed findings affect the exit code even under --fail-on info', async () => {
    writeFileSync(
      join(agentsDir, 'plain.md'),
      def({
        name: 'plain',
        body: 'You are a plain agent with no examples in the body at all here.',
      }),
      'utf8',
    );
    await invoke(['source', 'register', repo]);
    out.length = 0;

    // prompt/no-examples (info) is suppressed by default policy — it must
    // never influence the exit code, even at the most permissive threshold.
    expect(await invoke(['assess', '--fail-on', 'info'])).toBe(0);
  });

  it('rejects an invalid --fail-on value', async () => {
    writeFileSync(join(agentsDir, 'clean.md'), def({ name: 'clean' }), 'utf8');
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['assess', '--fail-on', 'bogus'])).toBe(1);
  });

  it('does not leak a previous run’s non-zero exit code into a later clean run', async () => {
    writeMultiCategoryFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['assess'])).toBe(1);

    rmSync(join(agentsDir, 'looper.md'));
    rmSync(join(agentsDir, 'empty.md'));
    rmSync(join(agentsDir, 'reviewer-a.md'));
    rmSync(join(agentsDir, 'reviewer-b.md'));
    writeFileSync(join(agentsDir, 'clean.md'), def({ name: 'clean' }), 'utf8');

    expect(await invoke(['assess'])).toBe(0);
  });

  it('signals the exit code via the return value without mutating the global process.exitCode', async () => {
    writeMultiCategoryFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    // A caller-set process.exitCode must survive a failing run untouched — the
    // fail-on signal rides the run-scoped return value, not the global.
    const previous = process.exitCode;
    process.exitCode = 42;
    try {
      expect(await invoke(['assess'])).toBe(1);
      expect(process.exitCode).toBe(42);
    } finally {
      process.exitCode = previous;
    }
  });
});
