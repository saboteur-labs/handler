import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readJsonFile, writeJsonFile } from './json-store';

describe('json file store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the fallback when the file does not exist', () => {
    expect(readJsonFile(join(dir, 'missing.json'), { a: 1 })).toEqual({ a: 1 });
  });

  it('round-trips data and creates parent directories', () => {
    const file = join(dir, 'nested', 'deep', 'data.json');
    writeJsonFile(file, { hello: 'world', n: [1, 2] });
    expect(readJsonFile(file, null)).toEqual({ hello: 'world', n: [1, 2] });
  });

  it('throws a clear error on corrupt JSON', () => {
    const file = join(dir, 'corrupt.json');
    writeFileSync(file, '{ not json', 'utf8');
    expect(() => readJsonFile(file, null)).toThrow(/Corrupt JSON store/);
  });
});
