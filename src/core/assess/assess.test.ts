import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { repoSource, userSource } from '../sources/source';
import { assess } from './assess';

function def(opts: {
  readonly name: string;
  readonly description?: string;
  readonly tools?: string;
  readonly body?: string;
}): string {
  const lines = ['---', `name: ${opts.name}`];
  lines.push(`description: ${opts.description ?? 'Use when the user needs this agent.'}`);
  if (opts.tools !== undefined) {
    lines.push(`tools: ${opts.tools}`);
  }
  lines.push('---');
  lines.push(opts.body ?? 'You are a helpful agent that does its one job well.');
  return lines.join('\n');
}

describe('assess', () => {
  let dir: string;
  let agentsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-assess-static-'));
    agentsDir = join(dir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces findings across tools, prompt, and fleet categories in one call', () => {
    // tools/spawn-loop + tools/over-broad (wildcard): self-spawning, wildcard tools.
    writeFileSync(
      join(agentsDir, 'looper.md'),
      def({
        name: 'looper',
        tools: '*, Agent(looper)',
        body: 'You are a looping agent with a real body.',
      }),
      'utf8',
    );
    // prompt/empty-body: frontmatter present, no body.
    writeFileSync(
      join(agentsDir, 'empty.md'),
      '---\nname: empty\ndescription: does nothing\n---\n',
      'utf8',
    );
    // fleet/duplicate-trigger: near-identical descriptions to another agent.
    const sharedDescription =
      'Use when the user wants a thorough review of changed code before merge for quality.';
    writeFileSync(
      join(agentsDir, 'reviewer-a.md'),
      def({ name: 'reviewer-a', description: sharedDescription }),
      'utf8',
    );
    writeFileSync(
      join(agentsDir, 'reviewer-b.md'),
      def({ name: 'reviewer-b', description: sharedDescription }),
      'utf8',
    );

    const result = assess({ sources: [repoSource(dir)] });

    const byName = (name: string): (typeof result.agents)[number] | undefined =>
      result.agents.find((a) => a.identity.name === name);

    const looper = byName('looper');
    expect(looper).toBeDefined();
    expect(looper?.findings.map((f) => f.check)).toEqual(
      expect.arrayContaining(['tools/spawn-loop', 'tools/over-broad']),
    );

    const empty = byName('empty');
    expect(empty?.findings.map((f) => f.check)).toEqual(
      expect.arrayContaining(['prompt/empty-body']),
    );

    const reviewerA = byName('reviewer-a');
    expect(reviewerA?.findings.map((f) => f.check)).toEqual(
      expect.arrayContaining(['fleet/duplicate-trigger']),
    );
  });

  it('reports an orphan agent without crashing and excludes it from the fleet', () => {
    // A broken symlink: `enumerateDefinitionNames` (readdirSync) lists the
    // `.md` stem, but `loadDefinitionSnapshot` (readFileSync, following the
    // link) fails with ENOENT — the real orphan path (definition vanished
    // between enumeration and load), exercised without a race.
    writeFileSync(join(agentsDir, 'real.md'), def({ name: 'real' }), 'utf8');
    symlinkSync(join(agentsDir, 'does-not-exist-target'), join(agentsDir, 'ghost.md'));

    const result = assess({ sources: [repoSource(dir)] });

    const ghost = result.agents.find((a) => a.identity.name === 'ghost');
    expect(ghost).toBeDefined();
    expect(ghost?.orphan).toBe(true);
    expect(ghost?.findings).toEqual([]);
    expect(ghost?.suppressedFindings).toEqual([]);

    // Excluded from the fleet: e.g. it cannot be a `fleet/duplicate-definition`
    // participant, and the real agent's own findings are unaffected by its presence.
    const real = result.agents.find((a) => a.identity.name === 'real');
    expect(real?.orphan).toBe(false);
  });

  it('excludes builtin agents from the fleet and findings', () => {
    writeFileSync(join(agentsDir, 'general-purpose.md'), def({ name: 'general-purpose' }), 'utf8');
    writeFileSync(join(agentsDir, 'real-agent.md'), def({ name: 'real-agent' }), 'utf8');

    const result = assess({ sources: [repoSource(dir)] });

    expect(result.agents.map((a) => a.identity.name)).toEqual(['real-agent']);
  });

  it('surfaces a suppressed check in the summary but not in the agent findings', () => {
    // prompt/no-examples ships disabled by default (FR-13) — a body with no
    // <example> block would fire it if enabled, but it must not appear in
    // `findings`, only in `suppressedFindings` and the run-level summary.
    writeFileSync(
      join(agentsDir, 'plain.md'),
      def({ name: 'plain', body: 'You are a plain agent with no examples in the body at all.' }),
      'utf8',
    );

    const result = assess({ sources: [repoSource(dir)] });

    const plain = result.agents.find((a) => a.identity.name === 'plain');
    expect(plain).toBeDefined();
    expect(plain?.findings.map((f) => f.check)).not.toContain('prompt/no-examples');
    expect(plain?.suppressedFindings.map((f) => f.check)).toContain('prompt/no-examples');
    expect(result.suppressedSummary.checkIds).toContain('prompt/no-examples');
    expect(result.suppressedSummary.count).toBeGreaterThan(0);
  });

  it('does not mutate the filesystem (read-only)', () => {
    writeFileSync(join(agentsDir, 'stable.md'), def({ name: 'stable' }), 'utf8');
    const before = readdirSync(agentsDir).sort();

    assess({ sources: [repoSource(dir)] });

    const after = readdirSync(agentsDir).sort();
    expect(after).toEqual(before);
  });

  it('fires fleet/duplicate-definition across two different real AgentSources sharing a name', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'handler-assess-static-repo-'));
    const repoAgentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(repoAgentsDir, { recursive: true });

    const userDir = mkdtempSync(join(tmpdir(), 'handler-assess-static-user-'));
    const userAgentsDir = join(userDir, '.claude', 'agents');
    mkdirSync(userAgentsDir, { recursive: true });

    try {
      writeFileSync(join(repoAgentsDir, 'dup.md'), def({ name: 'dup' }), 'utf8');
      writeFileSync(join(userAgentsDir, 'dup.md'), def({ name: 'dup' }), 'utf8');

      const result = assess({ sources: [repoSource(repoDir), userSource(userDir)] });

      const dupEntries = result.agents.filter((a) => a.identity.name === 'dup');
      expect(dupEntries).toHaveLength(2);
      const fired = dupEntries.some((entry) =>
        entry.findings.some((f) => f.check === 'fleet/duplicate-definition'),
      );
      expect(fired).toBe(true);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(userDir, { recursive: true, force: true });
    }
  });
});
