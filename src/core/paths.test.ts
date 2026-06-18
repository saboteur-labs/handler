import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizePath } from './paths';

describe('normalizePath (Req 4)', () => {
  let root: string;

  beforeEach(() => {
    // realpath the temp dir so expectations aren't tripped by the macOS
    // /var -> /private/var symlink.
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an absolute path for a relative input', () => {
    expect(normalizePath('some/rel/path')).toBe(resolve('some/rel/path'));
  });

  it('collapses "." and ".." segments', () => {
    expect(normalizePath(join(root, 'a', '..', 'b'))).toBe(join(root, 'b'));
  });

  it('is stable across a trailing slash', () => {
    expect(normalizePath(`${root}/`)).toBe(root);
    expect(normalizePath(root)).toBe(root);
  });

  it('resolves symlinks when the path exists', () => {
    const target = join(root, 'target');
    const link = join(root, 'link');
    mkdirSync(target);
    symlinkSync(target, link);
    expect(normalizePath(link)).toBe(target);
  });

  it('falls back to a lexical absolute path when the path does not exist', () => {
    const ghost = join(root, 'does', '..', 'missing');
    expect(normalizePath(ghost)).toBe(join(root, 'missing'));
  });
});
