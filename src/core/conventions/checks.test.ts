import { describe, expect, it } from 'vitest';

import { checkConventions } from './checks';
import type { ConventionRules } from './conventions-store';

const RULES: ConventionRules = {
  requiredKeys: ['name', 'description'],
  allowedKeys: ['name', 'description', 'tools', 'model'],
  descriptionMinLength: 40,
  cuePatterns: ['use when', 'when the user'],
};

/** A definition that passes every check, for `code-reviewer`. */
function cleanDef(): string {
  return [
    '---',
    'name: code-reviewer',
    'description: Use when the user wants a thorough review of changed code before merge.',
    'tools: Read, Grep',
    '---',
    'You are a reviewer.',
  ].join('\n');
}

function rulesOf(stem: string, snapshot: string) {
  return checkConventions({ snapshot, filenameStem: stem, rules: RULES });
}

function ruleIds(snapshot: string, stem = 'code-reviewer'): string[] {
  return rulesOf(stem, snapshot).violations.map((v) => v.rule);
}

describe('checkConventions', () => {
  it('returns no violations or smells for a clean definition', () => {
    const result = rulesOf('code-reviewer', cleanDef());
    expect(result.violations).toEqual([]);
    expect(result.smells).toEqual([]);
  });

  it('16a passes with required keys and fails when one is missing', () => {
    expect(ruleIds(cleanDef())).not.toContain('16a');
    const noDescription = '---\nname: code-reviewer\ntools: Read\n---\nbody';
    expect(ruleIds(noDescription)).toContain('16a');
  });

  it('16a fails when there is no frontmatter at all', () => {
    expect(ruleIds('no frontmatter here')).toContain('16a');
  });

  it('16b fails when name is not kebab-case', () => {
    const def = cleanDef().replace('name: code-reviewer', 'name: Code_Reviewer');
    expect(ruleIds(def, 'Code_Reviewer')).toContain('16b');
  });

  it('16b fails when name does not match the filename stem', () => {
    expect(ruleIds(cleanDef(), 'other-name')).toContain('16b');
  });

  it('16c fails when the description is too short', () => {
    const def = cleanDef().replace(/description: .*/, 'description: use when reviewing');
    expect(ruleIds(def)).toContain('16c');
  });

  it('16c fails when the description has no triggering cue', () => {
    const def = cleanDef().replace(
      /description: .*/,
      'description: A reviewer that inspects changed code for correctness and style.',
    );
    expect(ruleIds(def)).toContain('16c');
  });

  it('16d fails and surfaces the undeclared-scope smell when tools is absent', () => {
    const def = cleanDef().replace('tools: Read, Grep\n', '');
    const result = rulesOf('code-reviewer', def);
    expect(result.violations.map((v) => v.rule)).toContain('16d');
    expect(result.smells).toContain('undeclared-scope');
  });

  it('16e fails for an unrecognized frontmatter key', () => {
    const def = cleanDef().replace('tools: Read, Grep', 'tools: Read, Grep\ncolor: blue');
    const result = rulesOf('code-reviewer', def);
    expect(result.violations.map((v) => v.rule)).toContain('16e');
    expect(result.violations.find((v) => v.rule === '16e')?.message).toContain('color');
  });

  it('does not surface the undeclared-scope smell when tools is declared', () => {
    expect(rulesOf('code-reviewer', cleanDef()).smells).not.toContain('undeclared-scope');
  });

  it('cites a stable rule id and a message on every violation', () => {
    const def = '---\nname: Bad_Name\n---\nbody';
    for (const violation of rulesOf('Bad_Name', def).violations) {
      expect(violation.rule).toMatch(/^16[a-e]$/);
      expect(violation.message.length).toBeGreaterThan(0);
    }
  });
});
