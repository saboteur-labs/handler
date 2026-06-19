/**
 * LLM judge client seam for Tier C judged-quality scoring.
 *
 * `JudgeClient` is an injectable interface — the only contract callers depend
 * on. Tests always inject a `FakeJudgeClient`; no real network calls are made
 * in the test suite.
 *
 * `DefaultJudgeClient` is the production implementation. It calls the Claude
 * API via `fetch` (Node ≥18 native) using a user-supplied API key from the
 * `ANTHROPIC_API_KEY` environment variable or an explicit constructor option.
 * The model defaults to `claude-sonnet-4-6` but is configurable.
 *
 * **Failure contract:** on any failure (network error, API error, timeout,
 * malformed / unparseable response), `judge` MUST throw. It MUST NOT return a
 * partial `JudgeResponse` with empty fields. The caller (Tier C orchestrator)
 * decides what to do with the error; this module only makes failures explicit.
 */

import type { TierCLabel } from './tier-c';

/** The parsed output of a successful judge call. */
export interface JudgeResponse {
  /** The judge's verdict. */
  label: TierCLabel;
  /** The judge's chain-of-thought reasoning behind the verdict. */
  reasoning: string;
}

/**
 * Injectable judge client interface. Implement this interface to swap in a
 * fake client for testing or a different model provider in the future.
 */
export interface JudgeClient {
  /**
   * Send `prompt` to the underlying model and return a parsed `JudgeResponse`.
   *
   * @throws When the call fails for any reason (network, API, timeout,
   *         malformed response). Never returns a partial result.
   */
  judge(prompt: string): Promise<JudgeResponse>;
}

/** Default Anthropic Claude model to use for judging. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Anthropic Messages API endpoint. */
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/** Anthropic API version header value. */
const ANTHROPIC_API_VERSION = '2023-06-01';

export interface DefaultJudgeClientOptions {
  /** The Anthropic API key. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** The model to use. Defaults to `claude-sonnet-4-6`. */
  model?: string;
}

/**
 * Production `JudgeClient` that calls the Anthropic Claude API.
 *
 * Constructor options are intentionally minimal — the user supplies their own
 * API key; no managed/hosted config is involved.
 *
 * `parseResponse` is exposed as a public method so the parsing contract can be
 * unit-tested without making any network calls.
 */
export class DefaultJudgeClient implements JudgeClient {
  readonly apiKey: string;
  readonly model: string;

  constructor(options: DefaultJudgeClientOptions = {}) {
    const resolvedKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    this.apiKey = resolvedKey;
    this.model = options.model ?? DEFAULT_MODEL;
  }

  /**
   * Send `prompt` to Claude and return a parsed `JudgeResponse`.
   *
   * @throws When the API key is missing, the request fails, or the response
   *         cannot be parsed into a valid `JudgeResponse`.
   */
  async judge(prompt: string): Promise<JudgeResponse> {
    if (!this.apiKey) {
      throw new Error(
        'DefaultJudgeClient: no API key. Set ANTHROPIC_API_KEY or pass apiKey to the constructor.',
      );
    }

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err) {
      throw new Error(
        `DefaultJudgeClient: network error — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore body-read failures
      }
      throw new Error(
        `DefaultJudgeClient: API error ${response.status} ${response.statusText} — ${errorBody}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new Error(
        `DefaultJudgeClient: failed to parse API response as JSON — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = extractTextContent(body);
    return this.parseResponse(text);
  }

  /**
   * Parse the raw text content from the model response into a `JudgeResponse`.
   *
   * Expects the text to contain a JSON object with `label` ("pass" | "fail")
   * and `reasoning` (string) fields. The JSON may be embedded in surrounding
   * text (e.g. wrapped in a markdown code fence).
   *
   * @throws When the text cannot be parsed or the parsed object is missing
   *         required fields with valid values.
   */
  parseResponse(text: string): JudgeResponse {
    if (!text || text.trim().length === 0) {
      throw new Error('DefaultJudgeClient: model returned an empty response');
    }

    const parsed = extractJson(text);

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('DefaultJudgeClient: parsed response is not an object');
    }

    const candidate = parsed as Record<string, unknown>;

    if (candidate.label !== 'pass' && candidate.label !== 'fail') {
      throw new Error(
        `DefaultJudgeClient: invalid or missing "label" field — expected "pass" or "fail", got ${JSON.stringify(candidate.label)}`,
      );
    }

    if (typeof candidate.reasoning !== 'string') {
      throw new Error(
        `DefaultJudgeClient: missing or non-string "reasoning" field — got ${JSON.stringify(candidate.reasoning)}`,
      );
    }

    return {
      label: candidate.label,
      reasoning: candidate.reasoning,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first text content block from an Anthropic API response body.
 *
 * @throws When the body does not match the expected shape.
 */
function extractTextContent(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('DefaultJudgeClient: API response body is not an object');
  }

  const msg = body as Record<string, unknown>;
  if (!Array.isArray(msg.content) || msg.content.length === 0) {
    throw new Error('DefaultJudgeClient: API response has no content blocks');
  }

  const first = msg.content[0] as Record<string, unknown>;
  if (first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('DefaultJudgeClient: first content block is not a text block');
  }

  return first.text;
}

/**
 * Attempt to parse a JSON object from `text`.
 *
 * Tries the full text first. If that fails, searches for the first `{…}` block
 * (handles model responses that wrap JSON in prose or code fences).
 *
 * @throws When no valid JSON object can be extracted.
 */
function extractJson(text: string): unknown {
  // Try the raw text first (happy path: model returned pure JSON).
  try {
    return JSON.parse(text.trim());
  } catch {
    // fall through
  }

  // Search for the first JSON object block in the text.
  const match = text.match(/\{[\s\S]*\}/);
  if (match === null) {
    throw new Error(
      `DefaultJudgeClient: could not find a JSON object in the model response — received: ${text.slice(0, 200)}`,
    );
  }

  try {
    return JSON.parse(match[0]);
  } catch (err) {
    throw new Error(
      `DefaultJudgeClient: found a JSON-like block but failed to parse it — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
