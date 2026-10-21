import { describe, expect, it } from 'vitest';

import { canOverwrite } from './precedence';

describe('canOverwrite (FR-22: transcript > hook > runlog)', () => {
  it('lets transcript overwrite hook, runlog, transcript, or unset', () => {
    expect(canOverwrite('hook', 'transcript')).toBe(true);
    expect(canOverwrite('runlog', 'transcript')).toBe(true);
    expect(canOverwrite('transcript', 'transcript')).toBe(true);
    expect(canOverwrite(undefined, 'transcript')).toBe(true);
  });

  it('lets hook overwrite runlog, hook, or unset but never transcript', () => {
    expect(canOverwrite('runlog', 'hook')).toBe(true);
    expect(canOverwrite('hook', 'hook')).toBe(true);
    expect(canOverwrite(undefined, 'hook')).toBe(true);
    expect(canOverwrite('transcript', 'hook')).toBe(false);
  });

  it('never lets runlog overwrite hook or transcript', () => {
    expect(canOverwrite('hook', 'runlog')).toBe(false);
    expect(canOverwrite('transcript', 'runlog')).toBe(false);
  });

  it('lets runlog write over runlog or an unset legacy source', () => {
    expect(canOverwrite('runlog', 'runlog')).toBe(true);
    expect(canOverwrite(undefined, 'runlog')).toBe(true);
  });
});
