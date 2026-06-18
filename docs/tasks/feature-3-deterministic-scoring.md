# Task List: Feature 3 — Deterministic behavioral scoring

**Feature source:** `docs/specs/feature-3-deterministic-scoring.md`
**Requirements covered:** spec Reqs 12, 13, 14, 15 (`docs/spec.md`)
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor.

Builds on Feature 2's run store, snapshots, and transcript parsing. Sidechain shape validated against real `~/.claude` data: assistant `message.content` carries `tool_use` blocks (`name`, `input`); user entries carry `tool_result` blocks (`is_error`, `content`); denials are the deterministic string `"Permission to use <tool> has been denied"`.

---

### Task 1: Sub-transcript locator on the run record (Feature 2 amendment)

**What:** Extend the stored `Run` to carry `cwd`, `sessionId`, and the per-run sidechain path so scoring can find turn-level detail.
**Files:** `src/core/transcripts/extract.ts`, `src/core/run.ts`, `src/core/ingest.ts` (+ tests).
**Done when:** a stored `Run` includes `cwd`, `sessionId`, and `sidechainPath` resolving to `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl`; tests assert the locator is correct for a fixture transcript.
**Depends on:** none (builds on Feature 2)
**Estimate:** 3
**Notes:** `sessionId` comes from the entry; `sidechainPath` is derived in `ingest` from the transcript path + sessionId + agentId. Ripples to the Feature 2 exact-match `Run`/`RawRun` tests (mechanical). Req 11. Verified against real data: all 17 ingested runs' `sidechainPath` resolve to an existing sidechain file.
**Done:** [x]

### Task 2: Run-activity parser (sidechain → tool calls, denials, errors)

**What:** Parse a per-run sidechain JSONL into structured activity: tool invocations (name + input), permission denials, and tool errors.
**Files:** `src/core/scoring/activity.ts` (+ test).
**Done when:** given fixture sidechain entries, returns ordered `toolCalls` (name, args), a denial list (matched on the `"Permission to use <tool> has been denied"` string), and an error list (`tool_result.is_error` excluding denials); a missing/malformed file yields empty activity without throwing.
**Depends on:** none
**Estimate:** 3
**Notes:** Highest empirical risk — pin against a real-shaped fixture (`tool_use {name,input}`, `tool_result {is_error,content}`). Reuse `readJsonl`. Surfaces the run `cwd` from sidechain entries as a cross-check. Verified on real data: 712 tool calls across 40 sidechains parsed; denial regex confirmed against an actual `"has been denied"` transcript (counted as denial, not error).
**Done:** [x]

### Task 3: Definition tools-scope parser

**What:** Parse the `tools` frontmatter from a definition snapshot into a granted-tool set, or an "undeclared" marker.
**Files:** `src/core/scoring/scope.ts` (+ test).
**Done when:** a snapshot with `tools: A, B` yields `{A, B}`; a snapshot with no `tools` key yields the undeclared marker; absent/garbled frontmatter is handled without throwing.
**Depends on:** none
**Estimate:** 2
**Notes:** Minimal frontmatter read scoped to `tools` only. Feature 4 needs fuller frontmatter parsing later — `extractFrontmatter` is exported for that reuse. Handles inline comma list, bracket array, and block sequence; absent/empty/garbled → undeclared. Verified against a real agent definition (no `tools` field → undeclared).
**Done:** [x]

### Task 4: Activity checks — denials, errors, thrash, terminal status

**What:** Compute permission-denial count, tool-error count, thrash events, and terminal-status pass/fail.
**Files:** `src/core/scoring/checks-activity.ts` (+ test).
**Done when:** thrash = distinct `(tool, normalized-args)` groups with ≥3 occurrences (args JSON-canonicalized key-sorted/whitespace-stripped; `Bash` by trimmed command); denial/error counts and terminal status (from `Run.status`) produced; tests cover the thrash threshold boundary and Bash normalization.
**Depends on:** 1, 2
**Estimate:** 3
**Notes:** Covers Req 7 checks plus terminal (Req 6) and denials (Req 5). Thrash signature: `Bash` by trimmed command, others by recursively key-sorted canonical JSON; threshold 3; counts distinct groups.
**Done:** [x]

### Task 5: Scope checks — adherence, utilization, undeclared fallback

**What:** Compute tool-scope adherence (used-but-not-granted), tool-utilization (granted-but-unused), and the undeclared-scope fallback.
**Files:** `src/core/scoring/checks-scope.ts` (+ test).
**Done when:** used tools outside the granted set are flagged; granted tools never used are reported; when scope is undeclared, adherence and utilization are marked N/A and an "undeclared scope" flag is raised; tests cover declared, violation, unused, and undeclared cases.
**Depends on:** 2, 3
**Estimate:** 3
**Notes:** Reqs 4, 9, 10 (Req 15 in the product spec). Undeclared scope → `applicable:false` + `undeclaredScope:true`, empty arrays; results sorted and used-tools de-duplicated.
**Done:** [x]

