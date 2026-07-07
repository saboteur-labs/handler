import { describe, expect, it } from 'vitest';

import type { ParsedDefinition } from '../parse';
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  duplicateDefinitionCheck,
  duplicateTriggerCheck,
  FLEET_CHECKS,
} from './fleet';

function makeAgent(overrides: Partial<ParsedDefinition> & { name: string }): ParsedDefinition {
  return {
    description: 'A test agent',
    model: undefined,
    scope: { declared: true, granted: new Set(), spawnTargets: new Set() },
    body: 'You do things.',
    hasFrontmatter: true,
    sourceKey: undefined,
    ...overrides,
  };
}

describe('fleet/duplicate-trigger', () => {
  // description token sets (after dropping the stopword "for"):
  //   a: {reviews, pull, requests, style, bugs}  (5 tokens)
  //   b: {reviews, pull, requests, style}        (4 tokens, a strict subset of a's)
  // intersection = 4, union = 5, similarity = 4/5 = 0.8 exactly.
  const descriptionA = 'reviews pull requests for style bugs';
  const descriptionB = 'reviews pull requests for style';

  it('fires at the threshold boundary (similarity exactly equal to the configured threshold)', () => {
    const a = makeAgent({ name: 'a', description: descriptionA });
    const b = makeAgent({ name: 'b', description: descriptionB });

    const findings = duplicateTriggerCheck.run(a, [a, b], { similarityThreshold: 0.8 });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('fleet/duplicate-trigger');
    expect(findings[0]?.severity).toBe('warn');
    expect(findings[0]?.message).toMatch(/b/);
  });

  it('does not fire just under the configured threshold', () => {
    const a = makeAgent({ name: 'a', description: descriptionA });
    const b = makeAgent({ name: 'b', description: descriptionB });

    const findings = duplicateTriggerCheck.run(a, [a, b], { similarityThreshold: 0.81 });

    expect(findings).toEqual([]);
  });

  it('uses the default 0.8 threshold when no option is provided', () => {
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.8);
    const a = makeAgent({ name: 'a', description: descriptionA });
    const b = makeAgent({ name: 'b', description: descriptionB });

    expect(duplicateTriggerCheck.run(a, [a, b])).toHaveLength(1);
  });

  it('never fires from a self-comparison', () => {
    const a = makeAgent({ name: 'a', description: descriptionA });

    expect(duplicateTriggerCheck.run(a, [a])).toEqual([]);
  });

  it('emits each duplicate pair exactly once across a full fleet run', () => {
    const a = makeAgent({ name: 'a', description: 'reviews pull requests for style bugs' });
    const b = makeAgent({ name: 'b', description: 'reviews pull requests for style bugs' });
    const fleet = [a, b];

    const total = fleet.flatMap((member) => duplicateTriggerCheck.run(member, fleet));

    expect(total).toHaveLength(1);
  });
});

describe('fleet/duplicate-definition', () => {
  it('fires when two definitions share a name across different sources', () => {
    const a = makeAgent({ name: 'reviewer', sourceKey: 'repo:/one' });
    const b = makeAgent({ name: 'reviewer', sourceKey: 'repo:/two' });

    const findings = duplicateDefinitionCheck.run(a, [a, b]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('fleet/duplicate-definition');
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.message).toMatch(/reviewer/);
  });

  it('does not fire via the name path when both definitions share the same sourceKey', () => {
    const a = makeAgent({
      name: 'reviewer',
      sourceKey: 'repo:/one',
      body: 'Body one is unique text.',
    });
    const b = makeAgent({
      name: 'reviewer',
      sourceKey: 'repo:/one',
      body: 'A totally different body text.',
    });

    expect(duplicateDefinitionCheck.run(a, [a, b])).toEqual([]);
  });

  it('does not fire via the name path when sourceKey is undefined on either side', () => {
    const a = makeAgent({ name: 'reviewer', body: 'Body one is unique text.' });
    const b = makeAgent({ name: 'reviewer', body: 'A totally different body text.' });

    expect(duplicateDefinitionCheck.run(a, [a, b])).toEqual([]);
  });

  it('fires via the body-similarity path even without provable different sources', () => {
    const a = makeAgent({ name: 'a', body: 'reviews pull requests for style bugs' });
    const b = makeAgent({ name: 'b', body: 'reviews pull requests for style bugs' });

    const findings = duplicateDefinitionCheck.run(a, [a, b]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/body/i);
  });

  it('never fires from a self-comparison', () => {
    const a = makeAgent({ name: 'reviewer', sourceKey: 'repo:/one' });

    expect(duplicateDefinitionCheck.run(a, [a])).toEqual([]);
  });

  it('emits each duplicate pair exactly once across a full fleet run (name path)', () => {
    const a = makeAgent({ name: 'reviewer', sourceKey: 'repo:/one' });
    const b = makeAgent({ name: 'reviewer', sourceKey: 'repo:/two' });
    const fleet = [a, b];

    const total = fleet.flatMap((member) => duplicateDefinitionCheck.run(member, fleet));

    expect(total).toHaveLength(1);
  });

  it('emits each duplicate pair exactly once across a full fleet run (body-similarity path)', () => {
    const a = makeAgent({ name: 'a', body: 'reviews pull requests for style bugs' });
    const b = makeAgent({ name: 'b', body: 'reviews pull requests for style bugs' });
    const fleet = [a, b];

    const total = fleet.flatMap((member) => duplicateDefinitionCheck.run(member, fleet));

    expect(total).toHaveLength(1);
  });
});

describe('FLEET_CHECKS', () => {
  it('registers both checks by id', () => {
    expect(FLEET_CHECKS.map((c) => c.id)).toEqual([
      'fleet/duplicate-trigger',
      'fleet/duplicate-definition',
    ]);
  });
});
