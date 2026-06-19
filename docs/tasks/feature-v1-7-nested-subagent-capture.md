# Task List: V1 Feature 7 — Nested Subagent Capture

**Feature source:** `docs/specs/v1/feature-7-nested-subagent-capture.md` · `docs/spec-v1.md` Reqs 39–44
**Requirements covered:** spec-v1 Reqs 39–44, US-17
**Branch:** `feature/nested-subagent-capture`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. Tests must map to the requirement(s) they cover. All new logic lives in `src/core/`; `src/cli/` remains a thin formatter only.

The existing pipeline is: `discoverTranscripts` (top-level `.jsonl` only) → `readJsonl` → `extractRuns` (from parent-session Task results) → `assembleRun` (identity resolution + snapshot) → `RunStore.upsert`. This feature extends discovery to also recurse into `<sessionId>/subagents/` directories, adds a new sidechain extraction path, adds `parentAgentId` to `Run`, bumps `RUN_STORE_VERSION`, guards dedup by `agentId`, and surfaces "spawned by" in `show` and `trend`.

---

### Task 1: Extend `discoverTranscripts` to recurse into sidechain directories [COMPLETE]

**What:** Add a second return set (or a new exported function) that discovers sidechain transcript files (`<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl`) at arbitrary depth, alongside the existing parent-transcript discovery.
**Files:** `src/core/transcripts/discover.ts`, `src/core/transcripts/discover.test.ts`
**Done when:**

- A new exported function `discoverSidechains(projectsRoot)` (or an equivalent extension) returns all sidechain `.jsonl` file paths found under any `<projectDir>/<sessionId>/subagents/` directory, sorted deterministically.
- The function recurses as deep as the directory structure goes — depth is not hard-coded (Req 39).
- `discoverTranscripts` behaviour is unchanged (existing tests still pass).
- A missing `subagents/` directory, an empty project directory, or a missing `projectsRoot` all yield `[]` with no throw.
- Tests cover: a project with no subagents directory, a project with one nested sidechain, a project with sidechains at two levels of depth (e.g. sidechain of a sidechain), multiple projects with sidechains, and the missing-root case.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** none
**Estimate:** 3
**Notes:** The sidechain file naming convention is `agent-<agentId>.jsonl` inside `<sessionId>/subagents/`. The `parentAgentId` is encoded in the _containing_ filename: a sidechain spawned by agent `abc` lives at `…/subagents/agent-abc.jsonl` inside its own parent-session directory. Recursive descent can use `readdirSync` with `withFileTypes: true` — the same helper `readDirEntries` used in the existing code — or Node's `readdirSync` recursive option (available in Node ≥ 20). Cover Reqs 39 (discovery + arbitrary depth).

---

### Task 2: Extract `parentAgentId` from a sidechain file path

**What:** Add a pure utility function that parses the `parentAgentId` from a sidechain file path (`agent-<parentAgentId>.jsonl`) so the ingestion layer can persist lineage without touching the JSON content.
**Files:** `src/core/transcripts/discover.ts` (or a new `src/core/transcripts/sidechain.ts`), with a corresponding test file.
**Done when:**

- `parseSidechainParentAgentId(filePath: string): string | undefined` is exported and returns the `<parentAgentId>` string extracted from the last filename segment matching `agent-<id>.jsonl`.
- Returns `undefined` for paths whose filename does not match the pattern.
- Tests cover: a valid path with a typical UUID-style id, a path whose filename matches exactly, a path with a non-matching filename, and an empty string.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** none (parallelisable with Task 1)
**Estimate:** 1
**Notes:** This is a pure string function — no filesystem calls. The pattern is `agent-<id>.jsonl` where `<id>` is one or more non-empty characters. Covers Req 41 (extracting `parentAgentId` from the filename). Keep the function co-located with discover or in a dedicated `sidechain.ts`; either is fine as long as it is exported from `src/core/transcripts/`.

---

### Task 3: Add `parentAgentId` to `Run` and bump `RUN_STORE_VERSION`

