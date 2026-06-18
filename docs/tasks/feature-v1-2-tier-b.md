# Task List: V1 Feature 2 — Tier B reference-relative scoring

**Feature source:** `docs/specs/v1/feature-2-tier-b.md` · `docs/specs/v1/features-v1.md` (Feature 2)
**Requirements covered:** spec Reqs 22–25 (`docs/spec-v1.md`), US-10 (annotation/store reuse touches Reqs 29, 31)
**Branch:** `feature/tier-b-reference-scoring`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. Core logic in `src/core/scoring`, deterministic and local-only; the CLI stays a thin formatter. Tier B is a **separate, non-blended** layer: it must never alter the MVP Tier A `Score` (composite/band) — it is computed and stored as its own annotation and rendered as its own section.

Key architectural fact: Tier B is self-relative, so unlike `scoreRun(run, store)` it needs the agent's **other runs**. The orchestrator takes the agent's run history (the runs already grouped by `identityKey`, as `show`/`trend` do) plus the run being scored. The reference is the median over runs **strictly prior** to that run; reuse the existing `median` helper from `src/core/trend/median.ts`. Run metrics come from `Run.totalTokens`, `Run.totalDurationMs`, and the turn count from `Run.telemetry.turns.length`.

---

### Task 1: Tier B types + tunable config defaults (core)

**What:** Define the Tier B result types and the two configurable defaults (outlier factor 2×, min-runs 5).
**Files:** `src/core/scoring/tier-b.ts` (types + `TIER_B_VERSION` + config constants), test; export from `src/core/index.ts`.
**Done when:** `TierBResult` (status `applicable | 'insufficient-history'`, the resource flags, the contract result) and `TierBFlag` types exist; `DEFAULT_OUTLIER_FACTOR = 2` and `DEFAULT_MIN_RUNS = 5` are defined and overridable via env vars consistent with the existing config pattern (e.g. `HANDLER_TIERB_FACTOR`, `HANDLER_TIERB_MIN_RUNS`); invalid/absent env values fall back to defaults deterministically. Tests cover default resolution and env override/fallback.
**Depends on:** none
**Estimate:** 2
**Notes:** No invented thresholds — factor/min-runs are tunable defaults, not hard-coded judgments (spec constraint). Bump a dedicated `TIER_B_VERSION` independent of `RUBRIC_VERSION`.
**Done:** [x]

### Task 2: Tier B versioned annotation store (core)

**What:** A store for Tier B annotations keyed by agent identity + run id + `TIER_B_VERSION`, behind the existing `json-store` boundary, alongside `ScoreStore`.
**Files:** `src/core/store/tier-b-store.ts`, test; export from `src/core/index.ts`; default path env var (e.g. `HANDLER_TIERB`).
**Done when:** `TierBStore` round-trips a `TierBResult` keyed by `(runId, tierBVersion)`; a version change adds a row rather than rewriting an existing one; a wrong-version/corrupt file degrades to empty (consistent with the other stores); never mutates Tier A score annotations. Tests cover add/get, version isolation, and corrupt-file degradation.
**Depends on:** 1
**Estimate:** 2
**Notes:** Mirror `src/core/store/score-store.ts` exactly. Satisfies Reqs 29/31-style versioned-annotation invariant for Tier B.
**Done:** [x]

### Task 3: Per-agent rolling-median reference (core)

**What:** Compute the self-relative reference (median tokens, duration, turn count) over an agent's runs strictly prior to a given run.
**Files:** `src/core/scoring/tier-b-reference.ts`, test; export from `src/core/index.ts`.
**Done when:** Given an agent's runs and the target run, the function selects runs strictly prior by timestamp (excluding the target and excluding incomplete runs that lack the metric), and returns the median of tokens, duration, and turn count via `src/core/trend/median.ts`; when fewer than min-runs prior runs exist it returns an `insufficient-history` marker rather than a reference. Tests cover the strictly-prior selection, exclusion of the target run, median correctness (odd/even), and the min-runs boundary.
**Depends on:** 1
**Estimate:** 2
**Notes:** Reuse `median` from Feature 1; do not reimplement. Turn count = `run.telemetry?.turns.length`. Satisfies Reqs 22, 25 (history gate).
**Done:** [x]

### Task 4: Resource-cost outlier flags (core)

**What:** Flag a run's tokens, wall-clock duration, and turn count as outliers when they exceed the reference median by the configured factor.
**Files:** `src/core/scoring/tier-b-outliers.ts`, test; export from `src/core/index.ts`.
**Done when:** Given a run's metrics, a reference, and the factor, the function emits a flag per dimension (tokens/duration/turns) marking `outlier` when `value > median * factor`, else `within`; "cost" is tokens only — no dollar value is derived; a missing metric on an incomplete run is reported as not-measurable, never as an outlier. Tests cover each dimension at/over/under the boundary and the tokens-only rule.
**Depends on:** 1, 3
**Estimate:** 2
**Notes:** Satisfies Req 23 and the tokens-only constraint (Req 23 / spec non-goal).
**Done:** [x]