### Task 6: Boundary checks — write/path/scope

**What:** Flag any write/edit or destructive `Bash` whose resolved target falls outside the run's `cwd` subtree.
**Files:** `src/core/scoring/checks-boundary.ts` (+ test).
**Done when:** `Write`/`Edit` targets (`input.file_path`) and destructive `Bash` targets resolved against `cwd` and flagged when outside the subtree; reads are never flagged; tests cover in-subtree (ok), out-of-subtree write (flagged), and a destructive `Bash` outside (flagged).
**Depends on:** 1, 2
**Estimate:** 5
**Notes:** Highest-logic task — needs a deterministic destructive-`Bash` recogniser (`rm`, `mv`, redirections, etc.) and robust path resolution (reuse `normalizePath`/`path.relative` ancestor logic from F1's `resolve`). Req 8. Excludes fd-dups (`2>&1`) and `/dev` sinks. Known limitation: in-command `cd` is not tracked. Verified on real data: 15 precise violations across 40 sidechains, all the agent-memory dir, zero redirection false positives.
**Done:** [x]

### Task 7: Rubric — composite, band, and breakdown

**What:** Combine all check results into a per-check breakdown, a `pass`/`warn`/`fail` band, and a 0–100 composite from fixed documented weights.
**Files:** `src/core/scoring/rubric.ts` (+ test).
**Done when:** given a set of check results, produces a deterministic breakdown + band + composite; weights and the band thresholds are documented constants; a `RUBRIC_VERSION` is exported; tests pin the composite/band for sample inputs.
**Depends on:** 4, 5, 6
**Estimate:** 3
**Notes:** Reqs 1, 3. Fixed weights keep the number reproducible (no per-run tuning). Weights: tool-scope/path-boundary -25, terminal -20, denials/errors/thrash -10, utilization/undeclared -5; band = worst check severity. Verified over real data: bands 29 warn / 11 fail, composites 60–95, breakdowns interpretable.
**Done:** [x]

### Task 8: Score annotation store (versioned)

**What:** Persist score annotations keyed by `(runId, rubricVersion)`, idempotent, reloading across restarts.
**Files:** `src/core/store/score-store.ts` (+ test).
**Done when:** add/get by `(runId, rubricVersion)`; re-adding the same key is a no-op; a fresh instance reloads; structurally-invalid file degrades to empty; tests cover add, dedupe, reload, version-keying.
**Depends on:** 7
**Estimate:** 2
**Notes:** Mirror `RunStore`; default `~/.handler/scores.json`. Req 12 (versioned annotations). `ScoreAnnotation = {runId, score}`; keyed by `(runId, score.rubricVersion)`.
**Done:** [x]

### Task 9: Scoring orchestrator (lazy, cached by rubric version)

**What:** Score a run end-to-end — locate sidechain → activity → checks → rubric → persist — recomputing only when no annotation exists for the current rubric version.
**Files:** `src/core/scoring/score.ts` (+ test).
**Done when:** `scoreRun(run, …)` returns the score and persists it; a second call with the same `RUBRIC_VERSION` reads the cached annotation (no recompute); an interrupted run with no sidechain degrades to a clear "unscored/incomplete" result; an end-to-end test over a fixture asserts the score and the caching.
**Depends on:** 1, 2, 3, 4, 5, 6, 7, 8
**Estimate:** 3
**Notes:** Lazy compute (Req 12), local-only (Reqs 1, 14). The integration point — most likely place for wiring bugs.
**Done:** [ ]

### Task 10: Surface the score in `handler show`

**What:** Render each run's band, composite, and breakdown in `handler show`, computing scores lazily during the command.
**Files:** `src/cli/commands/show.ts`, `src/core/index.ts` exports (+ test).
**Done when:** `handler show <agent>` prints, per run, the band, composite, and failing checks; an integration test over a fixture asserts the score appears; the command holds no scoring logic beyond calling core.
**Depends on:** 9
**Estimate:** 3
**Notes:** Req 13. Follows the thin-CLI pattern established in Feature 2.
**Done:** [ ]

---

## Summary

- **Total tasks:** 10
- **Total estimated effort:** 30 story points
- **Critical path:** Tasks 1 → 2 → 6 → 7 → 9 → 10 (20 points). Tasks 3/4/5 feed Task 7 off the path; Task 8 branches from 7.
- **Risks:** **Task 6 (boundary checks)** is the highest-logic task — destructive-`Bash` recognition and path-subtree resolution are easy to get subtly wrong. **Task 2 (activity parsing)** carries the empirical risk — denial/error/tool-call shapes must be pinned against real sidechain fixtures (validated during specification, but guard defensively per Req 7). **Task 9** is the integration point. Task 1's Feature 2 amendment ripples into existing exact-match tests — mechanical but easy to miss one.
