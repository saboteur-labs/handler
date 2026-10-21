import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CAPTURE_AGENT_IDS, capturePaths } from '../__fixtures__/capture/fixtures';
import { readMeta } from './meta';

describe('readMeta', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-meta-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(content: string): string {
    const p = join(dir, 'agent-x.meta.json');
    writeFileSync(p, content, 'utf8');
    return p;
  }

  it('parses agentType, spawnDepth and finished from a fixture meta', () => {
    expect(readMeta(capturePaths.meta(CAPTURE_AGENT_IDS.reviewer))).toEqual({
      agentType: 'code-reviewer',
      spawnDepth: 1,
      finished: true,
    });
  });

  it('leaves finished unset when absent', () => {
    expect(readMeta(capturePaths.meta(CAPTURE_AGENT_IDS.writer))?.finished).toBeUndefined();
  });

  it('parses parentAgentId and spawnDepth 2 for the nested run', () => {
    expect(readMeta(capturePaths.meta(CAPTURE_AGENT_IDS.nested))).toEqual({
      agentType: 'planner',
      spawnDepth: 2,
      parentAgentId: CAPTURE_AGENT_IDS.reviewer,
      finished: true,
    });
  });

  it('returns undefined for a missing file', () => {
    expect(readMeta(join(dir, 'nope.meta.json'))).toBeUndefined();
  });

  it('returns undefined for an empty file', () => {
    expect(readMeta(write(''))).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(readMeta(write('{ not json'))).toBeUndefined();
  });

  it('returns undefined for non-object JSON', () => {
    expect(readMeta(write('[1,2]'))).toBeUndefined();
    expect(readMeta(write('"str"'))).toBeUndefined();
  });

  it('returns undefined when agentType is missing or not a non-empty string', () => {
    expect(readMeta(write('{"spawnDepth":1}'))).toBeUndefined();
    expect(readMeta(write('{"agentType":""}'))).toBeUndefined();
    expect(readMeta(write('{"agentType":5}'))).toBeUndefined();
  });

  it('drops optional fields of the wrong type', () => {
    expect(
      readMeta(write('{"agentType":"a","spawnDepth":"2","parentAgentId":7,"finished":"yes"}')),
    ).toEqual({ agentType: 'a' });
  });
});
