import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDefinitionSnapshot } from './snapshot';
import { repoSource } from './sources/source';

describe('loadDefinitionSnapshot', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'handler-repo-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeAgent(name: string, content: string): void {
    const dir = join(root, '.claude', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), content, 'utf8');
  }

  it('returns the definition content when the file exists', () => {
    writeAgent('reviewer', '---\nname: reviewer\n---\nBody');
    expect(loadDefinitionSnapshot(repoSource(root), 'reviewer')).toBe(
      '---\nname: reviewer\n---\nBody',
    );
  });

  it('returns null when the definition file is missing (orphan)', () => {
    expect(loadDefinitionSnapshot(repoSource(root), 'ghost')).toBeNull();
  });

  it('returns null when the agents dir does not exist at all', () => {
    expect(loadDefinitionSnapshot(repoSource(root), 'anything')).toBeNull();
  });
});
