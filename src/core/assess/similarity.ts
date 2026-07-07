/**
 * Deterministic token-set Jaccard similarity (feature-static-assessment FR-15).
 *
 * Shared by both `fleet` checks (`fleet/duplicate-trigger` over `description`,
 * `fleet/duplicate-definition` over `body`) — one implementation, per the
 * spec's "one implementation for both fleet checks" resolution. Pure, no
 * randomness, no locale-dependent behavior beyond simple ASCII-ish
 * lowercase/split.
 */

/**
 * A small, hardcoded stopword list of common English filler words, dropped
 * during normalization so shared connective words don't inflate the score
 * between otherwise-unrelated text. Deliberately short and unsurprising
 * (articles, conjunctions, a few common prepositions) rather than a
 * comprehensive NLP stopword corpus — FR-15 only asks for "a small stopword
 * set", not a linguistically complete one.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'is',
  'are',
  'on',
  'with',
  'this',
  'that',
]);

/**
 * Normalize `text` into a token set: lowercase, split on runs of
 * non-alphanumeric characters, drop empty fragments and stopwords. Exported
 * so callers comparing one string against many (e.g. the fleet checks) can
 * tokenize each input once and reuse the set across comparisons.
 */
export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '' && !STOPWORDS.has(token));
  return new Set(tokens);
}

/**
 * Token-set Jaccard similarity between two normalized token sets:
 * `|intersection| / |union|`.
 *
 * Empty-set edge case: when BOTH sets are empty (e.g. both inputs were empty
 * strings, or consisted entirely of stopwords), there is no shared meaningful
 * content to claim similarity over — this returns `0` rather than `NaN` (which
 * a naive `0/0` union-size division would otherwise produce).
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  // Iterate the smaller set for the intersection count.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersectionSize = 0;
  for (const token of small) {
    if (large.has(token)) {
      intersectionSize += 1;
    }
  }
  const unionSize = a.size + b.size - intersectionSize;
  return intersectionSize / unionSize;
}

/**
 * Token-set Jaccard similarity between `a` and `b` over each string's
 * normalized token set (see `tokenize`/`jaccard`).
 */
export function similarity(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}
