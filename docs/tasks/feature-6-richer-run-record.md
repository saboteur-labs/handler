# Task List: Feature 6 — Richer run record & definition-change correlation

**Feature source:** `docs/specs/feature-6-richer-run-record.md`
**Requirements covered:** feature spec Reqs 1–7 (net-new v1; extends `docs/spec.md`)
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor.

Builds on Feature 2 (run store, `RawRun`/`Run`, transcript parsing, definition snapshots) and Feature 3 (cached `Score` composite + per-check breakdown). The sidechain shape is already exercised by `src/core/scoring/activity.ts`: assistant entries carry `message.content` `tool_use` blocks (`name`, `input`) plus `message.usage`, `message.model`, `message.stop_reason`, and an entry `timestamp`; user entries carry `tool_result` blocks (`is_error`, `content`). Two work streams are largely independent: **telemetry** (Tasks 1→4, 9) and **correlation** (Tasks 5→6→7/8).

---

### Task 1: Per-turn telemetry parser — tokens, timestamps, model, stop reason

**What:** A new sidechain parser producing an ordered per-turn record of token usage (input/output/cache-read/cache-creation), entry timestamp, model, and terminal stop reason.
**Files:** `src/core/transcripts/telemetry.ts` (+ test).
**Done when:** given fixture sidechain entries, returns per-turn `{ usage, timestamp, model }[]` plus a run-level `stopReason` (`end_turn` / `max_tokens` / `interrupted`); a missing/malformed file or absent `usage` yields an empty/partial record without throwing.
**Depends on:** none
**Estimate:** 3
**Notes:** Reuse `readJsonl`. Token fields live on `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`); `model` and `stop_reason` on `message`. Pin against a real-shaped fixture. Keep separate from `readActivity` for now; a later refactor may unify the single sidechain walk (note in code). Req 1, Req 3.
**Done:** [x] — `src/core/transcripts/telemetry.ts` + 7 tests. `readTelemetry` returns `{ turns: { usage, timestamp, model }[], stopReason }`; usage fields default to 0, stop reason normalizes `end_turn`/`max_tokens` and detects `interrupted` via the Claude Code interruption marker (string-matched, mirroring the denial-string approach — flagged for fixture confirmation). Defensive on missing/malformed input.

### Task 2: Tool-I/O & behavioral telemetry — exit codes, files edited, planning, retry loops

**What:** Extend the per-turn parse to capture tool inputs/outputs including `Bash` exit codes and error payloads, files edited (`Edit`/`Write`/`MultiEdit` `file_path`), `TodoWrite` planning activity, and error→retry loops (repeated identical `(tool, normalized-args)` where a prior call errored).
**Files:** `src/core/transcripts/telemetry.ts`, `src/core/scoring/checks-activity.ts` (reuse arg-normalization) (+ tests).
**Done when:** the telemetry record reports, per fixture, edited file paths, `Bash` exit codes + error text, a `TodoWrite` flag/count, and a count of error→retry loops; defensive on missing fields.
**Depends on:** 1
**Estimate:** 5
**Notes:** Highest empirical risk is the `Bash` exit-code location — confirm against a real `tool_result` (may be embedded in `content` text rather than a structured field; pin a fixture, degrade if absent). Reuse the canonical `(tool, normalized-args)` keying from Feature 3's thrash detection so "retry" matches the existing definition. Req 1, Req 3.
**Done:** [x] — extended `readTelemetry` with `filesEdited`, `todoWrites`, `toolErrors` (`{exitCode,message}`), and `retryLoops`; +6 tests. **Empirically confirmed against real `~/.claude` data:** Bash failures carry NO structured exit-code field — they surface as `is_error` results whose content text begins `Exit code N` (parsed via regex, `undefined` when absent); `toolUseResult.stderr` is empty. Extracted the `(tool, normalized-args)` keying into shared `src/core/scoring/signature.ts` (`toolSignature`) and refactored `checks-activity.ts` onto it so retry-loops and thrash group identically. Smoke-tested over 40 real sidechains: 1102 turns, 52 files edited, 16 tool errors (4 with exit codes), 2 retry loops, no crashes.

