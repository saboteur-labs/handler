import { describe, expect, it } from 'vitest';
import { median } from './median';

describe('median', () => {
  it('returns undefined for an empty array', () => {
    expect(median([])).toBeUndefined();
  });

  it('returns the single element for a one-element array', () => {
    expect(median([42])).toBe(42);
  });

  it('returns the middle value for an odd-count array', () => {
    expect(median([10, 30, 20])).toBe(20);
  });

  it('returns the average of the two middle values for an even-count array', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('sorts internally and still returns correct median for unsorted input', () => {
    expect(median([50, 10, 40, 20, 30])).toBe(30);
  });
});
