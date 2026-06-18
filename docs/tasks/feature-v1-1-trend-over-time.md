# Task List: V1 Feature 1 — Queryable history & per-agent trend

**Feature source:** `docs/specs/v1/feature-1-trend.md` · `docs/specs/v1/features-v1.md` (Feature 1)
**Requirements covered:** spec Reqs 31–32 (`docs/spec-v1.md`), US-12
**Branch:** `feature/trend-over-time`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. Core logic in `src/core`, read-only through the existing store boundary; CLI stays a thin formatter.

The persistence already exists: `RunStore` (keyed by `(identityKey, runId)`) and `ScoreStore` (versioned annotations). This feature adds chronological query/trend logic over them plus the `trend` command — no new persisted data.

---

### Task 1: Per-run trend series builder (core)

**What:** A core function that folds an agent's runs + scores into a chronological per-run trend series: timestamp, composite score, band, duration, tokens, tool-use count.
**Files:** `src/core/trend/series.ts`, test; export from `src/core/index.ts`.
**Done when:** Given an agent's runs and a `ScoreStore`, returns rows ordered oldest→newest; incomplete runs appear as dated rows with summary numbers omitted and are counted distinctly (consistent with `aggregateMetrics`); runs missing a timestamp sort last and are labeled, never dropped; scores resolved via `scoreRun`/`ScoreStore` (unscored runs rendered as such); the builder reads only and mutates nothing. Tests cover ordering, missing-timestamp placement, incomplete runs, and unscored runs.
**Depends on:** none
**Estimate:** 3
**Notes:** Reuse the `byTimestamp` sort semantics from `src/cli/commands/show.ts` (lift into core if shared). Satisfies Reqs 2, 3, 6, 7, 9.

### Task 2: Day/week bucketed aggregation (core)

**What:** Aggregate a per-run series into day or week buckets: run count, median composite score, median tokens, median duration.
**Files:** `src/core/trend/bucket.ts` (+ a small median helper, e.g. `src/core/trend/median.ts`), tests; export from `src/core/index.ts`.
**Done when:** `bucket(series, 'day'|'week')` groups runs by calendar day / ISO week and emits one aggregate row per non-empty bucket with count + median composite/tokens/duration; incomplete runs count toward the bucket count but are excluded from the medians; buckets are ordered oldest→newest; median is exact for odd/even counts. Tests cover day and week grouping, even/odd medians, and incomplete-run exclusion.
**Depends on:** 1
**Estimate:** 3
**Notes:** Median (not mean) per the spec — robust and consistent with Tier B's self-relative median direction. Define the week boundary explicitly (ISO week, Monday start) in a test. Satisfies Req 4.

### Task 3: Window filters (core)

**What:** Pure filters that window a series before rendering/bucketing: `--since <ISO date>` and `--last <N>`.
**Files:** `src/core/trend/window.ts`, test; export from `src/core/index.ts`.
**Done when:** `since` drops runs older than the given date (inclusive of the date); `last` keeps the N most-recent runs; the two compose (since applied, then last); invalid/empty inputs are handled deterministically; missing-timestamp runs are excluded by `since` but retained by `last` only if within the most-recent N after ordering. Tests cover each filter, composition, and boundary dates.
**Depends on:** 1
**Estimate:** 1
**Notes:** Keep these pure over the series so both per-run and bucketed paths reuse them. Satisfies Req 5.

### Task 4: `trend` CLI command + formatting + graceful degradation

**What:** Register `handler trend <agent>` with per-run (default) and `--bucket day|week` output, `--since`/`--last` flags, and graceful degradation.
**Files:** `src/cli/commands/trend.ts`, test; register in `src/cli/index.ts`; reuse `src/cli/format.ts`.
**Done when:** `handler trend <agent>` selects the agent via the same `summarizeAgents` selector as `show` (ambiguous name → source disambiguation prompt, identical to `show`); default prints the per-run series, `--bucket week|day` prints aggregates, `--since`/`--last` window the output; an agent with no runs prints "no runs", a single-run agent renders its one row without implying a trend, an unknown agent errors consistently with `show`. Command holds no aggregation logic — it only calls Task 1–3 core functions and formats. Tests drive each path through the CLI action.
**Depends on:** 1, 2, 3
**Estimate:** 3
**Notes:** Mirror `registerShowCommand` wiring (`SourceRegistry` + `ingest` + `ScoreStore` from `CliContext`). Satisfies Reqs 1, 8.

### Task 5: End-to-end integration test

**What:** A test exercising the full pipeline from fixture transcripts through `trend` output for per-run, bucketed, and windowed modes.
**Files:** `src/cli/commands/trend.test.ts` (or a dedicated integration test), reusing existing transcript fixtures.
**Done when:** Seeding a fixture project with multiple dated runs for one agent and invoking the command produces correct per-run rows, a correct `--bucket week` aggregate, and a correct `--since`/`--last` window; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 4
**Estimate:** 2
**Notes:** Reuse the transcript fixtures from the Feature 2 ingestion tests so the run timestamps are realistic.

---

## Summary

- **Total tasks:** 5
- **Total estimated effort:** 12 points
- **Critical path:** Tasks 1 → 2 → 4 → 5 (Task 3 branches off Task 1 in parallel with Task 2).
- **Risks:** Task 2 — week-boundary definition and median tie-breaking are the easy-to-get-subtly-wrong parts (pin them with explicit tests). Task 4 — keeping the command a pure formatter (no logic leaking out of core) per the architecture invariant.
