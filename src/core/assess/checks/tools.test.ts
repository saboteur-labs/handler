import { describe, expect, it } from 'vitest';

import type { ParsedDefinition } from '../parse';
import {
  DEFAULT_MAX_TOOLS,
  overBroadCheck,
  redundantWildcardCheck,
  spawnLoopCheck,
  TOOLS_CHECKS,
} from './tools';

function makeAgent(overrides: Partial<ParsedDefinition> & { name: string }): ParsedDefinition {
  return {
    description: 'A test agent',
    model: undefined,
    scope: { declared: true, granted: new Set(), spawnTargets: new Set() },
    body: 'You do things.',
    hasFrontmatter: true,
    ...overrides,
  };
}

describe('tools/spawn-loop', () => {
  it('fires on a two-node cycle, naming the cycle path', () => {
    const a = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['Agent(b)']), spawnTargets: new Set(['b']) },
    });
    const b = makeAgent({
      name: 'b',
      scope: { declared: true, granted: new Set(['Agent(a)']), spawnTargets: new Set(['a']) },
    });
    const fleet = [a, b];

    const findingsA = spawnLoopCheck.run(a, fleet);
    const findingsB = spawnLoopCheck.run(b, fleet);

    expect(findingsA).toHaveLength(1);
    expect(findingsA[0]?.check).toBe('tools/spawn-loop');
    expect(findingsA[0]?.severity).toBe('error');
    expect(findingsA[0]?.message).toMatch(/a -> b -> a/);

    expect(findingsB).toHaveLength(1);
    expect(findingsB[0]?.message).toMatch(/b -> a -> b/);
  });

  it('fires on a self-spawn', () => {
    const a = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['Agent(a)']), spawnTargets: new Set(['a']) },
    });
    const fleet = [a];

    const findings = spawnLoopCheck.run(a, fleet);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/self-spawn/i);
    expect(findings[0]?.message).toMatch(/a/);
  });

  it('does not miss a self-spawn when a same-named agent from another source is parsed after it', () => {
    // Regression: the spawn graph is keyed by name; a clean 'dup' from another
    // source must not overwrite the self-spawning 'dup' (edges are merged, not
    // clobbered), so the cycle is still detected regardless of fleet order.
    const selfSpawn = makeAgent({
      name: 'dup',
      sourceKey: 'user:/home',
      scope: { declared: true, granted: new Set(['Agent(dup)']), spawnTargets: new Set(['dup']) },
    });
    const cleanDup = makeAgent({
      name: 'dup',
      sourceKey: 'repo:/work',
      scope: { declared: true, granted: new Set(['Read']), spawnTargets: new Set() },
    });

    // The clean same-named agent is parsed AFTER the self-spawner.
    expect(spawnLoopCheck.run(selfSpawn, [selfSpawn, cleanDup])).toHaveLength(1);
    // And BEFORE it — merge is order-independent.
    expect(spawnLoopCheck.run(selfSpawn, [cleanDup, selfSpawn])).toHaveLength(1);
  });

  it('does not fire on a no-cycle fleet', () => {
    const a = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['Agent(b)']), spawnTargets: new Set(['b']) },
    });
    const b = makeAgent({
      name: 'b',
      scope: { declared: true, granted: new Set(), spawnTargets: new Set() },
    });
    const fleet = [a, b];

    expect(spawnLoopCheck.run(a, fleet)).toEqual([]);
    expect(spawnLoopCheck.run(b, fleet)).toEqual([]);
  });

  it('does not treat a wildcard spawn grant as a self/cycle edge', () => {
    const a = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['Agent(*)']), spawnTargets: new Set(['*']) },
    });
    const fleet = [a];

    expect(spawnLoopCheck.run(a, fleet)).toEqual([]);
  });

  it('returns no finding for an agent with no name', () => {
    const anon = makeAgent({ name: 'anon' });
    const noName: ParsedDefinition = { ...anon, name: undefined };

    expect(spawnLoopCheck.run(noName, [noName])).toEqual([]);
  });
});

