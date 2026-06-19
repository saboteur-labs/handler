# Task List: V1 Feature 4 — Roster-level insights

**Feature source:** `docs/specs/v1/feature-4-roster-insights.md` · `docs/specs/v1/features-v1.md` (Feature 4)
**Requirements covered:** spec Reqs 33–34 (`docs/spec-v1.md`), US-13
**Branch:** `feature/roster-insights`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. All classification logic in `src/core/insights`, read-only through the existing store boundary; the CLI stays a thin formatter. No new persisted data and no store schema change — `insights` derives everything from the existing `RunStore`, `ScoreStore`, and Tier B store.

The enabling query layer (Feature 1) and Tier B cost outliers (Feature 2) already exist: `src/core/trend/*` for chronological access, `aggregateMetrics` (`src/core/metrics.ts`), `summarizeAgents` (`src/core/agents.ts`), the Tier A `scoreRun` path (`src/core/scoring/score.ts`), and Tier B reference scoring + min-runs config (`src/core/scoring/tier-b.ts`, `tier-b-reference.ts`, `tier-b-outliers.ts`). This feature adds roster-wide classification over them plus the `insights` command.

---

### Task 1: Insights thresholds & config (core) ✓ COMPLETE

**What:** A config module exposing the four tunable thresholds — recency window (default 30 days), failing-score threshold (default 50), Tier B outlier factor, and minimum-run count — each with a documented default and an env-var override, mirroring the Tier B `DEFAULT_MIN_RUNS`/`getMinRuns()` pattern.
**Files:** `src/core/insights/config.ts`, test; export from `src/core/index.ts`.
**Done when:** Each threshold has an exported `DEFAULT_*` constant and a getter that reads its env var (e.g. `HANDLER_INSIGHTS_RECENCY_DAYS`, `HANDLER_INSIGHTS_FAIL_SCORE`) and falls back to the default on absent/non-numeric/out-of-range input; the min-run count and outlier factor reuse the existing Tier B getters rather than redefining them (single source of truth). Tests cover default, valid override, and each malformed-input fallback. Satisfies Req 8.
**Depends on:** none
**Estimate:** 2
**Notes:** No hard-coded judgments may live in the classifier (Req 8) — all magic numbers resolve through this module. Reuse `getMinRuns()` and the Tier B outlier-factor getter from `src/core/scoring/tier-b.ts`.

### Task 2: Roster classifier — unused, failing, no-history (core) ✓ COMPLETE

**What:** A pure core function that, given the set of known agents with their runs and scores, classifies each agent as **unused** and/or **failing**, buckets zero-run agents as **no history**, and allows multi-category membership.
**Files:** `src/core/insights/classify.ts` (types + classifier), test; export from `src/core/index.ts`.
**Done when:** Given an agent's runs + resolved Tier A scores, the classifier marks **unused** when there are no runs inside the recency window OR the Tier A tool-utilization check shows granted-but-unused tools across all stored runs (Req 2); marks **failing** when any run has a Tier A failure or the most-recent composite is below the fail threshold (Req 3); an agent may carry both labels at once (Req 5); an agent with zero stored runs is returned in a distinct **no history** bucket and is never labeled unused/failing/expensive (Req 7); the function reads only and mutates nothing (Req 10). Tests cover each rule, the multi-category case, and the zero-run bucket.
**Depends on:** 1
**Estimate:** 3
**Notes:** Resolve Tier A scores/utilization via the existing `scoreRun`/`ScoreStore` path — do not recompute from transcripts (Req 9). Reuse the granted-but-unused signal already produced by Tier A tool-utilization rather than re-deriving it. "Most-recent" uses the same `byTimestamp` ordering as `show`/`trend`.

### Task 3: Expensive classification + low-confidence degradation (core) ✓ COMPLETE

**What:** Extend the classifier with the **expensive** category (driven by Tier B cost-outlier flags) and the thin-history low-confidence degradation.
**Files:** `src/core/insights/classify.ts` (+ test additions); Tier B store read via `src/core/store/tier-b-store.ts`.
**Done when:** An agent is **expensive** when Tier B outlier flags are present and exceed the outlier factor for tokens, duration, or turn count (Req 4); when an agent has no Tier B data the expensive category is omitted for that agent and is never reported as not-expensive (Req 4); an agent with fewer runs than the configured minimum has its **unused** and **expensive** assessments labeled low-confidence rather than emitted as definitive (Req 6). Tests cover expensive-present, Tier-B-absent omission, the outlier-factor boundary, and the low-confidence labeling at the min-run boundary.
**Depends on:** 2
**Estimate:** 3
**Notes:** Read Tier B annotations through `tier-b-store.ts` — never recompute. Low-confidence is a label on the result row, not exclusion (Req 6 vs Req 7 are distinct: thin history → labeled; zero runs → no-history bucket). Failing is not degraded to low-confidence — a Tier A failure is definitive regardless of run count.

