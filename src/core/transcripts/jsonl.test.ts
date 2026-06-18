import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readJsonl } from './jsonl';

describe('readJsonl', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeLines(name: string, content: string): string {
    const file = join(dir, name);
    writeFileSync(file, content, 'utf8');
    return file;
  }

  it('parses one object per line', () => {
    const file = writeLines('t.jsonl', '{"a":1}\n{"b":2}\n');
    expect(readJsonl(file)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips blank and whitespace-only lines, including a missing trailing newline', () => {
    const file = writeLines('t.jsonl', '{"a":1}\n\n   \n{"b":2}');
    expect(readJsonl(file)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('drops malformed lines without throwing and keeps the valid ones', () => {
    const file = writeLines('t.jsonl', '{"a":1}\n{ not json\n{"b":2}\n');
    expect(readJsonl(file)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('tolerates \\r\\n line endings', () => {
    const file = writeLines('t.jsonl', '{"a":1}\r\n{"b":2}\r\n');
    expect(readJsonl(file)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns an empty array when the file does not exist', () => {
    expect(readJsonl(join(dir, 'missing.jsonl'))).toEqual([]);
  });
});
