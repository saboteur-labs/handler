import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentIdentity, identityKey } from '../identity';
import { repoSource } from '../sources/source';
import { enumerateAgentDescriptors } from './roster';

function def(name: string): string {
  return ['---', `name: ${name}`, 'description: A test agent.', '---', 'body'].join('\n');
}

describe('enumerateAgentDescriptors', () => {
  let dir: string;
  let agentsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-roster-'));
    agentsDir = join(dir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns one descriptor per markdown definition, keyed by identity', () => {
    writeFileSync(join(agentsDir, 'code-reviewer.md'), def('code-reviewer'), 'utf8');
    writeFileSync(join(agentsDir, 'planner.md'), def('planner'), 'utf8');

    const source = repoSource(dir);
    const descriptors = enumerateAgentDescriptors([source]);

    expect(descriptors).toHaveLength(2);
    const names = descriptors.map((d) => d.name).sort();
    expect(names).toEqual(['code-reviewer', 'planner']);

    const reviewer = descriptors.find((d) => d.name === 'code-reviewer');
    expect(reviewer?.identityKey).toBe(identityKey(agentIdentity(source, 'code-reviewer')));
  });

  it('excludes builtin/plugin agent names', () => {
    writeFileSync(join(agentsDir, 'general-purpose.md'), def('general-purpose'), 'utf8');
    writeFileSync(join(agentsDir, 'mine.md'), def('mine'), 'utf8');

    const descriptors = enumerateAgentDescriptors([repoSource(dir)]);

    expect(descriptors.map((d) => d.name)).toEqual(['mine']);
  });

  it('ignores non-markdown files', () => {
    writeFileSync(join(agentsDir, 'mine.md'), def('mine'), 'utf8');
    writeFileSync(join(agentsDir, 'README.txt'), 'not an agent', 'utf8');

    const descriptors = enumerateAgentDescriptors([repoSource(dir)]);

    expect(descriptors.map((d) => d.name)).toEqual(['mine']);
  });

  it('returns an empty list when a source has no agents dir', () => {
    const missing = repoSource(join(tmpdir(), 'handler-roster-missing-does-not-exist'));
    expect(enumerateAgentDescriptors([missing])).toEqual([]);
  });

  it('deduplicates identical identities across repeated sources', () => {
    writeFileSync(join(agentsDir, 'mine.md'), def('mine'), 'utf8');
    const source = repoSource(dir);

    const descriptors = enumerateAgentDescriptors([source, source]);

    expect(descriptors).toHaveLength(1);
  });
});
