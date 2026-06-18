/**
 * Tests for output-contract detection and adherence checks (tier-b-contract.ts).
 *
 * Pinned to the exact marker set defined in the spec to prevent drift.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import type { Run } from '../run';
import { checkContract, detectContract, extractRunOutput } from './tier-b-contract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    identityKey: 'test|/path|agent',
    runId: 'run-1',
    agentName: 'agent',
    cwd: '/path',
    sessionId: 'session-1',
    sidechainPath: undefined,
    timestamp: undefined,
    status: 'completed',
    totalDurationMs: 1000,
    totalTokens: 100,
    totalToolUseCount: 0,
    toolStats: undefined,
    definitionSnapshot: null,
    tags: [],
    telemetry: undefined,
    ...overrides,
  };
}

/** Write a sidechain JSONL with assistant entries and return the path. */
function writeSidechain(assistantContents: string[]): string {
  const path = join(tmpdir(), `tier-b-contract-test-${Math.random().toString(36).slice(2)}.jsonl`);
  const lines = assistantContents.map((text) =>
    JSON.stringify({
      message: {
        usage: { input_tokens: 10, output_tokens: 10 },
        content: text,
      },
    }),
  );
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// detectContract — detection tests
// ---------------------------------------------------------------------------

describe('detectContract', () => {
  it('1: "return JSON" triggers json contract (case-insensitive)', () => {
    const result = detectContract('You must return JSON to the caller.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('json');
  });

  it('2: "output JSON" triggers json contract', () => {
    const result = detectContract('Always output JSON.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('json');
  });

  it('3: "respond with JSON" triggers json contract', () => {
    const result = detectContract('respond with JSON always.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('json');
  });

  it('4: fenced ```json code block triggers json contract', () => {
    const definition = 'Here is the schema:\n```json\n{ "key": "value" }\n```';
    const result = detectContract(definition);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('json');
  });

  it('5: "## Output" header triggers sections contract', () => {
    const result = detectContract('## Output\nThis section describes the output.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('sections');
  });

  it('6: "## Response" header triggers sections contract', () => {
    const result = detectContract('## Response\nReturn a summary.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('sections');
  });

  it('7: "## Result" header triggers sections contract', () => {
    const result = detectContract('## Result\nDescribes the result.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('sections');
  });

  it('8: "## Format" header triggers sections contract', () => {
    const result = detectContract('## Format\nThe expected format.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('sections');
  });

  it('9: definition with no markers returns null', () => {
    const result = detectContract('This agent does helpful things and nothing else.');
    expect(result).toBeNull();
  });

  it('10: null definition returns null', () => {
    expect(detectContract(null)).toBeNull();
  });

  it('11: both JSON markers and sections present → json wins', () => {
    const definition = 'return JSON\n## Output\nSomething here.';
    const result = detectContract(definition);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('json');
  });

  it('12: section headers are case-insensitive', () => {
    const result = detectContract('## output\nContent here.');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('sections');
  });
});

// ---------------------------------------------------------------------------
// extractRunOutput
// ---------------------------------------------------------------------------

describe('extractRunOutput', () => {
  it('returns null when sidechainPath is undefined', () => {
    const run = makeRun({ sidechainPath: undefined });
    expect(extractRunOutput(run)).toBeNull();
  });

  it('returns null when sidechain has no entries', () => {
    const path = writeSidechain([]);
    const run = makeRun({ sidechainPath: path });
    expect(extractRunOutput(run)).toBeNull();
  });

  it('returns content of last assistant entry', () => {
    const path = writeSidechain(['first output', 'final output']);
    const run = makeRun({ sidechainPath: path });
    expect(extractRunOutput(run)).toBe('final output');
  });

  it('returns single entry content', () => {
    const path = writeSidechain(['only output']);
    const run = makeRun({ sidechainPath: path });
    expect(extractRunOutput(run)).toBe('only output');
  });
});

// ---------------------------------------------------------------------------
// checkContract — contract check tests
// ---------------------------------------------------------------------------

describe('checkContract', () => {
  it('13: no contract in definition → not-applicable (no contractType)', () => {
    const run = makeRun({ definitionSnapshot: 'This agent just helps.' });
    const result = checkContract(run);
    expect(result.status).toBe('not-applicable');
    expect(result.contractType).toBeUndefined();
  });

  it('14: JSON contract + output is valid JSON → pass', () => {
    const path = writeSidechain(['{"result": "ok"}']);
    const run = makeRun({
      definitionSnapshot: 'You must return JSON.',
      sidechainPath: path,
    });
    const result = checkContract(run);
    expect(result.status).toBe('pass');
    expect(result.contractType).toBe('json');
    expect(result.detail).toBe('output is valid JSON');
  });

  it('15: JSON contract + output is not valid JSON → fail', () => {
    const path = writeSidechain(['This is just plain text, not JSON.']);
    const run = makeRun({
      definitionSnapshot: 'You must return JSON.',
      sidechainPath: path,
    });
    const result = checkContract(run);
    expect(result.status).toBe('fail');
    expect(result.contractType).toBe('json');
    expect(result.detail).toBe('output is not valid JSON');
  });

  it('16: sections contract + output contains ## Output → pass', () => {
    const path = writeSidechain(['## Output\nHere is the result.']);
    const run = makeRun({
      definitionSnapshot: '## Output\nReturn structured output.',
      sidechainPath: path,
    });
    const result = checkContract(run);
    expect(result.status).toBe('pass');
    expect(result.contractType).toBe('sections');
    expect(result.detail).toBe('output contains declared section headers');
  });

  it('17: sections contract + output does NOT contain declared section → fail', () => {
    const path = writeSidechain(['Here is some output with no headers.']);
    const run = makeRun({
      definitionSnapshot: '## Output\nReturn structured output.',
      sidechainPath: path,
    });
    const result = checkContract(run);
    expect(result.status).toBe('fail');
    expect(result.contractType).toBe('sections');
    expect(result.detail).toBe('output does not contain declared section headers');
  });

  it('18: JSON contract + no sidechainPath → not-applicable', () => {
    const run = makeRun({
      definitionSnapshot: 'You must return JSON.',
      sidechainPath: undefined,
    });
    const result = checkContract(run);
    expect(result.status).toBe('not-applicable');
    expect(result.contractType).toBe('json');
    expect(result.detail).toBe('run output not available');
  });
});