### Task 5: Output-contract detection + adherence check (core)

**What:** Detect whether the definition snapshot declares an explicit output contract and, if so, verify the run output against it deterministically.
**Files:** `src/core/scoring/tier-b-contract.ts`, test; export from `src/core/index.ts`.
**Done when:** A detector scans the `definitionSnapshot` for explicit markers (e.g. "return JSON" / JSON cue, a fenced code-block language, named `## section` headers) and returns the declared contract or none; when a contract is declared, the run's output is checked for parseability/literal markers and reported `pass`/`fail`; when none is declared, the result is `not-applicable` (never a failure). Tests cover JSON-cue detection + parse pass/fail, named-section detection + presence pass/fail, and the no-contract → not-applicable path.
**Depends on:** 1
**Estimate:** 5
**Notes:** Highest-uncertainty task. Two sub-problems: (a) marker detection in the definition, (b) locating the run's output deterministically from the sub-transcript (the final assistant turn / `Run.telemetry`). Pin the marker set with explicit tests; keep detection conservative (false-negative over false-positive). Satisfies Reqs 24 + the not-applicable rule.
**Done:** [x]

### Task 6: Tier B orchestrator (core)

**What:** Compose reference + outliers + contract into a cached `TierBResult` for a run, deterministic and separate from the Tier A `Score`.
**Files:** `src/core/scoring/tier-b.ts` (extend Task 1's module), test; export from `src/core/index.ts`.
**Done when:** `tierBForRun(run, agentRuns, store)` returns the cached annotation when present for `TIER_B_VERSION`; otherwise computes the reference (Task 3), and on sufficient history runs outliers (Task 4) + contract (Task 5), persists via `TierBStore` (Task 2), and returns the result; on insufficient history returns the `insufficient-history` result without flags; it never reads or writes the Tier A `Score`. Tests cover the cache path, the insufficient-history degradation, a full applicable result, and non-interference with Tier A.
**Depends on:** 2, 3, 4, 5
**Estimate:** 3
**Notes:** Mirror `scoreRun`'s lazy-cache shape. Satisfies Reqs 25 (deterministic, alongside, degrade) and the separation constraint (Req 6 of the feature spec).
**Done:** [x]

### Task 7: Tier B section in score output (CLI)

**What:** Render a distinct, labeled Tier B section alongside the existing Tier A score line in `show`.
**Files:** `src/cli/commands/show.ts`, `src/cli/format.ts`, test.
**Done when:** `handler show <agent>` prints, beneath each run's Tier A score, a labeled "Tier B" section listing the resource flags and the contract result, or "insufficient history" when degraded; the Tier A line is unchanged; the command holds no Tier B logic (calls `tierBForRun` and formats only). Tests drive the applicable, insufficient-history, and not-applicable-contract render paths through the CLI.
**Depends on:** 6
**Estimate:** 2
**Notes:** Wire `TierBStore` + agent run grouping from `CliContext`, mirroring how `show` already wires `ScoreStore`. Satisfies the "distinct, alongside, never merged" display requirement (Req 25 / feature Req 6).
**Done:** [x]

### Task 8: End-to-end integration test

**What:** A test exercising the full pipeline from fixture transcripts through Tier B output.
**Files:** `src/cli/commands/show.tier-b.integration.test.ts` (or extend the show integration test), reusing existing transcript fixtures.
**Done when:** Seeding an agent with ≥ min-runs dated runs (one a clear token/duration outlier) and a run with a declared contract produces correct outlier flags, a correct contract pass/fail, and a not-applicable result for a contract-free agent; a thin-history agent shows "insufficient history"; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 7
**Estimate:** 2
**Notes:** Reuse the Feature 2 (ingestion) transcript fixtures so run timestamps and metrics are realistic; add a fixture agent whose definition declares an explicit contract.
**Done:** [x]

---

## Summary

- **Total tasks:** 8
- **Total estimated effort:** 20 points
- **Critical path:** Tasks 1 → 3 → 4 → 6 → 7 → 8 (Task 2 storage and Task 5 contract branch off and rejoin at the orchestrator).
- **Risks:** Task 5 (contract detection + locating run output deterministically) is the dominant unknown — pin the marker set and the output-extraction seam with explicit tests, and bias detection toward false-negatives. Task 6/7 — guard the hard invariant that Tier B never blends into the Tier A composite/band (separate annotation, separate display section).
