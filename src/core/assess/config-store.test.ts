import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_STORE_VERSION, defaultUserConfigPath, resolvePolicy } from './config-store';

describe('defaultUserConfigPath', () => {
  it('points at ~/.handler/config.json', () => {
    expect(defaultUserConfigPath()).toMatch(/\.handler[/\\]config\.json$/);
  });
});

describe('resolvePolicy — built-in defaults', () => {
  it('resolves every spec-defined check id to its built-in default when no config is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handler-config-'));
    const userConfigPath = join(dir, 'missing-user.json');
    const policy = resolvePolicy({ userConfigPath });
    rmSync(dir, { recursive: true, force: true });

    expect(policy.get('tools/spawn-loop')).toEqual({ enabled: true, severity: 'error' });
    expect(policy.get('tools/redundant-wildcard')).toEqual({ enabled: true, severity: 'warn' });
    expect(policy.get('tools/over-broad')).toEqual({ enabled: true, severity: 'info' });
    expect(policy.get('prompt/empty-body')).toEqual({ enabled: true, severity: 'error' });
    expect(policy.get('prompt/size')).toEqual({ enabled: true, severity: 'info' });
    expect(policy.get('fleet/duplicate-trigger')).toEqual({ enabled: true, severity: 'warn' });
    expect(policy.get('fleet/duplicate-definition')).toEqual({ enabled: true, severity: 'info' });
  });

  it('defaults prompt/no-examples to disabled with no config present at all (FR-13)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handler-config-'));
    const userConfigPath = join(dir, 'missing-user.json');
    const policy = resolvePolicy({ userConfigPath });
    rmSync(dir, { recursive: true, force: true });

    expect(policy.get('prompt/no-examples')).toEqual({ enabled: false, severity: 'info' });
  });
});

describe('resolvePolicy — config file loading', () => {
  let dir: string;
  let userConfigPath: string;
  let repoConfigPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'handler-config-'));
    userConfigPath = join(dir, 'user-config.json');
    repoConfigPath = join(dir, 'repo-config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a shorthand string config value', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'prompt/no-examples': 'warn' },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    expect(policy.get('prompt/no-examples')).toEqual({ enabled: true, severity: 'warn' });
  });

  it('treats the "off" shorthand as enabled: false', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/over-broad': 'off' },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    expect(policy.get('tools/over-broad')).toEqual({ enabled: false, severity: 'info' });
  });

  it('accepts the object config-value form, partial fields only', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/over-broad': { severity: 'error' } },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    // enabled stays true (the built-in default), only severity is overridden.
    expect(policy.get('tools/over-broad')).toEqual({ enabled: true, severity: 'error' });
  });

  it('passes options through into the resolved PolicyEntry', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/over-broad': { options: { maxTools: 5 } } },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    expect(policy.get('tools/over-broad')).toEqual({
      enabled: true,
      severity: 'info',
      options: { maxTools: 5 },
    });
  });

  it('lets repo config override user config, field by field (repo wins)', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/over-broad': { severity: 'warn' } },
      }),
      'utf8',
    );
    writeFileSync(
      repoConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/over-broad': { enabled: false } },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath, repoConfigPath });
    // repo only set `enabled`; the user's `severity: warn` override survives.
    expect(policy.get('tools/over-broad')).toEqual({ enabled: false, severity: 'warn' });
  });

  it('lets repo config win outright when both set the same field', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/spawn-loop': 'warn' },
      }),
      'utf8',
    );
    writeFileSync(
      repoConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/spawn-loop': 'off' },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath, repoConfigPath });
    expect(policy.get('tools/spawn-loop')).toEqual({ enabled: false, severity: 'warn' });
  });

  it('degrades a corrupt user config file to "as if absent" rather than throwing', () => {
    writeFileSync(userConfigPath, '{ not valid json', 'utf8');
    expect(() => resolvePolicy({ userConfigPath })).not.toThrow();
    const policy = resolvePolicy({ userConfigPath });
    expect(policy.get('tools/spawn-loop')).toEqual({ enabled: true, severity: 'error' });
  });

  it('degrades a corrupt repo config file to "as if absent" rather than throwing', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/spawn-loop': 'warn' },
      }),
      'utf8',
    );
    writeFileSync(repoConfigPath, '{ not valid json', 'utf8');
    expect(() => resolvePolicy({ userConfigPath, repoConfigPath })).not.toThrow();
    const policy = resolvePolicy({ userConfigPath, repoConfigPath });
    // User override still applies; repo contributes nothing.
    expect(policy.get('tools/spawn-loop')).toEqual({ enabled: true, severity: 'warn' });
  });

  it('degrades a wrong-version user config file to "as if absent"', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION + 1,
        checks: { 'tools/spawn-loop': 'warn' },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    expect(policy.get('tools/spawn-loop')).toEqual({ enabled: true, severity: 'error' });
  });

  it('degrades a wrong-version repo config file to "as if absent"', () => {
    writeFileSync(
      repoConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION + 1,
        checks: { 'tools/spawn-loop': 'off' },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath, repoConfigPath });
    expect(policy.get('tools/spawn-loop')).toEqual({ enabled: true, severity: 'error' });
  });

  it('resolves an id present only in user/repo config with no built-in default', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'conventions/16a': 'warn' },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    expect(policy.get('conventions/16a')).toEqual({ enabled: true, severity: 'warn' });
  });

  it('skips only a malformed per-check entry, not the whole config file', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/over-broad': 'warn', 'prompt/size': 12345 },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    // The valid entry still applies...
    expect(policy.get('tools/over-broad')).toEqual({ enabled: true, severity: 'warn' });
    // ...while the malformed entry's id falls back to its own built-in default,
    // rather than the whole file degrading to "missing".
    expect(policy.get('prompt/size')).toEqual({ enabled: true, severity: 'info' });
  });

  it('does not read any config when the repo path is omitted entirely', () => {
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: { 'tools/spawn-loop': 'warn' },
      }),
      'utf8',
    );
    const policy = resolvePolicy({ userConfigPath });
    expect(policy.get('tools/spawn-loop')).toEqual({ enabled: true, severity: 'warn' });
  });
});
