import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONVENTIONS_STORE_VERSION, hashRules } from '../../core/index';
import { run } from '../index';

const RULES = {
  requiredKeys: ['name', 'description'],
  allowedKeys: ['name', 'description', 'tools', 'model'],
  descriptionMinLength: 40,
  cuePatterns: ['use when', 'when the user'],
};

function cleanDef(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Use when the user wants a thorough review of changed code before merge.',
    'tools: Read, Grep',
    '---',
    'You are a reviewer.',
  ].join('\n');
}

describe('handler CLI: conventions command (Reqs 16-18)', () => {
  let dir: string;
  let registryPath: string;
  let conventionsPath: string;
  let repo: string;
  let agentsDir: string;
  let out: string[];

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-conv-')));
    registryPath = join(dir, 'sources.json');
    conventionsPath = join(dir, 'conventions.json');
    repo = join(dir, 'repo');
    agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    writeFileSync(
      conventionsPath,
      JSON.stringify({
        version: CONVENTIONS_STORE_VERSION,
        sourceHash: hashRules(RULES),
        lastSynced: new Date().toISOString(),
        rules: RULES,
      }),
      'utf8',
    );

    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, { registryPath, conventionsPath, out: (line) => out.push(line) });

  it('prints a fresh staleness header and per-agent violations and clean lines', async () => {
    writeFileSync(join(agentsDir, 'code-reviewer.md'), cleanDef('code-reviewer'), 'utf8');
    writeFileSync(join(agentsDir, 'bad-agent.md'), '---\nname: Bad_Name\n---\nbody', 'utf8');
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['conventions'])).toBe(0);
    const report = out.join('\n');

    expect(report).toMatch(/conventions:\s+fresh/);
    expect(report).toContain('code-reviewer');
    expect(report).toContain('no violations');
    expect(report).toContain('bad-agent');
    expect(report).toContain('16a');
    expect(report).toContain('16b');
  });

  it('prints a stale header instructing the user to run the sync skill when conventions are missing', async () => {
    writeFileSync(join(agentsDir, 'code-reviewer.md'), cleanDef('code-reviewer'), 'utf8');
    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await run(['conventions'], {
      registryPath,
      conventionsPath: join(dir, 'absent.json'),
      out: (line) => out.push(line),
    });
    expect(code).toBe(0);
    const report = out.join('\n');
    expect(report).toMatch(/conventions:\s+stale \(missing\)/);
    expect(report).toMatch(/sync skill/);
  });
});
