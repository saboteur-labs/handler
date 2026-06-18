# Task List: Feature 4 — Static definition assessment & conventions sync

**Feature source:** `docs/specs/feature-4-conventions-assessment.md`
**Requirements covered:** spec Reqs 16, 17, 18, 19 (`docs/spec.md`)
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor.

Builds on Feature 1 (source registry, `loadDefinitionSnapshot`, identity) and reuses `extractFrontmatter` from `src/core/scoring/scope.ts`. The deterministic checks (16a–e) are **parameterized by the distilled conventions artifact** (allowed frontmatter keys, required keys, description min-length, cue patterns) so the standard stays current without code changes. handler reads the artifact only — the fetch/distill lives in the sync skill (Reqs 18–19), keeping handler offline.

---

### Task 1: Frontmatter key/value parser

**What:** Parse a definition snapshot's frontmatter into an ordered map of declared keys → raw values, distinguishing "no frontmatter" from "empty frontmatter".
**Files:** `src/core/conventions/frontmatter.ts` (+ test).
**Done when:** given a snapshot, returns the set/map of top-level frontmatter keys and their scalar values; reuses `extractFrontmatter`; absent/garbled frontmatter yields a clear empty/None result without throwing; tests cover present keys, missing frontmatter, and a malformed block.
**Depends on:** none
**Estimate:** 2
**Notes:** Supports 16a (name/description present), 16b (name value), 16c (description value), 16e (key enumeration for unrecognized-key detection). `tools` presence (16d) reuses the existing `parseToolScope`. Minimal YAML — top-level `key: value` scalars only; nested/block values captured as raw text, not deep-parsed.
**Done:** [x]

### Task 2: Conventions artifact schema + offline reader store

**What:** Define the versioned conventions-artifact shape and a read-only loader that degrades gracefully when the artifact is absent or malformed.
**Files:** `src/core/conventions/conventions-store.ts` (+ test).
**Done when:** types define `{version, sourceHash, lastSynced, rules:{requiredKeys, allowedKeys, descriptionMinLength, cuePatterns}}`; a loader reads the default path (`~/.handler/conventions.json`), returns a typed artifact or a "missing" sentinel; a structurally-invalid or wrong-schema-version file degrades to "missing" rather than throwing; **no network calls**; tests cover load, missing file, malformed file, and version mismatch.
**Depends on:** none
**Estimate:** 3
**Notes:** Mirrors `RunStore`/`ScoreStore` versioning (`CONVENTIONS_STORE_VERSION`, `defaultConventionsPath()`). Reader-only on handler's side (the skill writes it). Reqs 18, 19. The 16c default threshold is ≥40 chars (spec Req 16c) — shipped in the artifact, not hard-coded, so it stays tunable.
**Done:** [x]

### Task 3: Staleness evaluation

**What:** Given a loaded artifact (or missing), compute whether conventions are stale and why.
**Files:** `src/core/conventions/staleness.ts` (+ test).
**Done when:** returns a stale state of `missing` | `hash-mismatch` | `expired` | `fresh`, where stale = artifact absent OR recorded `sourceHash` does not match the rule set it was distilled from OR `lastSynced` older than a 30-day TTL constant; tests cover each branch and the TTL boundary.
**Depends on:** 2
**Estimate:** 2
**Notes:** Req 18. `STALE_TTL_DAYS = 30` documented constant. Hash-mismatch is detected by recomputing the artifact's own integrity hash over its rule set and comparing to the stored `sourceHash` (catches a hand-edited/corrupt artifact); cross-machine clock skew is out of scope.
**Done:** [x]

### Task 4: Convention checks engine (16a–e + undeclared-scope smell)

**What:** Run the deterministic checks against a parsed definition using the artifact's rule set, emitting one violation per failed check citing its rule id.
**Files:** `src/core/conventions/checks.ts` (+ test).
**Done when:** produces violations for 16a (frontmatter parses + has `name`/`description`), 16b (`name` kebab-case and equals filename stem), 16c (`description` non-empty, ≥ `descriptionMinLength`, ≥1 cue match), 16d (`tools` present + non-empty), 16e (no key outside `allowedKeys`); each violation carries `{rule: '16a'…, message}`; a failing 16d additionally surfaces an `undeclared-scope` smell (Req 17); tests cover one pass and one failure per rule, plus the undeclared-scope smell.
**Depends on:** 1, 2
**Estimate:** 3
**Notes:** Reqs 16, 17. Takes the filename stem as input (for 16b). Cue detection (16c) matches the artifact's `cuePatterns` (e.g. "use when"/"when the user") case-insensitively. Reuse `parseToolScope` for 16d. Pure function — no I/O.
**Done:** [x]

### Task 5: Assessment orchestrator over registered definitions

