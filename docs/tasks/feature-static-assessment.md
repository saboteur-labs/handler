# Task List: Static definition assessment (`assess`) + check-suppression config

**Feature source:** `docs/specs/feature-static-assessment.md`
**Requirements covered:** feature-local FR-1–23 (that spec); relates MVP Req 15 (tool scope) and Reqs 16–19 (conventions enumeration/store patterns); US-19
**Branch:** `feature/static-assessment`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. All check logic lives in a new `src/core/assess/` module; the CLI stays a thin formatter. Fully deterministic and local: no network, no LLM, no reading of the synced conventions artifact or its staleness. Observe-only — `assess` reads definitions and never mutates a store, annotation, config, or definition.

Key architectural facts (reuse, don't reimplement):

- **Enumeration & snapshots:** reuse the same source enumeration `conventions` uses — `enumerateDefinitionNames`, `isBuiltinAgent` (builtin denylist), and `loadDefinitionSnapshot(source, name)` (`src/core/snapshot.ts`). Orphan (null snapshot) handling mirrors `assessConventions`.
- **Parsing:** extend existing parsers rather than adding new ones — `parseFrontmatter` (`src/core/conventions/frontmatter.ts`) for `name`/`description`/`model`, and `parseToolScope` / `extractFrontmatter` (`src/core/scoring/scope.ts`) for tool scope. The MVP tool-utilization scoring also calls `parseToolScope`, so extending it must not change its existing `declared`/`granted` output.
- **Config store:** a new versioned JSON store behind the existing `json-store` boundary (`src/core/store/json-store.ts`), degrading corrupt/wrong-version files to defaults exactly like `ScoreStore`/`conventions-store`.
- **Registry, not an if-chain:** unlike `conventions`' monolithic `checkConventions`, checks here are independent descriptors in a list, so the check set grows without editing a closed union.

Recommended build order gives an early walking skeleton: Tasks 1 → 2 → 3, then one check from Task 4, then 7 → 8 for end-to-end proof, then complete Tasks 4–6.

---

### Task 1: Definition parsing prerequisites — spawn targets, body, `ParsedDefinition` (core)

**What:** Add the two parsing capabilities the checks need and a small aggregation type over a definition snapshot.
**Files:** `src/core/scoring/scope.ts` (extend `ToolScope` + `parseToolScope`), `src/core/assess/parse.ts` (`extractBody`, `ParsedDefinition`, `parseDefinition`), tests; export from `src/core/index.ts`.
**Done when:** `parseToolScope` additionally returns `spawnTargets: ReadonlySet<string>` parsed from `Agent(...)` grants (`Agent(a)`, `Agent(a, b)`, `Agent(*)`), while its existing `declared`/`granted` output is unchanged and all existing scope/scoring tests still pass; `extractBody(snapshot)` returns the content after the frontmatter block (empty string when frontmatter-only or snapshot is null/malformed) and never throws; `parseDefinition(snapshot)` aggregates `name`/`description`/`model` (via `parseFrontmatter`), the tool scope, and the body into a `ParsedDefinition`. Tests cover each `Agent(...)` form, granted/declared non-regression, body extraction (no-frontmatter, frontmatter-only, normal), and aggregation.
**Depends on:** none
**Estimate:** 3
**Notes:** Satisfies FR-7, FR-8. `spawnTargets` is independently useful. Keep `Agent(*)` distinguishable so `tools/over-broad`/`redundant-wildcard` can reason about it.
**Done:** [x]

### Task 2: Static-check registry — Finding model, descriptors, runner (core)

**What:** Define the check-descriptor and finding types and a pure runner that applies resolved policy to a list of checks.
**Files:** `src/core/assess/check.ts` (`Severity`, `Category`, `StaticCheck`, `Finding`, `EffectivePolicy` type), `src/core/assess/run-checks.ts` (runner), tests; export from `src/core/index.ts`.
**Done when:** `StaticCheck { id; category: 'tools'|'prompt'|'fleet'; severity: Severity; run(agent, fleet): Finding[] }` and `Finding { check; severity; message; suggestion? }` exist; the runner takes parsed definitions + a check list + an `EffectivePolicy` map (id → `{ enabled; severity; options }`) and returns findings stamped with the _effective_ severity, skipping disabled checks; `suggestion` is advisory-only at the type level (no apply path). Tests cover a stub check emitting a finding, a disabled check skipped, and a severity override applied.
**Depends on:** 1
**Estimate:** 2
**Notes:** Satisfies FR-2, FR-3. Single-agent checks ignore the `fleet` arg; fleet checks use it. `EffectivePolicy` is the seam between the config store (Task 3) and the runner.
**Done:** [x]

### Task 3: Suppression config store + precedence resolution (core)

**What:** Load user + repo config files and resolve them, with built-in defaults, into an `EffectivePolicy` keyed by check id.
**Files:** `src/core/assess/config-store.ts` (load, validate, merge; default-path helper), test; export from `src/core/index.ts`.
**Done when:** the store loads `~/.handler/config.json` (user) and `<repo>/.handler/config.json` (repo), each carrying a schema `version` and degrading to defaults (as if absent) on corrupt/wrong-version input; per-check values accept the shorthand string (`"off"|"error"|"warn"|"info"`, where `"off"` ⇒ `{ enabled:false }`) or the object `{ enabled?, severity?, options? }`; resolution merges by precedence defaults → user → repo (repo wins) into `{ enabled, severity, options }` per id; the engine is keyed by check id independent of category (a `conventions` id would resolve too) and tolerates unknown ids. Tests cover both value forms, precedence, corrupt/version degradation, `options` pass-through, and the built-in defaults (including `prompt/no-examples` defaulting to disabled).
**Depends on:** 2
**Estimate:** 3
**Notes:** Satisfies FR-16–20. External config only — no reading of any in-definition directive (FR-16). Mirror the corrupt/version degradation of the other stores. Built-in per-check defaults live here as the base layer.
**Done:** [x]

### Task 4: Tools checks — spawn-loop, redundant-wildcard, over-broad (core)

**What:** The `tools` category checks over parsed definitions and the spawn graph.
**Files:** `src/core/assess/checks/tools.ts`, test; register in the check list; export.
**Done when:** `tools/spawn-loop` (error) fires on a cycle in the fleet's `Agent(...)` spawn graph or a self-spawn, naming the cycle path; `tools/redundant-wildcard` (warn) fires when a wildcard (`*` / `Agent(*)`) is granted alongside explicitly named tools of the same family; `tools/over-broad` (info) fires on a wildcard scope or a granted-tool count over a configurable `maxTools` (from policy `options`). Tests cover a two-node cycle, a self-spawn, a no-cycle fleet, the wildcard-plus-named case, and the `maxTools` boundary.
**Depends on:** 1, 2
**Estimate:** 3
**Notes:** Satisfies FR-9, FR-10, FR-11. Spawn-loop needs the whole fleet (uses the `fleet` arg); build the directed graph from each definition's `spawnTargets` and detect cycles deterministically.
**Done:** [x]

### Task 5: Prompt checks — empty-body, no-examples, size (core)

**What:** The `prompt` category checks over the definition body.
**Files:** `src/core/assess/checks/prompt.ts`, test; register in the check list; export.
**Done when:** `prompt/empty-body` (error) fires when frontmatter is present but the body is non-whitespace-empty; `prompt/no-examples` (info, **default policy off**) fires when the body contains no example block (e.g. no `<example>` marker); `prompt/size` (info) fires when a deterministic token estimate of frontmatter + body exceeds a configurable `maxTokens` (from policy `options`), reported as a per-run cost proxy. Tests cover empty vs present body, presence/absence of an example marker, and the `maxTokens` boundary; a test asserts `no-examples` is suppressed under default policy and surfaces only when enabled.
**Depends on:** 1, 2
**Estimate:** 2
**Notes:** Satisfies FR-12, FR-13, FR-14. Keep the token estimate deterministic (a fixed chars-per-token heuristic is fine; no tokenizer dependency).
**Done:** [x]

### Task 6: Fleet checks + Jaccard similarity (core)

**What:** The `fleet` category cross-agent checks plus the shared similarity helper.
**Files:** `src/core/assess/similarity.ts` (token-set Jaccard + normalization), `src/core/assess/checks/fleet.ts`, tests; register in the check list; export.
**Done when:** `similarity(a, b)` computes token-set Jaccard after normalization (lowercase, split on non-alphanumerics, drop a small stopword set) and is deterministic; `fleet/duplicate-trigger` (warn) fires when two definitions' `description` similarity ≥ a configurable threshold (default 0.8); `fleet/duplicate-definition` (info) fires when two definitions share a `name` across different sources, or their bodies exceed the same threshold. Tests cover identical/disjoint/partial-overlap similarity, the description-duplicate threshold boundary, and the cross-source same-name case.
**Depends on:** 1, 2
**Estimate:** 3
**Notes:** Satisfies FR-15. One similarity implementation serves both checks; body n-gram shingling is a deferred refinement. Fleet checks use the `fleet` arg and must emit each pair once (stable ordering).
**Done:** [x]

### Task 7: `assess` orchestrator (core)

**What:** Compose enumeration, parsing, policy resolution, the registry, and suppression accounting into an `AssessReport`.
**Files:** `src/core/assess/assess.ts` (`assess(options)`, `AssessReport`, `AgentAssessment`), test; export from `src/core/index.ts`.
**Done when:** `assess({ sources, userConfigPath?, repoConfigPath? })` enumerates definitions across sources, excludes builtins, loads snapshots (orphan → reported, never crashes), parses each via `parseDefinition`, resolves policy (Task 3), runs the registry (Task 2 runner + Tasks 4–6 checks) over the fleet, and returns per-agent surfaced findings plus a suppressed-findings summary (counts + the check ids that were silenced); it makes no network/LLM call, reads no conventions artifact, and mutates nothing. Tests cover a multi-agent fleet producing findings across all three categories, an orphan agent, a suppressed check appearing in the summary but not the surfaced findings, and non-mutation.
**Depends on:** 2, 3, 4, 5, 6
**Estimate:** 3
**Notes:** Satisfies FR-1 (enumeration), FR-4, FR-5, FR-6, FR-21 (accounting). Mirror `assessConventions`'s options/orchestration shape.
**Done:** [x]

### Task 8: `assess` CLI subcommand group + render + exit status (CLI)

**What:** Wire the command family, render findings, and set the CI exit code.
**Files:** `src/cli/commands/assess.ts` (subcommand group), `src/cli/format.ts` (finding formatting), register in the CLI program, test.
**Done when:** `assess` runs all categories and `assess tools|prompt|fleet` run one, matching the `source`/`note` subcommand-group style; output is grouped per agent and ordered by severity (errors first), with a clear "no findings" line for clean agents; a dim `suppressed: N (<ids>)` footer prints and `--all` includes suppressed findings (visually marked); `--fail-on <severity>` (default `error`) drives a non-zero exit when any unsuppressed finding meets/exceeds it, else exit zero; the command holds no check logic (calls `assess` and formats only). Tests drive the all-categories and single-category paths, the suppressed footer + `--all`, and exit codes at/under the `--fail-on` threshold.
**Depends on:** 7
**Estimate:** 3
**Notes:** Satisfies FR-1 (group), FR-21, FR-22, FR-23. Wire config paths from `CliContext` mirroring how `conventions` wires `conventionsPath`.
**Done:** [x]

### Task 9: End-to-end integration test

**What:** A test exercising the full pipeline from on-disk definitions + config through rendered output and exit code.
**Files:** `src/cli/commands/assess.integration.test.ts`, using a `mkdtempSync` temp repo (mirroring `conventions.test.ts`).
**Done when:** a temp source with agents that each trip a distinct check (a two-agent spawn cycle, a frontmatter-only empty body, a wildcard grant, two near-duplicate descriptions) produces the expected findings; a repo `config.json` that turns one check `off` and enables `prompt/no-examples` is honored, with the suppressed footer reflecting it; `--fail-on error` exits non-zero on the spawn-loop/empty-body errors while `--fail-on` above them exits zero; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 8
**Estimate:** 2
**Notes:** Reuse the `conventions.test.ts` temp-dir + inline-definition fixture pattern; no shared fixture files.
**Done:** [x]

---

## Summary

- **Total tasks:** 9
- **Total estimated effort:** 24 points
- **Critical path:** Tasks 1 → 2 → 3 → 7 → 8 → 9, with the check tasks (4, 5, 6) branching off Tasks 1–2 and rejoining at the orchestrator (Task 7). A walking skeleton is reachable early via 1 → 2 → 3 → one check → 7 → 8.
- **Risks:** Task 4 (`tools/spawn-loop` graph-cycle detection across the fleet) and Task 3 (config precedence + degradation correctness) are the main unknowns — pin both with explicit tests. Guard the invariants throughout: no network/LLM, no conventions-artifact dependency, observe-only (nothing mutated), and suppression must stay _visible_ (Task 7 accounting + Task 8 footer/`--all`), never silent.