**What:** Add an optional `parentAgentId` field to the `Run` interface and bump `RUN_STORE_VERSION` to 6, so the store discards stale records and rebuilds with the new field on next ingest.
**Files:** `src/core/run.ts`, `src/core/store/run-store.ts`, `src/core/store/run-store.test.ts`
**Done when:**

- `Run` interface gains `readonly parentAgentId?: string`.
- Top-level runs (those coming from parent-session transcripts) have `parentAgentId: undefined` (the field is simply absent or not set).
- `RUN_STORE_VERSION` is bumped to `6` with a comment explaining the bump.
- `extractRuns` in `run-store.ts` continues to treat a file with a different version as empty (discard and rebuild — no migration).
- Existing records loaded without `parentAgentId` pass the `isRun` type guard and are treated as `parentAgentId: undefined` — no hard requirement that the field be present.
- Tests cover: loading a version-5 store file (discarded, returns empty), loading a version-6 store file with runs that have `parentAgentId` set, loading a version-6 store file with runs that omit the field (treated as `undefined`).
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** none (parallelisable with Tasks 1 and 2)
**Estimate:** 2
**Notes:** The `isRun` guard in `run-store.ts` currently checks only `identityKey` and `runId` — `parentAgentId` is optional so no guard change is strictly needed, but verify the guard remains correct. Covers Reqs 41 (schema version bump + optional field), 41 (no migration — discard on version mismatch). The `assembleRun` function in `run.ts` must also be updated (in Task 4) to populate `parentAgentId`; this task only adds the field to the type and bumps the version.

---

### Task 4: Ingest nested sidechain files — flat attribution and `parentAgentId` population [COMPLETE]

**What:** Extend the `ingest` orchestrator to discover sidechain files (Task 1), extract nested runs from each sidechain's own content (the nested agent's sidechain itself contains `Task` result entries for any agents it spawned), and call `assembleRun` with `parentAgentId` populated from the sidechain filename (Task 2).
**Files:** `src/core/ingest.ts`, `src/core/run.ts` (`assembleRun` signature update), `src/core/ingest.test.ts`
**Done when:**