### Task 3: Per-run latency distribution (p50/p95)

**What:** Derive a latency distribution (at minimum p50 and p95 turn latency) from Task 1's per-turn timestamps.
**Files:** `src/core/transcripts/telemetry.ts` or `src/core/metrics.ts` (+ test).
**Done when:** given ordered per-turn timestamps, returns p50 and p95 inter-turn latency; fewer than 2 turns yields `undefined` rather than a bogus value.
**Depends on:** 1
**Estimate:** 2
**Notes:** Pure function over timestamps. Document the percentile method (e.g. nearest-rank) so it's reproducible. Req 2.
**Done:** [x] — `latencyDistribution(turns)` in `telemetry.ts` returns `{ p50Ms, p95Ms }` via nearest-rank (`rank = ceil(p/100 * n)`) over inter-turn intervals, derived from timestamped turns (skips turns without a timestamp), `undefined` below two timestamped turns. 4 tests.

### Task 4: Persist richer fields — schema bump + re-ingest backfill

**What:** Add the telemetry fields (Tasks 1–3) to the stored `Run`, bump the run-store schema, and populate them at ingest so re-ingest backfills already-ingested runs from on-disk transcripts.
**Files:** `src/core/run.ts`, `src/core/store/run-store.ts`, `src/core/ingest.ts` (+ tests).
**Done when:** a stored `Run` carries the per-turn telemetry, latency distribution, and stop reason; `RUN_STORE_VERSION` is bumped (2→3) so a v2 file is discarded and rebuilt; re-running ingest repopulates the new fields for runs whose sidechain still exists, and runs whose transcript is gone persist with the fields absent.
**Depends on:** 1, 2, 3
**Estimate:** 3
**Notes:** The store is a regenerable cache that degrades wrong-version to empty (existing behavior), so the version bump _is_ the backfill trigger — next ingest rebuilds from transcripts. Keep new fields optional to honor degrade-not-migrate. Req 7, Req 3.
**Done:** [x] — `Run` gained an optional `telemetry: RunTelemetrySummary` (parsed turns + derived `latency`); `assembleRun` reads it from the sidechain when present, leaves it `undefined` otherwise (thin runs survive — unit-tested). `RUN_STORE_VERSION` 2→3 so a v2 store is discarded and rebuilt. Optional field keeps existing `Run` literals/tests compiling. +2 run tests. **Real-data verified:** re-ingest repopulated all 17 runs (1261 turns, all with latency); telemetry round-trips on store reload (17/17).

### Task 5: Definition-change detection & version segmentation

**What:** Segment an agent identity's runs into ordered definition-snapshot versions by comparing `definitionSnapshot` content, and locate the change points.
**Files:** `src/core/correlation/versions.ts` (+ test).
**Done when:** given an identity's runs ordered by timestamp, returns contiguous version segments (each a snapshot hash + its runs) and the list of change points; `orphan` runs with a `null` snapshot are handled without merging across an unknown boundary.
**Depends on:** none
**Estimate:** 3
**Notes:** Hash the snapshot content for the segment key. Decide and document how a `null` snapshot breaks/holds a segment (recommend: treated as its own "unknown" boundary, not merged). Req 4.

### Task 6: Before/after delta over a definition change

