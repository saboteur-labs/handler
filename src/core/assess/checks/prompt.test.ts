import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';

import { runChecks } from '../run-checks';
import { CONFIG_STORE_VERSION, resolvePolicy } from '../config-store';
import type { ParsedDefinition } from '../parse';
import {
  DEFAULT_MAX_TOKENS,
  emptyBodyCheck,
  noExamplesCheck,
  PROMPT_CHECKS,
  sizeCheck,
} from './prompt';

function makeAgent(overrides: Partial<ParsedDefinition> & { name?: string }): ParsedDefinition {
  return {
    name: 'a',
    description: 'A test agent',
    model: undefined,
    scope: { declared: true, granted: new Set(), spawnTargets: new Set() },
    body: 'You do things.',
    hasFrontmatter: true,
    ...overrides,
  };
}

describe('prompt/empty-body', () => {
  it('fires when frontmatter is present but the body is empty', () => {
    const agent = makeAgent({ body: '' });

    const findings = emptyBodyCheck.run(agent, [agent]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('prompt/empty-body');
    expect(findings[0]?.severity).toBe('error');
  });

  it('fires when the body is whitespace-only', () => {
    const agent = makeAgent({ body: '   \n\t  ' });

    expect(emptyBodyCheck.run(agent, [agent])).toHaveLength(1);
  });

  it('does not fire when the body is non-empty', () => {
    const agent = makeAgent({ body: 'You do things.' });

    expect(emptyBodyCheck.run(agent, [agent])).toEqual([]);
  });

  it('does not fire when there is no frontmatter block at all (hasFrontmatter false)', () => {
    // A snapshot with no frontmatter fence parses to hasFrontmatter: false —
    // an empty body is then a conventions 16a concern, not empty-body's.
    const agent = makeAgent({ hasFrontmatter: false, body: '' });

    expect(emptyBodyCheck.run(agent, [agent])).toEqual([]);
  });

  it('fires when frontmatter is present with only non-name/description keys and an empty body', () => {
    // Regression: hasFrontmatter must come from the authoritative present flag,
    // not a name/description proxy — a block declaring only `tools:` still
    // counts as present, so an empty body is a real empty-body finding.
    const agent = makeAgent({
      name: undefined,
      description: undefined,
      hasFrontmatter: true,
      body: '',
    });

    const findings = emptyBodyCheck.run(agent, [agent]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('prompt/empty-body');
  });
});

describe('prompt/no-examples', () => {
  it('fires when the body has no <example> marker', () => {
    const agent = makeAgent({ body: 'You do things. No examples here.' });

    const findings = noExamplesCheck.run(agent, [agent]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('prompt/no-examples');
    expect(findings[0]?.severity).toBe('info');
  });

  it('does not fire when the body has an <example> marker', () => {
    const agent = makeAgent({ body: 'You do things.\n<example>\ndo a thing\n</example>' });

    expect(noExamplesCheck.run(agent, [agent])).toEqual([]);
  });

  it('matches the example marker case-insensitively', () => {
    const agent = makeAgent({ body: 'You do things.\n<EXAMPLE>\ndo a thing\n</EXAMPLE>' });

    expect(noExamplesCheck.run(agent, [agent])).toEqual([]);
  });
});

describe('prompt/size', () => {
  it('does not fire at the maxTokens boundary (estimate equals threshold)', () => {
    // estimateTokens = ceil((name.length + description.length + 30 + body.length) / 4).
    // makeAgent defaults to name: 'a' (1 char), description: 'A test agent' (12 chars),
    // so frontmatterChars = 1 + 12 + 30 = 43. Solve bodyLength so the estimate lands
    // exactly on maxTokens * 4: 100 * 4 - 43 = 357.
    const maxTokens = 100;
    const bodyLength = maxTokens * 4 - 43;
    const agent = makeAgent({ body: 'x'.repeat(bodyLength) });

    expect(sizeCheck.run(agent, [agent], { maxTokens })).toEqual([]);
  });

  it('fires one estimated token over the maxTokens threshold', () => {
    // One estimated token over means 4 more chars than the exact boundary above.
    const maxTokens = 100;
    const bodyLength = maxTokens * 4 - 43 + 4;
    const agent = makeAgent({ body: 'x'.repeat(bodyLength) });

    const findings = sizeCheck.run(agent, [agent], { maxTokens });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('prompt/size');
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.message).toMatch(/per-run cost proxy/);
  });

  it('uses DEFAULT_MAX_TOKENS when no option is provided', () => {
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThan(0);
    const agent = makeAgent({ body: 'short body' });

    expect(sizeCheck.run(agent, [agent])).toEqual([]);
  });

  it('respects a configured maxTokens option', () => {
    const agent = makeAgent({ body: 'x'.repeat(1000) });

    expect(sizeCheck.run(agent, [agent])).toEqual([]);
    expect(sizeCheck.run(agent, [agent], { maxTokens: 10 })).toHaveLength(1);
  });
});

describe('PROMPT_CHECKS', () => {
  it('registers all three checks by id', () => {
    expect(PROMPT_CHECKS.map((c) => c.id)).toEqual([
      'prompt/empty-body',
      'prompt/no-examples',
      'prompt/size',
    ]);
  });
});

describe('prompt/no-examples — default policy suppression (end-to-end)', () => {
  let dir: string;
  let userConfigPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-prompt-config-'));
    userConfigPath = join(dir, 'missing-user.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is suppressed under default policy, and surfaces once enabled via config', () => {
    const agent = makeAgent({ body: 'You do things. No examples here.' });

    const defaultPolicy = resolvePolicy({ userConfigPath });
    const defaultFindings = runChecks(PROMPT_CHECKS, agent, [agent], defaultPolicy);
    expect(defaultFindings.some((f) => f.check === 'prompt/no-examples')).toBe(false);

    writeFileSync(
      userConfigPath,
      JSON.stringify({ version: CONFIG_STORE_VERSION, checks: { 'prompt/no-examples': 'info' } }),
      'utf8',
    );
    const enabledPolicy = resolvePolicy({ userConfigPath });
    const enabledFindings = runChecks(PROMPT_CHECKS, agent, [agent], enabledPolicy);
    expect(enabledFindings.some((f) => f.check === 'prompt/no-examples')).toBe(true);
  });
});