### Task 4: `insights` CLI command + formatting (CLI) ✓ COMPLETE

**What:** Register `handler insights`, wire it to the classifier, and format the categorized roster (unused / failing / expensive / no-history) with low-confidence markers.
**Files:** `src/cli/commands/insights.ts`, test; register in `src/cli/index.ts`; reuse `src/cli/format.ts`.
**Done when:** `handler insights` enumerates every agent known to the run store and prints a categorized summary with agents grouped by category, multi-category agents shown under each they belong to, low-confidence assessments visibly marked, and a distinct no-history section (Reqs 1, 5, 6, 7); the command holds no classification logic — it only calls Task 1–3 core functions and formats; it reads through the store boundary and alters nothing (Reqs 9, 10). Tests drive each output section through the CLI action.
**Depends on:** 3
**Estimate:** 3
**Notes:** Mirror `registerTrendCommand`/`registerShowCommand` wiring (`SourceRegistry` + `ingest` + `ScoreStore`/Tier B store from `CliContext`). An empty roster prints a clear "no agents" message, not an error.

### Task 5: End-to-end integration test ✓ COMPLETE

**What:** A test exercising the full pipeline from fixture transcripts through `insights` output, covering each category plus thin-history and Tier-B-absent paths.
**Files:** `src/cli/commands/insights.integration.test.ts`
**Done when:** Seeding a fixture project with agents that are unused, failing, expensive (with Tier B data), thin-history (low-confidence), and zero-run (no history) produces the correct categorized output including low-confidence markers and the silent expensive-omission for a Tier-B-absent agent; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 4
**Estimate:** 2
**Notes:** Reuse transcript + Tier B fixtures from the Feature 2 ingestion and `show.tier-b.integration.test.ts` so run timestamps, scores, and outlier flags are realistic.

### Task 6: Surface zero-run agents in the CLI no-history bucket (follow-up)

**What:** Feed the classifier the full set of known agents (including definition-only agents with no stored runs) so the **no history** bucket (Req 7) is reachable from `handler insights`, not just from the classifier core.
**Files:** `src/cli/commands/insights.ts`; a definition-enumeration helper in `src/core` (e.g. reuse/extend the `conventions` command's `.claude/agents` discovery); test additions in `src/cli/commands/insights.test.ts` / `insights.integration.test.ts`.
**Done when:** A registered agent with a definition but zero stored runs appears in the **No History** section of `handler insights` output; agents with runs are unaffected; reads stay within the store/source boundary (Reqs 9, 10); `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 4
**Estimate:** 3
**Notes:** Known gap from the initial implementation: the CLI drives `classifyRoster` via `summarizeAgents(runs)`, which only yields agents with ≥1 run, so the `noHistory` bucket (handled and tested in the classifier core) is currently unreachable from the CLI. Resolving it needs a transcript-independent source of agent descriptors — enumerate user-level + per-repo `.claude/agents` definitions (the `conventions` command already discovers these) and merge them with the run-derived roster, deduping on agent identity. Honors the "user-created agents only" invariant via the existing builtin denylist.

---

## Summary

- **Total tasks:** 6 (5 complete; Task 6 is a follow-up)
- **Total estimated effort:** 16 points (13 implemented + 3 follow-up)
- **Critical path:** Tasks 1 → 2 → 3 → 4 → 5 (fully sequential — the classifier is built up across 2→3, then consumed by the command). Task 6 branches off Task 4.
- **Risks:** Task 3 — the Tier-B-absent "omit, don't report not-expensive" rule (Req 4) and the low-confidence-vs-no-history distinction (Reqs 6/7) are the easy-to-get-subtly-wrong parts; pin them with explicit boundary tests. Task 4 — keeping the command a pure formatter (no classification logic leaking out of core) per the architecture invariant. Task 6 — merging definition-derived and run-derived rosters without double-listing agents (dedupe on the identity tuple).
