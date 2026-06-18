import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentIdentity } from './identity';
import { resolveAgent } from './resolve';
import { repoSource, userSource } from './sources/source';

describe('resolveAgent (Req 8 + Reqs 3, 4)', () => {
  let root: string;

  beforeEach(() => {
    // realpath the temp root so virtual child paths below it are already canonical.
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('excludes built-in/plugin names (returns null)', () => {
    const sources = [repoSource(join(root, 'repo')), userSource(join(root, 'home'))];
    expect(resolveAgent('Explore', join(root, 'repo', 'x'), sources)).toBeNull();
  });

  it('attributes a run under a repo source to that repo', () => {
    const repo = repoSource(join(root, 'repo'));
    const id = resolveAgent('reviewer', join(root, 'repo', 'src'), [repo]);
    expect(id).toEqual(agentIdentity(repo, 'reviewer'));
  });

  it('matches when cwd equals the repo root', () => {
    const repo = repoSource(join(root, 'repo'));
    expect(resolveAgent('helper', join(root, 'repo'), [repo])).toEqual(
      agentIdentity(repo, 'helper'),
    );
  });

  it('picks the nearest (deepest) ancestor among nested repo sources', () => {
    const outer = repoSource(root);
    const inner = repoSource(join(root, 'pkg'));
    const cwd = join(root, 'pkg', 'src');
    const expected = agentIdentity(inner, 'helper');
    expect(resolveAgent('helper', cwd, [outer, inner])).toEqual(expected);
    // order-independent
    expect(resolveAgent('helper', cwd, [inner, outer])).toEqual(expected);
  });

  it('falls back to the user source when no repo source is an ancestor', () => {
    const repo = repoSource(join(root, 'other-repo'));
    const user = userSource(join(root, 'home'));
    const id = resolveAgent('helper', join(root, 'somewhere', 'deep'), [repo, user]);
    expect(id).toEqual(agentIdentity(user, 'helper'));
  });

  it('does not match a sibling whose name shares a prefix', () => {
    const repo = repoSource(join(root, 'bar'));
    const user = userSource(join(root, 'home'));
    const id = resolveAgent('helper', join(root, 'barbaz', 'x'), [repo, user]);
    expect(id).toEqual(agentIdentity(user, 'helper'));
  });

  it('returns null when nothing matches and no user source is registered', () => {
    const repo = repoSource(join(root, 'other-repo'));
    expect(resolveAgent('helper', join(root, 'elsewhere'), [repo])).toBeNull();
  });
});