**What:** Compute a per-change-point delta by aggregating runs grouped by definition-snapshot version: the Feature 3 composite/band as headline (same rubric version), its tool-error-count and terminal-status components, and token total, with a low-confidence flag below a documented minimum run count.
**Files:** `src/core/correlation/delta.ts` (+ test).
**Done when:** for a change point with runs on each side, returns before/after aggregates and deltas for composite, tool-error count, terminal-status rate, and token total; the composite delta is computed only from scores under the current `RUBRIC_VERSION` (recomputing older runs via `scoreRun`); a side with fewer than the documented minimum runs is flagged `lowConfidence`.
**Depends on:** 5
**Estimate:** 5
**Notes:** Reads cached `Score` (composite + per-check breakdown supplies tool-error/status components) and `run.totalTokens` — does not need Tasks 1–4. Define the minimum-run constant (e.g. `< 2` per side → low-confidence) and document it. Label components as composite inputs, not independent signals (per spec Req 5). Req 5.
**Done:** [x] — `correlation/delta.ts`: `definitionChangeDeltas(runs, scoreStore)` aggregates runs by definition version and emits a delta per known→known change point. Composite + terminal-status come from `scoreRun` (recomputes under current `RUBRIC_VERSION` → always same-rubric); tool-error count from `run.telemetry.toolErrors` (the same signal feeding the composite's tool-errors check); token total from `run.totalTokens`. `lowConfidence` when either side has < `MIN_RUNS_FOR_CONFIDENCE` (2) scored runs; orphan/unknown boundaries skipped. 5 tests.

### Task 7: `handler show` — definition-changed marker + delta

**What:** Render an inline "definition changed" marker with the before/after delta on the `handler show` run timeline.
**Files:** `src/cli/` (show command), `src/core/metrics.ts` or a `show`-assembly seam (+ tests).
**Done when:** `handler show <agent>` displays a marker at each change point with the composite/component/token deltas and a low-confidence indicator when flagged; agents with no definition change render unchanged.
**Depends on:** 6
**Estimate:** 3
**Notes:** CLI holds no logic — assemble the view data in core, format in `src/cli`. Req 6.
**Done:** [x] — `show` computes `definitionChangeDeltas` and prints a `── definition changed ──` marker (composite/terminal/tool-errors/tokens deltas + `[low confidence]`) before the first run of each new version, with runs ordered chronologically. Correlation API exported from core `index.ts`. +2 show tests (marker present on change; absent when unchanged).

### Task 8: `handler diff <agent>` command

**What:** A dedicated command giving edit-to-edit detail for an agent's definition changes.
**Files:** `src/cli/` (new `diff` command), `src/core/index.ts` (public seam) (+ tests).
**Done when:** `handler diff <agent>` lists each change point with its before/after aggregates and deltas; an agent with a single definition version reports "no changes"; an unknown agent errors cleanly.
**Depends on:** 6
**Estimate:** 3
**Notes:** Reuses Task 6's delta output; this task is presentation + arg parsing only. Req 6.

### Task 9: Surface per-run telemetry in `handler show`

**What:** Display the key per-run telemetry (latency p50/p95, token breakdown, stop reason, error→retry count, files-edited count) in `handler show`.
**Files:** `src/cli/` (show command), `src/core/metrics.ts` (+ tests).
**Done when:** `handler show <agent>` surfaces the new per-run telemetry for runs that have it, and renders runs lacking it (thin/old runs) without error.
**Depends on:** 4
**Estimate:** 2
**Notes:** Turns the extracted data (Req 1) into something the author can see, per the feature's goals. Keep formatting in `src/cli`; assemble in core. Req 1.

## Summary

- **Total tasks:** 9
- **Total estimated effort:** 29 points
- **Critical path:** Tasks 1 → 2 → 4 → 9 (telemetry stream); the correlation stream 5 → 6 → {7, 8} runs in parallel and does not depend on Tasks 1–4.
- **Risks:** Task 2 (highest) — the `Bash` exit-code location in `tool_result` is unconfirmed; pin a real fixture before building and degrade gracefully if absent. Task 4 — verify the version-bump-then-reingest backfill actually repopulates against real `~/.handler` data, and that thin/old runs survive. Task 6 — the same-rubric-version recompute must not conflate a rubric change with the definition change; ensure older runs are re-scored under the current rubric before differencing.
