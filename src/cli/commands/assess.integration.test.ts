/**
 * End-to-end integration test for `handler assess` (feature-static-assessment
 * Task 9): a single realistic fixture repo, registered as a real source, with
 * a real `<repo>/.handler/config.json` on disk, exercised through the actual
 * CLI entrypoint (`run`) — no mocked checks, no mocked config loading. Each
 * fixture definition is chosen to trip exactly one specific check id so this
 * test proves the whole pipeline (source enumeration -> snapshot loading ->
 * parsing -> policy resolution -> check execution -> suppression
 * partitioning -> CLI rendering -> exit-code decision) end to end, on top of
 * the already-gate-verified production code from Tasks 1-8.
 *
 * Pattern mirrors `conventions.test.ts` (mkdtempSync + realpathSync.native
 * temp repo, `source register`, inline `.md` fixtures) and `assess.test.ts`
 * (CliContext wiring for `userConfigPath`/`repoConfigPath`).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_STORE_VERSION } from '../../core/index';
import { run } from '../index';

describe('handler CLI: assess end-to-end integration (feature-static-assessment Task 9)', () => {
  let dir: string;
  let registryPath: string;
  let userConfigPath: string;
  let repoConfigPath: string;
  let repo: string;
  let agentsDir: string;
  let out: string[];

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'handler-assess-e2e-')));
    registryPath = join(dir, 'sources.json');
    // Point the user-level config somewhere that will never exist, so only
    // the real repo config (written below) contributes overrides — isolates
    // this test from any real `~/.handler/config.json` on the host.
    userConfigPath = join(dir, 'user-config-absent.json');
    repo = join(dir, 'repo');
    agentsDir = join(repo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    repoConfigPath = join(repo, '.handler', 'config.json');
    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const invoke = (args: string[]): Promise<number> =>
    run(args, { registryPath, userConfigPath, repoConfigPath, out: (line) => out.push(line) });

  /**
   * Fixture 1 — a real two-agent `Agent(...)` spawn cycle: `looper-a` grants
   * `Agent(looper-b)`, `looper-b` grants `Agent(looper-a)`. Trips
   * `tools/spawn-loop` (error) for BOTH members (each cycle member gets its
   * own finding when it's the check's `agent` argument — see
   * `checks/tools.ts`'s `spawnLoopCheck` doc comment).
   */
  function writeSpawnCycleFixture(): void {
    writeFileSync(
      join(agentsDir, 'looper-a.md'),
      [
        '---',
        'name: looper-a',
        'description: Use when the user wants agent A of a deliberate two-agent loop test.',
        'tools: Read, Agent(looper-b)',
        '---',
        'You are looper-a, part of a deliberate spawn cycle for testing.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(agentsDir, 'looper-b.md'),
      [
        '---',
        'name: looper-b',
        'description: Use when the user wants agent B of a deliberate two-agent loop test.',
        'tools: Read, Agent(looper-a)',
        '---',
        'You are looper-b, part of a deliberate spawn cycle for testing.',
      ].join('\n'),
      'utf8',
    );
  }

  /**
   * Fixture 2 — valid frontmatter, no body at all after the closing fence.
   * Trips `prompt/empty-body` (error).
   */
  function writeEmptyBodyFixture(): void {
    writeFileSync(
      join(agentsDir, 'empty.md'),
      [
        '---',
        'name: empty',
        'description: A definition with frontmatter but no prompt body.',
        '---',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  /**
   * Fixture 3 — a wildcard tool grant ALONGSIDE named tools (`Read`, `Write`,
   * `*`). This deliberately trips two `tools` checks at once rather than
   * being split into two separate fixtures:
   *   - `tools/over-broad` (info, on by default): fires because the grant
   *     set includes the wildcard token `*`.
   *   - `tools/redundant-wildcard` (warn, on by default): fires because the
   *     wildcard is present alongside named tools of the same family
   *     (`Read`, `Write`), which the wildcard already subsumes.
   * Combining them is intentional and documented here: both checks are
   * single-agent, side-effect-free, and share the same triggering grant list,
   * so one fixture definition legitimately trips both without any
   * gymnastics — no need for a second, separate wildcard-only fixture.
   */
  function writeWildcardToolFixture(): void {
    writeFileSync(
      join(agentsDir, 'wildcard-tool.md'),
      [
        '---',
        'name: wildcard-tool',
        'description: Use when the user needs an agent with an intentionally over-broad tool grant.',
        'tools: Read, Write, *',
        '---',
        'You are an agent with deliberately over-broad tool access for testing.',
      ].join('\n'),
      'utf8',
    );
  }

  /**
   * Fixture 4 — two distinct agents (`reviewer-x`, `reviewer-y`) whose
   * descriptions differ by exactly one trailing word, chosen so their
   * token-set Jaccard similarity (see `../../core/assess/similarity.ts`)
   * comfortably clears the 0.8 default threshold used by
   * `fleet/duplicate-trigger` (warn).
   *
   * Arithmetic (mirrors `similarity.ts`'s `tokenize`: lowercase, split on
   * runs of non-alphanumeric chars, drop the stopword set
   * {the, a, an, and, or, of, to, in, for, is, are, on, with, this, that}):
   *
   *   Description X: "Use when the user wants a thorough review of changed
   *     code before merge for quality control."
   *   Description Y: "Use when the user wants a thorough review of changed
   *     code before merge for quality assurance."
   *
   *   Raw lowercase split of X: use, when, the, user, wants, a, thorough,
   *     review, of, changed, code, before, merge, for, quality, control
   *   Drop stopwords (the, a, of, for) -> Set(X) has 12 tokens:
   *     {use, when, user, wants, thorough, review, changed, code, before,
   *      merge, quality, control}
   *
   *   Raw lowercase split of Y is identical except the final word
   *     ("assurance" instead of "control") -> Set(Y) also has 12 tokens:
   *     {use, when, user, wants, thorough, review, changed, code, before,
   *      merge, quality, assurance}
   *
   *   Intersection = every token except the one differing word on each side
   *     = 11 tokens: {use, when, user, wants, thorough, review, changed,
   *       code, before, merge, quality}
   *   Union = |X| + |Y| - |intersection| = 12 + 12 - 11 = 13
   *   Similarity = 11 / 13 ≈ 0.846, which is >= 0.8 — the fixture trips
   *   `fleet/duplicate-trigger` with a comfortable margin (not a
   *   boundary-exact 0.80, so it is robust to any future stopword-list
   *   tweak that shifts the count by one token in either direction).
   */
  function writeDuplicateDescriptionFixture(): void {
    writeFileSync(
      join(agentsDir, 'reviewer-x.md'),
      [
        '---',
        'name: reviewer-x',
        'description: Use when the user wants a thorough review of changed code before merge for quality control.',
        'tools: Read',
        '---',
        'You review changes carefully, checking correctness line by line.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(agentsDir, 'reviewer-y.md'),
      [
        '---',
        'name: reviewer-y',
        'description: Use when the user wants a thorough review of changed code before merge for quality assurance.',
        'tools: Read',
        '---',
        'You audit diffs independently, looking for regressions and risk.',
      ].join('\n'),
      'utf8',
    );
  }

  /**
   * Repo config (`<repo>/.handler/config.json`):
   *   - Turns OFF `tools/over-broad`, a check that IS actually firing (on
   *     `wildcard-tool.md`) — proves suppression is honored end to end, not
   *     just that a no-op override was accepted.
   *   - Enables `prompt/no-examples` (off by default), which fires on every
   *     fixture here since none of their bodies contain an `<example>`
   *     marker — proves the opt-in path resolves and actually changes what
   *     is surfaced, not just that resolution returns the right policy in
   *     isolation.
   */
  function writeRepoConfig(): void {
    mkdirSync(join(repo, '.handler'), { recursive: true });
    writeFileSync(
      repoConfigPath,
      JSON.stringify({
        version: CONFIG_STORE_VERSION,
        checks: {
          'tools/over-broad': 'off',
          'prompt/no-examples': 'warn',
        },
      }),
      'utf8',
    );
  }

  function writeFullFixtureFleet(): void {
    writeSpawnCycleFixture();
    writeEmptyBodyFixture();
    writeWildcardToolFixture();
    writeDuplicateDescriptionFixture();
    writeRepoConfig();
  }

  it('surfaces every expected finding and honors the repo config end to end (`assess`, all categories)', async () => {
    writeFullFixtureFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['assess']);
    const report = out.join('\n');

    // Spawn-loop error names both cycle members.
    expect(report).toContain('tools/spawn-loop');
    expect(report).toContain('looper-a');
    expect(report).toContain('looper-b');

    // Empty-body error.
    expect(report).toContain('prompt/empty-body');
    expect(report).toContain('empty');

    // Duplicate-trigger warning between the two near-duplicate descriptions.
    expect(report).toContain('fleet/duplicate-trigger');
    expect(report).toContain('reviewer-x');
    expect(report).toContain('reviewer-y');

    // The check turned OFF by repo config must not appear as a surfaced
    // finding in the default (non `--all`) rendering, even though it is
    // actually firing on `wildcard-tool.md` — it legitimately appears in
    // the suppressed-findings footer (asserted separately below), so this
    // only rules out it being rendered as a surfaced finding line (severity
    // `info`, per `tools/over-broad`'s default severity).
    expect(report).not.toContain('[info] tools/over-broad');

    // The check turned ON by repo config (off by default) must appear,
    // proving the opt-in path is honored end to end.
    expect(report).toContain('prompt/no-examples');

    // Worst surfaced severity is `error` (spawn-loop, empty-body), so the
    // default `--fail-on error` threshold must trip a non-zero exit.
    expect(code).toBe(1);
  });

  it('reflects the repo-config-suppressed check in the footer, and reveals it under --all', async () => {
    writeFullFixtureFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    await invoke(['assess']);
    const report = out.join('\n');

    // `tools/over-broad` fires exactly once (only `wildcard-tool.md` grants
    // a wildcard), and it is the only check this test's repo config
    // explicitly disables that actually produced a finding — so the
    // suppressed-findings footer must show a count of exactly 1, naming
    // that check id. `prompt/no-examples` was explicitly re-enabled by the
    // same repo config, so none of its findings land in this count.
    expect(report).toMatch(/suppressed: 1 \(tools\/over-broad\)/);

    out.length = 0;
    await invoke(['assess', '--all']);
    const allReport = out.join('\n');
    expect(allReport).toContain('tools/over-broad');
    expect(allReport).toContain('(suppressed)');
  });

  it('exits non-zero under the default --fail-on (error) threshold', async () => {
    writeFullFixtureFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    expect(await invoke(['assess', '--fail-on', 'error'])).toBe(1);
  });

  it('exits zero under --fail-on error when only warn/info-level findings are present (`assess fleet`)', async () => {
    // Severity rank order (see `../format.ts`'s `SEVERITY_RANK`): error = 0
    // (most severe), warn = 1, info = 2 — "meets or exceeds" a threshold
    // means the finding's rank is <= the threshold's rank. `error` is
    // already rank 0, the maximum-severity end of the three-level scale, so
    // there is no way to express "a --fail-on threshold ABOVE error" within
    // this scale to test the inverse that way.
    //
    // Instead: `assess fleet` restricts the check registry to
    // `FLEET_CHECKS` only (`fleet/duplicate-trigger` = warn,
    // `fleet/duplicate-definition` = info) — neither check can ever produce
    // an `error`-severity finding, regardless of which agents are present.
    // So even against this test's full fixture fleet (which DOES contain
    // error-severity findings from `tools/spawn-loop` and
    // `prompt/empty-body` in other categories), `assess fleet --fail-on
    // error` must exit 0: the worst possible severity within the `fleet`
    // category (`warn`) never meets the `error` threshold.
    writeFullFixtureFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    const code = await invoke(['assess', 'fleet', '--fail-on', 'error']);
    const report = out.join('\n');

    // Sanity: the warn-level fleet finding is indeed present in this
    // invocation's output, so the zero exit code isn't merely a byproduct
    // of an empty report.
    expect(report).toContain('fleet/duplicate-trigger');
    expect(code).toBe(0);
  });

  it('derives repo config from cwd when repoConfigPath is not passed (real-bin wiring)', async () => {
    writeFullFixtureFleet();
    await invoke(['source', 'register', repo]);
    out.length = 0;

    // Mirror the real bin (`src/cli/main.ts`): pass NO explicit
    // `repoConfigPath`, only `cwd` pointing at the repo, and let `run()` derive
    // `<cwd>/.handler/config.json`. This proves the repo's committed policy is
    // honored end to end through the default derivation — the wiring the bin
    // actually exercises — not only when the path is injected explicitly.
    const code = await run(['assess'], {
      registryPath,
      userConfigPath,
      cwd: repo,
      out: (line) => out.push(line),
    });
    const report = out.join('\n');

    // Both effects require the cwd-derived repo config to have loaded:
    // `prompt/no-examples` is off by default (repo config re-enables it), and
    // `tools/over-broad` is on by default (repo config disables it, so it is
    // suppressed rather than surfaced but still footer-counted).
    expect(report).toContain('prompt/no-examples');
    expect(report).not.toContain('[info] tools/over-broad');
    expect(report).toMatch(/suppressed: 1 \(tools\/over-broad\)/);
    expect(code).toBe(1);
  });
});
