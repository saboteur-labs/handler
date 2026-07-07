import { describe, expect, it } from 'vitest';

import { similarity } from './similarity';

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    expect(
      similarity(
        'Reviews pull requests for style issues',
        'Reviews pull requests for style issues',
      ),
    ).toBe(1);
  });

  it('returns 0 for completely disjoint strings', () => {
    expect(similarity('apple banana cherry', 'xylophone zebra quokka')).toBe(0);
  });

  it('returns an intermediate value for partial overlap', () => {
    // tokens a: {reviews, pull, requests, style, issues}
    // tokens b: {reviews, pull, requests, security, issues}
    // (stopwords "for" dropped from both)
    // intersection: {reviews, pull, requests, issues} = 4
    // union: {reviews, pull, requests, style, issues, security} = 6
    const value = similarity(
      'Reviews pull requests for style issues',
      'Reviews pull requests for security issues',
    );
    expect(value).toBeCloseTo(4 / 6, 10);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it('returns 0 when both token sets are empty (no shared meaningful content to claim similarity over)', () => {
    expect(similarity('', '')).toBe(0);
    // both consist entirely of stopwords
    expect(similarity('the a an', 'and or of')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(similarity('Reviews Code', 'reviews code')).toBe(1);
  });

  it('splits on punctuation rather than treating it as part of a token', () => {
    // naive raw-string comparison would treat "code," and "code" as different
    // tokens across the two inputs; normalization strips the punctuation so
    // they match.
    const value = similarity('Reviews code, tests, and docs.', 'Reviews code tests and docs');
    expect(value).toBe(1);
  });

  it('drops stopwords so shared filler words do not inflate the score', () => {
    // Without stopword-dropping, "the" and "a" would count toward the
    // intersection/union even though the substantive content is disjoint.
    const withFiller = similarity('the a quokka', 'the a zebra');
    const withoutFiller = similarity('quokka', 'zebra');
    expect(withFiller).toBe(withoutFiller);
    expect(withFiller).toBe(0);
  });

  it('is deterministic across repeated calls', () => {
    const a = 'Runs the test suite and reports failures';
    const b = 'Runs tests and reports failures found';
    const first = similarity(a, b);
    const second = similarity(a, b);
    expect(first).toBe(second);
  });
});