- `assembleRun` accepts an optional `parentAgentId?: string` parameter and sets it on the returned `Run`.
- `ingest` calls `discoverSidechains` (Task 1) in addition to `discoverTranscripts`, and for each sidechain file passes the parsed entries to `extractRuns` then `assembleRun` with the `parentAgentId` extracted from the filename.
- Each nested run is attributed using the identical `resolveRunIdentity` logic as top-level runs (nearest registered repo-source ancestor of `cwd`; fallback to user-level) — no special-casing.
- A nested run's score, tokens, and other fields are NOT rolled up into the parent run's record.
- Interrupted or incomplete nested runs (those with `raw.incomplete === true`) are kept-and-tagged with `'incomplete'`, not dropped (Req 43).
- Tests cover: a fixture with a top-level transcript and a sidechain transcript (nested run attributed to its own identity tuple, `parentAgentId` set to the parent's `agentId`); a deeply-nested sidechain (agent spawning agent spawning agent); an interrupted nested run (kept-and-tagged); a nested run naming a built-in agent (dropped by the denylist as normal); a nested run matching no registered source (dropped as normal); a top-level run retaining `parentAgentId: undefined`.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 1, 2, 3
**Estimate:** 5
**Notes:** The sidechain file (`agent-<parentAgentId>.jsonl`) itself is a JSONL sidechain transcript. It contains the nested agent's conversation, including any `Task` result entries for agents it spawned — which is the source of the nested runs at depth ≥ 2. So the extraction call `extractRuns(readJsonl(sidechainPath))` reuses the same extractor unchanged. The `transcriptPath` argument passed to `assembleRun` for sidechain-discovered runs should be the sidechain file path so `sidechainPathFor` can locate the grandchild sidechain correctly. Covers Reqs 39, 40, 41, 43.

---

### Task 5: Deduplication guard — block duplicate `agentId` ingestion [COMPLETE]

**What:** Add a deduplication check so a run whose `agentId` has already been ingested (from any path) is skipped, not written again.
**Files:** `src/core/ingest.ts`, `src/core/ingest.test.ts` (extend)
**Done when:**

- During a single `ingest` call, each `agentId` is tracked in a `Set`; the second encounter of the same `agentId` is skipped before calling `assembleRun` or `store.upsert`.
- This guard applies across both the top-level and sidechain traversal paths.
- The existing per-run dedup key `(identityKey, runId)` in `RunStore.upsert` is not removed — the new guard is an in-process early exit that complements it.
- Tests cover: the same `agentId` appearing in both a top-level transcript and a sidechain traversal (only the first encounter is written); two different runs in the same sidechain (both written); the same `agentId` appearing in two separate `ingest` calls across process restarts (the second call is handled by the store's `upsert` no-op, not the in-process set).
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 4
**Estimate:** 2
**Notes:** The `agentId` is the `raw.agentId` field — unique per run in the Claude Code data model. The in-process `Set<string>` is reset each `ingest` call (it is a local variable). This ensures that if a run is reachable via both the parent transcript and the sidechain directory traversal — for example because a parent transcript's `Task` result references the same `agentId` that also appears as a sidechain filename — only the first encounter is written. Covers Req 42.

---

### Task 6: "Spawned by" resolution in core — `resolveParentAnnotation`

**What:** Add a pure core function that, given a `parentAgentId`, looks up the parent run in the run store and returns a human-readable "spawned by" annotation string (or a graceful fallback when the parent is unknown).
**Files:** `src/core/lineage.ts` (new), `src/core/lineage.test.ts`, export from `src/core/index.ts`
**Done when:**

- `resolveParentAnnotation(parentAgentId: string, allRuns: readonly Run[]): string` is exported.
- When a run with `runId === parentAgentId` is found in `allRuns`, the annotation is `spawned by <agentName>` (using the parent run's `agentName`).
- When no matching run is found (parent not yet ingested, or its definition is gone), the annotation degrades to `spawned by <parentAgentId>` — the raw id — and does NOT throw.
- Tests cover: parent found (returns name), parent not found (returns raw id), empty `allRuns` array (returns raw id), `parentAgentId` matching multiple runs (uses first match — deterministic).
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 3
**Estimate:** 2
**Notes:** This function is pure over its inputs — no store reads; callers pass the already-loaded run list. The annotation string format must match exactly what `show` and `trend` will render: `spawned by <name>` or `spawned by <id>`. Covers Req 44 (resolution logic) and the graceful-degradation case in Req 44. Export as a named function from `src/core/index.ts` so the CLI commands can import it without reaching into `src/core/lineage.ts` directly.

---

### Task 7: "Spawned by" annotation in `show` ✓ COMPLETE

**What:** Extend the `handler show` output to include a read-only "spawned by `<agent>`" annotation for each run entry that has a `parentAgentId`, using the `resolveParentAnnotation` function from Task 6.
**Files:** `src/cli/commands/show.ts`, `src/cli/commands/show.test.ts`
**Done when:**

- Each per-run entry in `handler show` output includes a "spawned by `<agent>`" line when the run has a `parentAgentId`.
- The annotation uses the resolved name when the parent is in the run list; degrades to the raw id when not.
- Runs without `parentAgentId` show no annotation (no blank line or placeholder).
- The command does not fail (exit non-zero or throw) when the parent run is absent or its definition is gone.
- Tests cover: an agent with a nested run (annotation shows parent name), an agent with a nested run whose parent is not in the store (annotation shows raw id), an agent with only top-level runs (no annotation rendered).
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 5, 6
**Estimate:** 2
**Notes:** The `allRuns` list for annotation resolution is the full run list already returned by `ingest` — pass it to `resolveParentAnnotation` directly. Do not add any new ingest or store reads in the CLI layer. Formatting should match existing per-run output style in `show.ts` (chalk, indentation). Covers Req 44 (`show` annotation + graceful degradation).

---

### Task 8: "Spawned by" annotation in `trend` [COMPLETE]

**What:** Extend the `handler trend` per-run output to include the same "spawned by" annotation for runs that carry a `parentAgentId`.
**Files:** `src/cli/commands/trend.ts`, `src/cli/commands/trend.test.ts`
**Done when:**

- Per-run rows in `handler trend` output (non-bucketed mode) include "spawned by `<agent>`" when the run has a `parentAgentId`, using `resolveParentAnnotation`.
- Bucketed rows (day/week) are unaffected — no annotation on aggregated rows (individual runs lose their identity in a bucket).
- Runs without `parentAgentId` show no annotation.
- The command does not fail when the parent is absent.
- Tests cover: a trend series with a mix of nested and top-level runs (annotation only on nested), bucketed output (no annotations), parent not found (degrades gracefully).
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 6, 7
**Estimate:** 2
**Notes:** `trend` already has separate render paths for per-run (`TrendRow`) and bucketed (`BucketRow`) output — the annotation belongs only in the per-run path. Pass the same full `allRuns` list (from `ingest`) to `resolveParentAnnotation`. Covers Req 44 (`trend` annotation).

---

### Task 9: Integration test — end-to-end nested capture pipeline

**What:** An integration test that exercises the full pipeline with fixture data: a parent transcript containing a nested `Task` result, a sidechain file containing that nested agent's conversation (itself with a further nested `Task` result), discovery, ingestion, scoring, and `show`/`trend` annotation — confirming all six requirements across the vertical slice.
**Files:** `src/core/ingest.integration.test.ts` (new or extend existing), plus fixture JSONL files under `src/core/__fixtures__/nested/`
**Done when:**

- Fixture directory contains: a parent-session `.jsonl` transcript (with a `Task` result referencing `agentId: "agent-1"`), a sidechain file `agent-1.jsonl` (with its own `Task` result referencing `agentId: "agent-2"`), and a deeper sidechain `agent-2.jsonl`.
- After `ingest` over the fixture, the run store contains attributed runs for the agent-1 and agent-2 nested agents with their correct identity tuples, `parentAgentId` set, and `incomplete` tag where appropriate.
- Re-running `ingest` over the same fixtures produces no duplicate records (Req 42 verified).
- An interrupted nested sidechain (file exists but `toolUseResult` summary missing) is kept-and-tagged `incomplete`, not dropped (Req 43).
- `resolveParentAnnotation` resolves the annotation correctly for each run.
- The test imports only from `src/core/index` and does not call CLI layer code.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 5, 6
**Estimate:** 3
**Notes:** Reuse the fixture and `CliContext` initialisation patterns from Feature 2 and Feature 5 integration tests. The fixture transcript format must match the real Claude Code JSONL schema for `Task` result entries (see `src/core/transcripts/extract.ts` for the expected shape). This is the primary regression net for all six Reqs 39–44; run it as a single `describe` block with one `it` per requirement. Covers Reqs 39–44 holistically.

---

## Summary

- **Total tasks:** 9
- **Total estimated effort:** 22 points
- **Critical path:** Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 (type + version → ingest sidechain → dedup → resolution → show → trend → integration)
- Tasks 1, 2, and 3 are mutually parallelisable; Task 4 depends on all three; Tasks 7 and 8 can run in parallel once Task 6 is done.
- **Risks:**
  - Task 4 — the `assembleRun` signature change (`parentAgentId` parameter) touches the ingest seam and may require updating callers in the hook path (`src/core/hook/`) and the GUI core module (`src/core/gui/`); audit all `assembleRun` call sites before writing the implementation.
  - Task 4 (depth) — the recursive sidechain extraction (depth ≥ 2) relies on the parent's sidechain itself being a valid JSONL with `Task` result entries; if the sidechain format differs from the parent-session format, `extractRuns` will silently return nothing — the fixture in Task 9 should exercise this path explicitly.
  - Task 9 — the fixture JSONL format must exactly match the real Claude Code schema or the test will pass against synthetic data that doesn't reflect production inputs; prefer copying real (sanitised) transcript snippets rather than hand-writing the shape from memory.