**What:** For every registered source, enumerate its agent definitions, load each snapshot, run the checks, and return per-agent violation results plus the conventions staleness state.
**Files:** `src/core/conventions/assess.ts` (+ test), `src/core/index.ts` (exports).
**Done when:** `assessConventions({sources, conventionsPath?})` returns, per `(source, name)`, the agent identity and its violations, alongside the overall staleness state; an orphan/missing definition is skipped or tagged (not thrown); when conventions are missing, returns the staleness state with no violations rather than failing; tests cover a clean definition, a violating one, and the missing-conventions path.
**Depends on:** 3, 4
**Estimate:** 2
**Notes:** Reqs 16–18. Enumerates `<source.agentsDir>/*.md` and reuses `loadDefinitionSnapshot` + identity from Feature 1. Holds the orchestration; checks stay pure in Task 4.
**Done:** [x]

### Task 6: CLI surface — report violations + staleness

**What:** A CLI command that prints, per agent, its convention violations (rule id + message) and the conventions staleness state.
**Files:** `src/cli/commands/conventions.ts`, `src/cli/index.ts`, `src/cli/main.ts` (env wiring) (+ test).
**Done when:** `handler conventions` (and/or per-agent in `handler show`) prints each agent's violations citing rule ids and a header line for staleness (e.g. "conventions: stale (expired) — run the sync skill"); a clean agent prints "no violations"; the command holds no logic beyond calling `assessConventions`; conventions path injectable via `HANDLER_CONVENTIONS`; an integration test asserts violations and the staleness line render.
**Depends on:** 5
**Estimate:** 3
**Notes:** Req 16–18 surface. Thin-CLI pattern per Features 2–3. handler never invokes the skill — the staleness line only _instructs_ the user to run it (filesystem-only integration).
**Done:** [x]

### Task 7: Conventions sync skill (authored via skill-creator)

**What:** A Claude Code skill that fetches Anthropic's current subagent docs, distills them into the Task 2 artifact shape, writes `~/.handler/conventions.json`, and records `sourceHash` + `lastSynced`.
**Files:** `.claude/skills/handler-sync-conventions/` (shipped in-repo), authored with `skill-creator`.
**Done when:** invoking the skill fetches the docs (WebFetch), emits a valid artifact that handler's Task 2 loader accepts (correct `version`, `rules`, `sourceHash`, `lastSynced`), and a **failed fetch leaves any prior artifact intact** (no partial/empty overwrite); a dry run produces an artifact that loads without the "malformed" degrade path.
**Depends on:** 2
**Estimate:** 3
**Notes:** Reqs 18, 19 — the only network path, and it lives here, not in handler. **Not TDD** (skill authoring, not core code). Risk: distillation must yield a stable, schema-valid artifact deterministically enough that re-runs over unchanged docs produce the same `sourceHash`. The skill is a feature deliverable (spec FR8). The bundled `scripts/write-conventions.mjs` reproduces handler's `hashRules` byte-for-byte (verified: synced artifact reads back as `fresh`) and writes atomically (temp+rename) after validating the rules, so a failed/malformed distillation leaves the prior artifact intact.
**Done:** [x]

### Task 8: Generate, ship, and wire the shipped artifact

**What:** Run the sync skill once to generate the conventions artifact, commit it as the shipped default, and finalize barrel exports so checks work out of the box.
**Files:** shipped `conventions.json` (committed location, e.g. `assets/conventions.json` resolved by `defaultConventionsPath` fallback), `src/core/index.ts` (+ verification).
**Done when:** a skill-generated artifact is committed; a fresh install runs `handler conventions` and gets real violations (not "missing conventions"); `assessConventions`, the conventions store, and types are exported from the core barrel; `npm test`/`typecheck`/`lint`/`build` are clean.
**Depends on:** 5, 6, 7
**Estimate:** 2
**Notes:** Spec FR9 — ship a skill-generated artifact pre-merge. Decide the shipped-artifact resolution (bundled asset path vs. seeded into `~/.handler` on first run); the loader's default-path fallback should locate the shipped copy when `~/.handler/conventions.json` is absent. **Resolution chosen:** the skill-generated artifact is committed at `src/core/conventions/default-conventions.json` and imported into the store (inlined into the `dist` bundle by tsdown/vite — no fragile runtime path resolution); `loadConventionsWithDefault` returns it whenever the user artifact is absent (a present-but-corrupt user file keeps its degraded signal). Verified end-to-end against the built CLI: a fresh install with no `~/.handler/conventions.json` prints `conventions: fresh` with real per-agent violations. `.claude/**` excluded from ESLint (skill scripts run under Node, not the TS graph).
**Done:** [x]

---

## Summary

- **Total tasks:** 8
- **Total estimated effort:** 20 story points
- **Critical path:** Tasks 2 → 4 → 5 → 6 → 8 (13 points); Task 1 feeds Task 4, Task 3 feeds Task 5, and Task 7 (the skill) branches from Task 2 and rejoins at Task 8.
- **Risks:** **Task 7 (sync skill)** is the highest-uncertainty item — it is the only network path, is authored (not TDD'd), and must distill docs into a schema-valid, hash-stable artifact. **Task 4's 16c cue detection** is the most heuristic check and easiest to get subtly wrong (false pass/fail on description quality). **Task 2's graceful-degrade boundary** (missing vs. malformed vs. version mismatch) must never throw, since every downstream task reads through it. The Task 2 ↔ Task 7 contract (artifact shape) is the integration seam — keep the schema owned by Task 2 and conformed to by the skill.
