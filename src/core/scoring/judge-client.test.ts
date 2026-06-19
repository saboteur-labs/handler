/**
 * Tests for the JudgeClient interface and DefaultJudgeClient parsing/failure logic.
 *
 * All tests use injectable fakes — zero real network calls are made.
 */

import { describe, expect, it } from 'vitest';

import type { JudgeClient, JudgeResponse } from './judge-client';
import { DefaultJudgeClient } from './judge-client';
import type { TierCLabel } from './tier-c';

// ---------------------------------------------------------------------------
// Fake client implementations for testing the interface contract
// ---------------------------------------------------------------------------

/** A fake JudgeClient that returns a fixed well-formed response. */
class FakeJudgeClient implements JudgeClient {
  constructor(private readonly response: JudgeResponse) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async judge(_prompt: string): Promise<JudgeResponse> {
    return this.response;
  }
}

/** A fake JudgeClient that throws an error. */
class FailingJudgeClient implements JudgeClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async judge(_prompt: string): Promise<JudgeResponse> {
    throw new Error('network failure');
  }
}

// ---------------------------------------------------------------------------
// JudgeClient interface contract tests
// ---------------------------------------------------------------------------

describe('JudgeClient interface', () => {
  it('returns a JudgeResponse with label and reasoning on success', async () => {
    const expected: JudgeResponse = { label: 'pass', reasoning: 'The agent performed well.' };
    const client: JudgeClient = new FakeJudgeClient(expected);

    const result = await client.judge('some prompt');

    expect(result.label).toBe('pass');
    expect(result.reasoning).toBe('The agent performed well.');
  });

  it('accepts "fail" label', async () => {
    const expected: JudgeResponse = { label: 'fail', reasoning: 'The agent made errors.' };
    const client: JudgeClient = new FakeJudgeClient(expected);

    const result = await client.judge('some prompt');

    expect(result.label).toBe('fail');
    expect(result.reasoning).toBe('The agent made errors.');
  });

  it('propagates errors from a failing client', async () => {
    const client: JudgeClient = new FailingJudgeClient();

    await expect(client.judge('some prompt')).rejects.toThrow('network failure');
  });
});

// ---------------------------------------------------------------------------
// DefaultJudgeClient response-parsing tests
// Uses the internal parsing logic via a subclass or a helper exposed for testing.
// ---------------------------------------------------------------------------

describe('DefaultJudgeClient.parseResponse', () => {
  it('parses a well-formed JSON response with label and reasoning', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const rawResponse = JSON.stringify({ label: 'pass', reasoning: 'Looks good.' });

    const result = client.parseResponse(rawResponse);

    expect(result.label).toBe('pass');
    expect(result.reasoning).toBe('Looks good.');
  });

  it('parses a "fail" label correctly', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const rawResponse = JSON.stringify({ label: 'fail', reasoning: 'Did not meet criteria.' });

    const result = client.parseResponse(rawResponse);

    expect(result.label).toBe('fail');
    expect(result.reasoning).toBe('Did not meet criteria.');
  });

  it('parses JSON embedded in surrounding text', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const rawResponse =
      'Here is my assessment:\n```json\n{"label":"pass","reasoning":"Well done."}\n```';

    const result = client.parseResponse(rawResponse);

    expect(result.label).toBe('pass');
    expect(result.reasoning).toBe('Well done.');
  });

  it('throws on non-JSON response', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const rawResponse = 'This is not JSON at all.';

    expect(() => client.parseResponse(rawResponse)).toThrow();
  });

  it('throws on JSON with missing label field', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const rawResponse = JSON.stringify({ reasoning: 'Something happened.' });

    expect(() => client.parseResponse(rawResponse)).toThrow();
  });

  it('throws on JSON with missing reasoning field', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const rawResponse = JSON.stringify({ label: 'pass' });

    expect(() => client.parseResponse(rawResponse)).toThrow();
  });

  it('throws on JSON with invalid label value', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const rawResponse = JSON.stringify({ label: 'maybe', reasoning: 'Not sure.' });

    expect(() => client.parseResponse(rawResponse)).toThrow();
  });

  it('throws on empty string response', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });

    expect(() => client.parseResponse('')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Failure-leaves-no-result contract
// ---------------------------------------------------------------------------

describe('JudgeClient failure contract', () => {
  it('a failing client throws — no partial TierCResult is produced', async () => {
    const client: JudgeClient = new FailingJudgeClient();
    let result: JudgeResponse | undefined;
    let caughtError: unknown;

    try {
      result = await client.judge('some prompt');
    } catch (err) {
      caughtError = err;
    }

    // Result must be undefined — no partial value was assigned.
    expect(result).toBeUndefined();
    // An error was thrown.
    expect(caughtError).toBeInstanceOf(Error);
  });

  it('a malformed response from DefaultJudgeClient.parseResponse throws — no partial result produced', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    let result: JudgeResponse | undefined;
    let caughtError: unknown;

    try {
      result = client.parseResponse('{"bad": true}');
    } catch (err) {
      caughtError = err;
    }

    expect(result).toBeUndefined();
    expect(caughtError).toBeInstanceOf(Error);
  });

  it('multiple invalid label values all throw', () => {
    const client = new DefaultJudgeClient({ apiKey: 'test-key' });
    const invalidLabels: TierCLabel[] = [];
    const invalidValues = ['yes', 'no', 'ok', 1, null, true, 'Pass', 'FAIL'];

    for (const label of invalidValues) {
      expect(() => client.parseResponse(JSON.stringify({ label, reasoning: 'text' }))).toThrow();
      // No invalid label was added
      expect(invalidLabels).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// DefaultJudgeClient configuration tests
// ---------------------------------------------------------------------------

describe('DefaultJudgeClient configuration', () => {
  it('constructs with an api key and default model', () => {
    const client = new DefaultJudgeClient({ apiKey: 'my-key' });
    expect(client.model).toBe('claude-sonnet-4-6');
  });

  it('accepts a custom model name', () => {
    const client = new DefaultJudgeClient({ apiKey: 'my-key', model: 'claude-opus-4-5' });
    expect(client.model).toBe('claude-opus-4-5');
  });

  it('reads api key from ANTHROPIC_API_KEY env var when not supplied', () => {
    const original = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'env-key';

    try {
      const client = new DefaultJudgeClient();
      expect(client.apiKey).toBe('env-key');
    } finally {
      if (original === undefined) {
        delete process.env['ANTHROPIC_API_KEY'];
      } else {
        process.env['ANTHROPIC_API_KEY'] = original;
      }
    }
  });

  it('prefers explicitly supplied api key over env var', () => {
    const original = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'env-key';

    try {
      const client = new DefaultJudgeClient({ apiKey: 'explicit-key' });
      expect(client.apiKey).toBe('explicit-key');
    } finally {
      if (original === undefined) {
        delete process.env['ANTHROPIC_API_KEY'];
      } else {
        process.env['ANTHROPIC_API_KEY'] = original;
      }
    }
  });
});
