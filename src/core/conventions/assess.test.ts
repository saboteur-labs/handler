import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { repoSource } from '../sources/source';
import { assessConventions } from './assess';
import type { ConventionsArtifact } from './conventions-store';
import { CONVENTIONS_STORE_VERSION } from './conventions-store';
import { hashRules } from './staleness';

const RULES = {
  requiredKeys: ['name', 'description'],
  allowedKeys: ['name', 'description', 'tools', 'model'],
  descriptionMinLength: 40,
  cuePatterns: ['use when', 'when the user'],
};

function cleanDef(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Use when the user wants a thorough review of changed code before merge.',
    'tools: Read, Grep',
    '---',
    'You are a reviewer.',
  ].join('\n');
}

describe('assessConventions', () => {
  let dir: string;
  let agentsDir: string;
  let conventionsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-assess-'));
    agentsDir = join(dir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    conventionsPath = join(dir, 'conventions.json');
    const artifact: ConventionsArtifact = {
      version: CONVENTIONS_STORE_VERSION,
      sourceHash: hashRules(RULES),
      lastSynced: new Date().toISOString(),
      rules: RULES,
    };
    writeFileSync(conventionsPath, JSON.stringify(artifact), 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports no violations for a clean definition and fresh staleness', () => {
    writeFileSync(join(agentsDir, 'code-reviewer.md'), cleanDef('code-reviewer'), 'utf8');
    const result = assessConventions({ sources: [repoSource(dir)], conventionsPath });

    expect(result.staleness).toBe('fresh');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.identity.name).toBe('code-reviewer');
    expect(result.agents[0]?.violations).toEqual([]);
  });

  it('reports violations for a definition that breaks the rules', () => {
    writeFileSync(join(agentsDir, 'bad-agent.md'), '---\nname: Bad_Name\n---\nbody', 'utf8');
    const result = assessConventions({ sources: [repoSource(dir)], conventionsPath });

    const agent = result.agents.find((a) => a.identity.name === 'bad-agent');
    expect(agent).toBeDefined();
    expect(agent?.violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining(['16a', '16b', '16c', '16d']),
    );
  });

  it('falls back to the shipped default when no user artifact exists', () => {
    writeFileSync(join(agentsDir, 'code-reviewer.md'), cleanDef('code-reviewer'), 'utf8');
    const result = assessConventions({
      sources: [repoSource(dir)],
      conventionsPath: join(dir, 'does-not-exist.json'),
    });

    // The shipped default supplies the rules — a fresh install gets real
    // results, not a "missing" state. The clean definition passes.
    expect(result.staleness).not.toBe('missing');
    expect(result.agents.map((a) => a.identity.name)).toEqual(['code-reviewer']);
    expect(result.agents[0]?.violations).toEqual([]);
  });

  it('returns the missing staleness state with no agents when the user artifact is corrupt', () => {
    writeFileSync(join(agentsDir, 'code-reviewer.md'), cleanDef('code-reviewer'), 'utf8');
    writeFileSync(conventionsPath, '{ not valid json', 'utf8');
    const result = assessConventions({ sources: [repoSource(dir)], conventionsPath });

    expect(result.staleness).toBe('missing');
    expect(result.agents).toEqual([]);
  });

  it('excludes builtin agents from enumeration', () => {
    writeFileSync(join(agentsDir, 'general-purpose.md'), cleanDef('general-purpose'), 'utf8');
    writeFileSync(join(agentsDir, 'code-reviewer.md'), cleanDef('code-reviewer'), 'utf8');
    const result = assessConventions({ sources: [repoSource(dir)], conventionsPath });

    expect(result.agents.map((a) => a.identity.name)).toEqual(['code-reviewer']);
  });

  it('ignores non-markdown files and a missing agents directory', () => {
    writeFileSync(join(agentsDir, 'notes.txt'), 'not an agent', 'utf8');
    const missingDir = repoSource(join(dir, 'no-such-repo'));
    const result = assessConventions({
      sources: [repoSource(dir), missingDir],
      conventionsPath,
    });

    expect(result.agents).toEqual([]);
  });
});
