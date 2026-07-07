/**
 * `prompt` category static checks (feature-static-assessment FR-12, FR-13, FR-14).
 *
 * All three checks are single-agent (they ignore `fleet`) and pure — no store
 * reads/writes, no file I/O, no network/LLM calls.
 */
import type { Finding, StaticCheck } from '../check';
import type { ParsedDefinition } from '../parse';

/**
 * Default `maxTokens` threshold for `prompt/size` when policy `options` does
 * not configure one (FR-14). 4000 estimated tokens is a generous ceiling for
 * a hand-authored subagent system prompt — comfortably above a typical
 * few-hundred-word prompt with some examples, while still catching prompts
 * large enough that their fixed per-run cost is worth flagging. Configurable
 * via policy `options`, same pattern as `tools/over-broad`'s `maxTools`.
 */
export const DEFAULT_MAX_TOKENS = 4000;

/** Marker substring used by `prompt/no-examples` to detect an example block, matched case-insensitively. */
const EXAMPLE_MARKER = /<example>/i;

/** Chars-per-token used by the deterministic token-size estimate (see `estimateTokens`). */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate a definition's token size deterministically, without a tokenizer
 * dependency, using a fixed chars-per-token heuristic (~4 chars/token, a
 * common rough approximation for English text).
 *
 * FR-14 asks for an estimate over "frontmatter + body" — i.e. the whole
 * original definition content — but `ParsedDefinition` (the aggregate this
 * check registry evaluates against) does not retain the raw original
 * snapshot text; `parseDefinition` only keeps the individual frontmatter
 * *values* (`name`/`description`/`model`) plus the parsed `scope` and the
 * extracted `body` (see `parse.ts`). Re-serializing those parsed values back
 * into a byte-for-byte reconstruction of the original frontmatter block would
 * be both lossy (parsed values drop key order, comments, unrecognized keys,
 * and the raw `tools:` formatting) and speculative.
 *
 * Judgment call: fold the actual `name` and `description` field lengths into
 * the estimate, rather than standing in for the whole frontmatter block with
 * a flat constant. `description` in particular is often the largest part of
 * a real-world definition's frontmatter — routing triggers and few-shot
 * example text routinely run to several sentences — so a flat overhead
 * materially undercounts definitions with long descriptions and overcounts
 * definitions with none. The estimate is:
 *
 *   `(name.length + description.length + smallStructuralOverhead + body.length) / 4`
 *
 * `model` is deliberately left out: it is almost always a short literal
 * (`"opus"`, `"sonnet"`, `"haiku"`, or absent) whose contribution to the
 * estimate rounds away, and folding it in would add a field read for no
 * measurable effect on the result. `smallStructuralOverhead` is a small fixed
 * residual for the YAML punctuation and non-content frontmatter lines
 * (`---` fences, the `tools:`/`model:` keys themselves) that aren't captured
 * by `name`/`description` values alone — it is deliberately modest now that
 * the two dominant, actually-varying fields are folded in directly. This
 * keeps the estimate deterministic and monotonic in the fields that vary
 * across real definitions (body, name, description), which is what the
 * "large fixed prompt, paid every run" framing in FR-14 is after.
 */
const FRONTMATTER_STRUCTURE_OVERHEAD_CHARS = 30;

function estimateTokens(agent: ParsedDefinition): number {
  const frontmatterChars =
    (agent.name?.length ?? 0) +
    (agent.description?.length ?? 0) +
    FRONTMATTER_STRUCTURE_OVERHEAD_CHARS;
  return Math.ceil((frontmatterChars + agent.body.length) / CHARS_PER_TOKEN);
}

/**
 * `prompt/empty-body` (error): fires when `agent` has frontmatter but no
 * non-whitespace system-prompt body (FR-12). A definition with no
 * frontmatter at all is out of scope here — that is a `conventions` 16a
 * concern, not this check's. Uses the authoritative `hasFrontmatter` flag
 * (`parseFrontmatter`'s `present`, threaded through `ParsedDefinition`) rather
 * than proxying frontmatter presence from `name`/`description`, so a block
 * that declares only e.g. `tools:` still counts as present.
 */
export const emptyBodyCheck: StaticCheck = {
  id: 'prompt/empty-body',
  category: 'prompt',
  severity: 'error',
  run: (agent): Finding[] => {
    if (!agent.hasFrontmatter || agent.body.trim() !== '') {
      return [];
    }
    return [
      {
        check: 'prompt/empty-body',
        severity: 'error',
        message: 'definition has frontmatter but no system-prompt body',
        suggestion: "add a system-prompt body describing the agent's role and instructions",
      },
    ];
  },
};

/**
 * `prompt/no-examples` (info; ships disabled by default via the config store)
 * fires when `agent.body` contains no example block, detected via a simple
 * `<example>` marker match (case-insensitive; a balanced-tag parse is more
 * than FR-13 calls for) (FR-13).
 */
export const noExamplesCheck: StaticCheck = {
  id: 'prompt/no-examples',
  category: 'prompt',
  severity: 'info',
  run: (agent): Finding[] => {
    if (EXAMPLE_MARKER.test(agent.body)) {
      return [];
    }
    return [
      {
        check: 'prompt/no-examples',
        severity: 'info',
        message: 'definition body contains no example block (<example>)',
        suggestion:
          'consider adding one or more <example> blocks, especially for agents relying on automatic delegation',
      },
    ];
  },
};

/**
 * `prompt/size` (info): fires when the deterministic token-size estimate over
 * frontmatter + body exceeds a configurable `maxTokens` threshold, falling
 * back to `DEFAULT_MAX_TOKENS` when absent or not a number (FR-14). Framed as
 * a per-run cost proxy: a large fixed prompt is paid on every run.
 */
export const sizeCheck: StaticCheck = {
  id: 'prompt/size',
  category: 'prompt',
  severity: 'info',
  run: (agent, _fleet, options): Finding[] => {
    const maxTokensOption = options?.maxTokens;
    const maxTokens = typeof maxTokensOption === 'number' ? maxTokensOption : DEFAULT_MAX_TOKENS;
    const estimate = estimateTokens(agent);
    if (estimate <= maxTokens) {
      return [];
    }
    return [
      {
        check: 'prompt/size',
        severity: 'info',
        message: `estimated definition size (~${estimate} tokens) exceeds the configured maximum of ${maxTokens} tokens — a per-run cost proxy, since this fixed prompt is paid on every run`,
        suggestion:
          'trim the system prompt, or raise the configured maxTokens if the size is intentional',
      },
    ];
  },
};

/** The `prompt` category's checks, in a stable registration order. */
export const PROMPT_CHECKS: readonly StaticCheck[] = [emptyBodyCheck, noExamplesCheck, sizeCheck];