describe('tools/redundant-wildcard', () => {
  it('fires when a wildcard tool grant is present alongside named tools', () => {
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['*', 'Read', 'Write']), spawnTargets: new Set() },
    });

    const findings = redundantWildcardCheck.run(agent, [agent]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('tools/redundant-wildcard');
    expect(findings[0]?.severity).toBe('warn');
    expect(findings[0]?.message).toMatch(/Read/);
    expect(findings[0]?.message).toMatch(/Write/);
  });

  it('fires when a wildcard spawn grant is present alongside named spawn grants', () => {
    const agent = makeAgent({
      name: 'a',
      scope: {
        declared: true,
        granted: new Set(['Agent(*)', 'Agent(b)']),
        spawnTargets: new Set(['*', 'b']),
      },
    });

    const findings = redundantWildcardCheck.run(agent, [agent]);

    expect(findings).toHaveLength(1);
    // The message lists the redundant spawn TARGET name (from spawnTargets),
    // not the raw `Agent(b)` grant token.
    expect(findings[0]?.message).toMatch(/spawn grant\(s\) redundant: b/);
  });

  it('does not fire when only a wildcard is granted (nothing redundant)', () => {
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['*']), spawnTargets: new Set() },
    });

    expect(redundantWildcardCheck.run(agent, [agent])).toEqual([]);
  });

  it('does not fire when only named tools are granted (no wildcard)', () => {
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['Read', 'Write']), spawnTargets: new Set() },
    });

    expect(redundantWildcardCheck.run(agent, [agent])).toEqual([]);
  });
});

describe('tools/over-broad', () => {
  it('does not fire at the maxTools boundary (count equals threshold)', () => {
    const granted = new Set(Array.from({ length: 10 }, (_, i) => `Tool${i}`));
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted, spawnTargets: new Set() },
    });

    expect(overBroadCheck.run(agent, [agent])).toEqual([]);
  });

  it('fires one over the maxTools threshold', () => {
    const granted = new Set(Array.from({ length: 11 }, (_, i) => `Tool${i}`));
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted, spawnTargets: new Set() },
    });

    const findings = overBroadCheck.run(agent, [agent]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('tools/over-broad');
    expect(findings[0]?.severity).toBe('info');
  });

  it('respects a configured maxTools option', () => {
    const granted = new Set(['Read', 'Write', 'Edit']);
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted, spawnTargets: new Set() },
    });

    expect(overBroadCheck.run(agent, [agent])).toEqual([]);
    expect(overBroadCheck.run(agent, [agent], { maxTools: 2 })).toHaveLength(1);
  });

  it('fires on a wildcard scope regardless of count', () => {
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['*']), spawnTargets: new Set() },
    });

    const findings = overBroadCheck.run(agent, [agent]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/wildcard/i);
  });

  it('uses DEFAULT_MAX_TOOLS when no option is provided', () => {
    expect(DEFAULT_MAX_TOOLS).toBeGreaterThan(0);
    const granted = new Set(Array.from({ length: DEFAULT_MAX_TOOLS }, (_, i) => `Tool${i}`));
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted, spawnTargets: new Set() },
    });

    expect(overBroadCheck.run(agent, [agent])).toEqual([]);
  });

  it('does not count Agent(...) spawn grants toward the maxTools threshold', () => {
    // Regression: one real tool plus many spawn grants must NOT read as
    // over-broad — spawn breadth is not tool breadth (it has its own check).
    const spawns = Array.from({ length: DEFAULT_MAX_TOOLS + 5 }, (_, i) => `Agent(x${i})`);
    const agent = makeAgent({
      name: 'a',
      scope: {
        declared: true,
        granted: new Set(['Read', ...spawns]),
        spawnTargets: new Set(spawns.map((_, i) => `x${i}`)),
      },
    });

    expect(overBroadCheck.run(agent, [agent], { maxTools: 2 })).toEqual([]);
  });

  it('flags a whitespace-formatted wildcard spawn grant (Agent( * )) as over-broad', () => {
    // Regression: the check keys off structured spawnTargets, so `Agent( * )`
    // (inner spaces) — which normalizes to spawnTargets {'*'} — is caught even
    // though its raw granted token is not the literal 'Agent(*)'.
    const agent = makeAgent({
      name: 'a',
      scope: { declared: true, granted: new Set(['Agent( * )']), spawnTargets: new Set(['*']) },
    });

    const findings = overBroadCheck.run(agent, [agent]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/wildcard/i);
  });
});

describe('TOOLS_CHECKS', () => {
  it('registers all three checks by id', () => {
    expect(TOOLS_CHECKS.map((c) => c.id)).toEqual([
      'tools/spawn-loop',
      'tools/redundant-wildcard',
      'tools/over-broad',
    ]);
  });
});
