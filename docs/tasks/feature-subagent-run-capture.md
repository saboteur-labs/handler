# Task List: Subagent run capture (restoring attribution)

**Feature source:** `docs/specs/feature-subagent-run-capture.md` (FR-1 to FR-36)
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md. Each task writes the failing test first, then the minimum code, then refactors. Core logic in `src/core/`, CLI thin in `src/cli/`. Named exports, explicit return types, kebab-case files. Persistence only through `src/core/store/json-store.ts`. Check with `npx vitest run <file>`, `npm test`, `npm run typecheck`, `npm run lint`.
**Parallelism:** tasks with no dependency between them touch disjoint files so they can run concurrently in isolated worktrees. Tasks that share a file (`src/core/run.ts`, `src/core/ingest.ts`, `src/core/index.ts` (Task 13 only), `src/cli/index.ts`) are ordered by dependency.

---

### Task 1: Real-shape synthetic fixtures

**What:** A fixture tree and small loader helpers pinning the real on-disk shapes (meta.json, async_launched result, task-notification text, snake_case SubagentStop payload, runlog envelope, sub-transcript) with entirely synthetic content.
**Files:** `src/core/__fixtures__/capture/` (a `projects/<proj>/<session>.jsonl` parent transcript, `<session>/subagents/agent-<id>.jsonl` plus sibling `agent-<id>.meta.json` files, a nested spawnDepth-2 run, `runlogs/repos/<repo>/<session>.jsonl`, `runlogs/sessions/` pointer file), `src/core/__fixtures__/capture/fixtures.ts` (builders/paths), `src/core/__fixtures__/capture/fixtures.test.ts`.
**Done when:** `fixtures.test.ts` fails first, then passes, asserting each fixture parses and has exactly the pinned keys. meta.json: `agentType, launchedWithDefaults, description, toolUseId, spawnDepth, requestShape, requestNonInteractive, finished`, plus a case with `finished` absent and a spawnDepth 2 case with `parentAgentId`. async_launched `toolUseResult` keys: `agentId, canReadOutputFile, canContinueAgent` (one case omitting it), `description, isAsync, outputFile, prompt, resolvedModel, status:"async_launched"`. Parent-entry task-notification text blocks (in a `user` entry and a `queue-operation` entry) with `<task-id>, <output-file>, <status>, <summary>, <usage><subagent_tokens>/<tool_uses>/<duration_ms>`, the same task-id appearing more than once (resume case with a changed status), and a task-id matching no run. SubagentStop snake_case payload keys: `session_id, transcript_path, cwd, agent_id, agent_type, agent_transcript_path, last_assistant_message, permission_mode, effort, stop_hook_active, background_tasks, hook_event_name`, plus an empty-`agent_type` case. Runlog envelope `{v:1, ts, ts_ms, repo, event:"SubagentStop", session_id, agent_id, tool_use_id:null, payload}`, plus a non-SubagentStop event, a malformed line, and a pointer file. Sub-transcripts include a complete one (tool_use blocks, final assistant usage), an empty one, and a malformed one. No real prompts or content are copied.
**Depends on:** none
**Estimate:** 3
**Notes:** Covers FR-33 (fixtures). Counts in the spec are context, not fixture content. Fixtures are the shared oracle for every later task, so keep builders small and documented. Include a test-only helper that computes expected values from the sub-transcript so later tests can use notification `<usage>` as an oracle (allowed by FR-3).
**Done:** [x]

### Task 2: Shared sub-transcript run-metrics computation

**What:** One core module that computes `totalToolUseCount`, `totalDurationMs`, `totalTokens`, and `toolStats` from a sub-transcript, reused by ingest, the hook, and `import-runlog`.
**Files:** `src/core/transcripts/run-metrics.ts`, `src/core/transcripts/run-metrics.test.ts` (reuses `readJsonl` from `src/core/transcripts/jsonl.ts`).
**Done when:** `run-metrics.test.ts` fails first, then passes: `computeRunMetrics(sidechainPath)` returns `totalToolUseCount` equal to the count of tool_use blocks in assistant entries; `totalDurationMs` equal to last entry timestamp minus first; `totalTokens` equal to the final assistant turn's `input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens`; `toolStats` derived from the same tool_use blocks using exactly the legacy key set `readCount, searchCount, bashCount, editFileCount, linesAdded, linesRemoved, otherToolCount` (every key always present, so legacy and meta runs aggregate alike in `src/core/metrics.ts`); a test pins the tool-name to key mapping; the fixture oracle from notification `<usage>` agrees (tool_uses equal, duration within 10%, tokens within 2%); a missing, empty, unreadable, or malformed file returns `undefined` metrics without throwing and flags "no usable data" for FR-5.
**Depends on:** 1
**Estimate:** 3
**Notes:** Covers FR-3, and the metric half of FR-5 and FR-8. Legacy key set was read from the 88 runs in the real `~/.handler/runs.json` (all 88 carry exactly those 7 keys); the repo's own fixtures only show `readCount`/`editCount`. The legacy tool-name to category mapping is NOT determinable from the repo (the source `toolUseResult` data is gone), so the proposed mapping (Read to readCount; Grep and Glob to searchCount; Bash to bashCount; Edit, Write, MultiEdit, NotebookEdit to editFileCount; everything else to otherToolCount) is an unverified assumption and must be labelled as such in code comments. `linesAdded`/`linesRemoved` cannot be derived reliably from tool_use inputs; derive from Edit/Write inputs if feasible, else emit 0 and say so in a comment. Scoring (`src/core/scoring/*`) reads telemetry from the sub-transcript, not `toolStats`; `toolStats` is consumed only by `src/core/metrics.ts` aggregation and `show`. `totalTokens` is a final-turn context size by spec; document that in the doc comment. Notification `<usage>` must not be a source in production code.
**Done:** [x]

### Task 3: Task-notification parser and status resolution

**What:** A parser that extracts `<task-notification>` blocks from parent-session entries and resolves the latest status per agentId.
**Files:** `src/core/transcripts/notifications.ts`, `src/core/transcripts/notifications.test.ts`.
**Done when:** `notifications.test.ts` fails first, then passes: `extractNotifications(entries)` finds notification text blocks in both `user` and `queue-operation` entries; `latestStatusByAgentId(entries)` returns, per `<task-id>`, the `<status>` of the latest notification in entry order (the resume fixture ends on its changed status, not the first `completed`); repeated notifications for one id yield one map entry; an agentId with no notification is absent from the map (status unset); malformed or truncated notification text and entries of unexpected shape are skipped without throwing; meta `finished` and `stop_reason` are never consulted.
**Depends on:** 1
**Estimate:** 3
**Notes:** Covers FR-4 (status source), part of FR-7 and FR-8. Ignoring task-ids that match no on-disk run happens at the join in the ingest task (7), because only ingest knows the on-disk run set. Notification `<usage>` is not parsed into metrics (FR-3); it need not be parsed at all in production code.
**Done:** [x]

### Task 4: Meta-file reader and `agent-*.meta.json` discovery

**What:** A defensive meta reader plus discovery of each `agent-*.jsonl` that has a sibling `agent-<agentId>.meta.json` under a `subagents/` directory.
**Files:** `src/core/transcripts/meta.ts`, `src/core/transcripts/meta.test.ts`, `src/core/transcripts/discover.ts`, `src/core/transcripts/discover.test.ts`.
**Done when:** tests fail first, then pass: `discoverMetaRuns(projectsRoot)` returns one candidate `{agentId, sidechainPath, metaPath, meta}` per `agent-<id>.jsonl` with a sibling meta file, at arbitrary `subagents/` depth including nested runs, taking `agentId` from the filename and `agentType` from the meta; it uses the exact pattern `agent-*.jsonl` and never a generic `.json` glob (a stray `foo.json` and `agent-x.meta.json` alone are not candidates); `sidechainPath` is the path found at discovery, not reconstructed; `readMeta` returns `agentType`, `spawnDepth`, `parentAgentId`, `finished` (parsed but unused as a success signal) and returns `undefined` for a missing, empty, or malformed meta without throwing, and the remaining runs are still discovered; a jsonl without a meta file is not a meta candidate; a missing root yields `[]`.
**Depends on:** 1
**Estimate:** 3
**Notes:** Covers FR-1, FR-8 (meta side), and the meta-reading half of FR-11. Do not change existing `discoverSidechains` behavior (the legacy pass still uses it). Sorted output for determinism.
**Done:** [x]

### Task 5: Run model, source precedence, and store version 7

**What:** Extend the `Run` model for meta-discovered runs, add the `'runlog'` source with a precedence rule, and bump the run store version.
**Files:** `src/core/run.ts` (types only: `source` union, `spawnDepth?`), `src/core/store/precedence.ts`, `src/core/store/precedence.test.ts`, `src/core/store/run-store.ts`, `src/core/store/run-store.test.ts`, `src/core/run.test.ts`.
**Done when:** tests fail first, then pass: `Run.source` is `'hook' | 'transcript' | 'runlog'`; `Run` carries optional `spawnDepth`; `canOverwrite(existingSource, incomingSource)` implements transcript > hook > runlog (transcript overwrites hook, runlog, or unset; hook overwrites runlog but never transcript; runlog never overwrites hook or transcript; a missing existing record or unset legacy source is upgradable by any); `RUN_STORE_VERSION === 7`, a version-6 file degrades to an empty store, and the version doc comment in `run-store.ts` records the bump; `npm run typecheck` passes.
**Depends on:** 1
**Estimate:** 3
**Notes:** Covers FR-22 (precedence rule and type), FR-24. FR-23 (applying it in `persist()`) lands in Task 7, and the hook path applies it in Task 10. The store keeps deduping on `(identityKey, runId)` (FR-16); do not change `isSameRun`. This task owns edits to `run-store.ts`; keep `run.ts` changes to types so Task 6 can extend the file afterward.
**Done:** [x]

### Task 6: Meta-run assembly and shared capture assembler

**What:** A reusable assembler that turns an agent id, agent type, sub-transcript path, and optional meta fields into an attributed `Run`, shared by ingest, the hook, and `import-runlog`.
**Files:** `src/core/capture-run.ts`, `src/core/capture-run.test.ts`, `src/core/run.ts` (export `resolveRunIdentity`, reuse `readRunTelemetry`; no behavior change to `assembleRun`).
**Done when:** `capture-run.test.ts` fails first, then passes: `assembleCapturedRun({agentId, agentType, sidechainPath, status?, meta?, fallback?}, sources)` derives `cwd`, `sessionId`, and `timestamp` from the sub-transcript entries (with `fallback` values used only when the file lacks them); metrics come from Task 2's `computeRunMetrics`; `parentAgentId` and `spawnDepth` come from the meta when given (not from `parseSidechainParentAgentId`); identity resolution reuses the existing rules, so built-in and plugin names and runs matching no registered source return `null`, attribution uses the nearest-ancestor registered repo source of `cwd` else user-level, and the definition content is snapshotted per run; a run whose definition is missing is kept with the `orphan` tag; a run is tagged `incomplete` only when the sub-transcript is missing, empty, unreadable, or has no usable data, and never because meta `finished` is absent; `sidechainPath` is stored as passed in; status is the supplied notification status, unset when none; `assembleRun` (legacy) behavior is unchanged and `src/core/run.test.ts` still passes.
**Depends on:** 2, 3, 4, 5
**Estimate:** 5
**Notes:** Covers FR-2, FR-5, FR-9, FR-10, FR-11 (fields), and the FR-3 consumption. Forked-skill runs need no special case. Task 3 is listed as a dependency for the status type contract only; this task does not parse notifications itself. The definition-snapshot path reuses `loadDefinitionSnapshot`. Taking `fallback` here is what lets Task 13 (`import-runlog`) reuse this without duplicating logic (FR-29).
**Done:** [x]

### Task 7: Ingest meta pass, legacy compatibility, and dedup

**What:** Add the meta pass to `ingest()` after the legacy pass, with status from notifications, merge rules, narrow update exception, and runlog-aware `persist()`.
**Files:** `src/core/ingest.ts`, `src/core/ingest.test.ts`, `src/core/ingest.integration.test.ts`.
**Done when:** tests fail first, then pass, using Task 1 fixtures: a fresh ingest of the capture fixture attributes meta-discovered runs (including the spawnDepth-2 run with its `parentAgentId`); a `toolUseResult` with `agentType` and `agentId` still produces a run exactly as before (existing ingest tests unchanged and green); an `async_launched` result without `agentType` produces no run and no error; the meta pass runs after the legacy pass and checks `seenAgentIds`, so a run seen by both paths is stored once; when the legacy result is complete (status, duration, tokens, tool count) it supplies the metrics and meta contributes only `parentAgentId` and `spawnDepth`, and when legacy is incomplete the meta run fills the gaps; repeated notifications for one agentId yield one run; status is the latest notification status and unset with none; notifications for task-ids matching no on-disk run are ignored; a later ingest updates a stored run's status and metrics but never its `definitionSnapshot`; `persist()` treats a `runlog` record as upgradable like a `hook` record via `canOverwrite`; a malformed meta, sub-transcript, or notification does not abort ingestion or drop other runs; a test pins behavior when one agentId resolves to different identities across paths (stored per `(identityKey, runId)`, as asserted).
**Depends on:** 3, 6
**Estimate:** 5
**Notes:** Covers FR-6, FR-7, FR-8, FR-13, FR-14, FR-15, FR-16 (ingest side), FR-23. Highest-risk task: it changes the first-snapshot-wins invariant in one narrow way (status and metrics only). Keep the legacy loops intact and add the meta loop below them. Notification scanning reads the same parent transcripts the legacy pass already parses; avoid reading each file twice if practical.
**Done:** [x]

### Task 8: Nested-run annotation for meta-discovered runs

**What:** Confirm and, if needed, fix `show` and `trend` so meta-discovered nested runs render `spawned by <agent>`.
**Files:** `src/cli/commands/show.test.ts`, `src/cli/commands/trend.test.ts`, `src/cli/commands/show.ts` and `src/cli/commands/trend.ts` only if a gap is found, `src/core/lineage.ts` only if a gap is found.
**Done when:** a test over runs produced by ingesting the capture fixture (spawnDepth 2 run with `parentAgentId`) fails first if the annotation is missing, then passes: `show` and `trend` output contains `spawned by <parent agent name>` for the meta-discovered nested run; any code change is limited to what the failing test demands.
**Depends on:** 7
**Estimate:** 1
**Notes:** Covers FR-12. Likely test-only since both commands already read `parentAgentId`. CLI stays free of logic; if the lookup needs fixing, fix it in core.
**Done:** [x]

### Task 9: Snake_case SubagentStop payload parser

**What:** Rewrite `parseHookPayload` to accept Claude Code's real snake_case SubagentStop payload.
**Files:** `src/core/hook/payload.ts`, `src/core/hook/payload.test.ts`.
**Done when:** `payload.test.ts` fails first, then passes against the Task 1 snake_case fixture: `parseHookPayload` returns `agentId`, `agentType`, `cwd`, `sessionId`, and `agentTranscriptPath` from `agent_id`, `agent_type`, `cwd`, `session_id`, `agent_transcript_path`; it does not require `status` or any totals; it returns `null` for non-objects and for a payload missing `agent_id`; an empty or absent `agent_type` parses but is distinguishable so the handler can skip it (for example `agentType: ''` is rejected as a skip signal documented in the type); extra keys (`last_assistant_message`, `background_tasks`, and so on) are ignored; it never throws. The old camelCase-only tests are replaced by the real-shape tests.
**Depends on:** 1
**Estimate:** 2
**Notes:** Covers FR-17 and FR-34 (parser tests). `HookPayload` is no longer structurally a `RawRun`; Task 10 adapts the handler. The `import-runlog` reader (Task 12) reuses this parser, so export it with a stable shape.
**Done:** [x]

### Task 10: Hook handler on the real payload

**What:** Rework `handleSubagentStop` to assemble the run from `agent_transcript_path` with shared metrics, skip empty agent types, and respect source precedence.
**Files:** `src/core/hook/handler.ts`, `src/core/hook/handler.test.ts`.
**Done when:** `handler.test.ts` fails first, then passes against the snake_case fixture: the handler passes `agent_transcript_path` through to `assembleCapturedRun` explicitly (no `assembleRun(..., '')`); when that file exists the stored run carries FR-3 metrics; when it is missing or incomplete the run is still recorded, tagged `incomplete`, with metrics unset; a payload with empty or absent `agent_type` returns `'skipped'` without error and writes nothing; built-in agents return `'skipped'`; a hook stop never overwrites a `transcript` record but may overwrite a `runlog` record (via `canOverwrite`); repeated stops for one agentId yield one run; the handler never throws on malformed input or store errors. Old camelCase handler tests are replaced or supplemented by real-shape ones.
**Depends on:** 5, 6, 9
**Estimate:** 3
**Notes:** Covers FR-7 (hook side), FR-16 (hook side, with a test where one agentId resolves differently), FR-18, FR-19, FR-22 (hook side), FR-34 (handler tests). The existing return type `HandleResult` may stay as is. This task does not edit `src/core/index.ts`; any new export it needs is added by Task 13.
**Done:** [x]

### Task 11: Hook CLI entrypoint hardening

**What:** Make `src/cli/hook-handler.ts` read the snake_case `agent_id` for its stderr label, always exit 0, and confirm nothing auto-installs the hook.
**Files:** `src/cli/hook-handler.ts`, `src/cli/hook-handler.test.ts`, `src/cli/commands/hook.integration.test.ts`, `src/cli/commands/hook.test.ts`.
**Done when:** tests fail first, then pass: with the snake_case fixture the stderr line reads `captured: <agent_id>` (and `skipped: <agent_id>` for an empty `agent_type`); malformed JSON, empty stdin, non-object JSON, and a store error each exit 0 with a `malformed: unknown` or `error: <message>` stderr line and no stdout; the label field is `agent_id`, not `agentId`; a test asserts `hook enable`/`hook disable` and the entrypoint never write to any `settings.json` (print-only), and no code path installs the hook; camelCase-payload tests in these files are replaced or supplemented by real-shape ones.
**Depends on:** 9, 10
**Estimate:** 2
**Notes:** Covers FR-20, FR-21, FR-34 (CLI tests). Keep the entrypoint thin; logic stays in core. The `parseJsonInput` export stays.
**Done:** [x]

### Task 12: Runlog reader (scan, unwrap, dedup, skip counts)

**What:** A core reader that scans the runlogs directory, unwraps `SubagentStop` envelopes, and yields deduplicated stops with skip counts.
**Files:** `src/core/runlog/reader.ts`, `src/core/runlog/reader.test.ts`.
**Done when:** `reader.test.ts` fails first, then passes against the Task 1 runlog fixtures: `readRunlogStops(root)` scans `<root>/repos/*/*.jsonl` (root defaults to `~/.claude/runlogs`; the override points at the runlogs directory), ignores `<root>/sessions/*` pointer files, and does not filter by repo; it unwraps `.payload` of `SubagentStop` envelopes and routes each through `parseHookPayload` (Task 9); other event types are ignored; stops are deduplicated by `agent_id` with the latest stop winning (by `ts_ms`, falling back to file order) and each result carries the envelope `ts`; stops with an empty `agent_type` are skipped and counted; malformed lines are skipped and counted; the result reports `skippedEmptyAgentType` and `skippedMalformed` counts; a missing root yields no stops and zero counts; runlog files are opened read-only and never modified (a test checks mtime/content unchanged).
**Depends on:** 1, 9
**Estimate:** 3
**Notes:** Covers FR-25 (scan and root override), FR-26, FR-27 (dedup and counts), FR-31 (read-only, no throw on malformed lines). No identity or store logic here.
**Done:** [x]

### Task 13: Runlog import into the run store

**What:** Core `importRunlog` that assembles runs from reader output with the shared assembler and writes them with `source: 'runlog'`, idempotently.
**Files:** `src/core/runlog/import.ts`, `src/core/runlog/import.test.ts`, `src/core/index.ts` (export `importRunlog`, its result type, and any new export introduced by Task 10).
**Done when:** `import.test.ts` fails first, then passes: each stop is assembled via `assembleCapturedRun` applying the builtin denylist and identity rules (dropped silently when built-in or unregistered; kept and tagged `orphan` when the definition is not found); when `agent_transcript_path` exists, metrics are computed per FR-3; when it does not, the run falls back to the payload `cwd` and `session_id`, takes `timestamp` from the envelope `ts`, records no metrics, and is tagged `incomplete` (and `orphan` as applicable); imported runs carry `source: 'runlog'`; a runlog record never overwrites an existing hook or transcript record while a hook or transcript run later replaces it (via `canOverwrite`); a second import over the same input adds and changes nothing (store file content identical); a test pins the case where one agentId resolves to different identities; `src/core/index.ts` exports `importRunlog`, its result type, and anything new Task 10 introduced (nothing, if Task 10 added no exports); the result reports imported count plus the reader's skipped-empty-type and skipped-malformed counts; it never throws on malformed input.
**Depends on:** 5, 6, 12
**Estimate:** 5
**Notes:** Covers FR-28, FR-29, FR-30, FR-31 (local-only, no network), FR-16 (import side). Persist only through `RunStore`. Serialize on `src/core/index.ts` edits: this is the only task that edits it.
**Done:** [x]

### Task 14: `import-runlog` CLI command, help text, and README

**What:** A thin `handler import-runlog` command wired into the CLI with help text stating the cache limitation, and README usage.
**Files:** `src/cli/commands/import-runlog.ts`, `src/cli/commands/import-runlog.test.ts`, `src/cli/index.ts` (register), `README.md` (new `### handler import-runlog` section).
**Done when:** `import-runlog.test.ts` fails first, then passes: the command is registered in `src/cli/index.ts`; `--root <dir>` overrides the default `~/.claude/runlogs` (pointing at the runlogs directory); it prints the imported count and the skipped-empty-`agent_type` and skipped-malformed counts; it exits 0 even when the input has malformed lines; `--help` text states that the run store is a regenerable cache, so a later version bump or `reset` at the default `derived` scope drops runlog-imported runs, which return only by re-running `import-runlog` while the runlogs still exist; the command holds no logic beyond arg parsing and formatting; the README section documents usage, `--root`, and the limitation. `npm run lint` and `npm run format:check` pass.
**Depends on:** 13
**Estimate:** 3
**Notes:** Covers FR-25 (CLI override surface), FR-31 (exit code), FR-32 (SHOULD). Follow `src/cli/commands/reset.ts` style (`registerXCommand(program, ctx)`). The CLAUDE.md architecture update is out of scope (a later documentation stage). `src/cli/index.ts` is shared; this is the only task that edits it.
**Done:** [x]

### Task 15: Cross-path integration and precedence tests

**What:** End-to-end tests over the Task 1 fixtures that run ingest, the hook, and `import-runlog` against one store in every order.
**Files:** `src/core/capture.integration.test.ts` (new).
**Done when:** the test file passes: running ingest, hook, and runlog import in each of the six orderings over the same fixtures converges to one run per `(identityKey, runId)` with `source` `'transcript'` whenever a transcript run exists; hook then runlog leaves `hook`; runlog then hook ends `hook`; repeating each path adds nothing; metrics for the same agent are identical across the three paths for the same sub-transcript (shared FR-3 computation); the legacy `toolUseResult` fixture and the meta fixture for the same agentId produce one run; an agentId resolving to different identities across paths yields the asserted per-identity records; no test depends on network or real `~/.claude`.
**Depends on:** 7, 10, 13
**Estimate:** 3
**Notes:** Covers FR-7, FR-15, FR-16, FR-22, FR-30 across paths, and FR-33 ("tests for FR-1 to FR-31 use the fixtures"). Test-only; if it exposes a defect, fix it in the owning module and note it in the commit.
**Done:** [x]

### Task 16: Manual acceptance check against real transcripts (not for CI)

**What:** The lead runs a fresh ingest of the user's real `~/.claude/projects` into an empty store and reports the attributed run count.
**Files:** none (verification only; do not commit output; use a temporary store path such as `HANDLER_STORE`, not `~/.handler/runs.json`).
**Done when:** a reported count of attributed runs from a fresh ingest into an empty temporary store is recorded in the PR or hand-off note, together with the runlog-derived reference (about 1,164 user-authored runs, order-of-magnitude comparison only; exact equality is not required), and `handler list` no longer reports "No agent runs found."
**Depends on:** 8, 11, 14, 15
**Estimate:** 1
**Notes:** Covers FR-35 (SHOULD). Manual step run by the lead after implementation; it reads real user data, so it must not be an automated test and must not run in CI. If the count is far from the reference, report the measurement and which experiment would discriminate the cause; do not assert a cause.
**Result (2026-10-21):** Fresh ingest of the real `~/.claude/projects` into an empty temp store (a copy of the user's one registered user-level source): 1,263 runs attributed (store v7, all `source` transcript): saboteur-task-implementor 710, saboteur-spec-manager 320, saboteur-feature-orchestrator 98, saboteur-oq-triage 76, saboteur-scribe 56, fork 3 (tagged orphan). `handler list` no longer prints "No agent runs found." Status: 1,258 completed, 3 killed, 1 failed, 1 unset. 673 runs carry `parentAgentId`. Runlog reference over its window (first start 2026-09-14): 1,184 saboteur-\* SubagentStarts, 1,181 present in the store; of the 3 absent, 1 started after the store was written and 2 have no sub-transcript on disk. The 3 `fork` runs are a built-in agent that the denylist did not cover; addressed by Task 17.
**Done:** [x]

### Task 17: Extend the built-in denylist

**What:** Add `fork`, `claude`, and `claude-code-guide` to the built-in agent denylist so built-in runs are excluded on every capture path.
**Files:** `src/core/denylist.ts`, `src/core/denylist.test.ts`, `src/core/ingest.test.ts`.
**Done when:** tests fail first, then pass, and a fresh ingest stores no `fork` run: `denylist.test.ts` asserts `fork`, `claude`, and `claude-code-guide` are treated as built-in; `ingest.test.ts` has a test showing the meta-discovery ingest path excludes a run whose agent type is `fork`; existing denylist and ingest tests stay green.
**Depends on:** 7
**Estimate:** 1
**Notes:** Follows from the Task 16 measurement of 3 `fork` runs stored as orphans. Test-only beyond the one list edit in `src/core/denylist.ts`. The tick for this task is left to the lead after re-running the fresh ingest.
**Done:** [x]

### Task 18: Incremental ingest

**What:** Make repeated ingest skip unchanged sub-transcripts and unchanged parent session transcripts using a regenerable extraction cache, and read each sub-transcript once per assembly.
**Files:** `src/core/ingest.ts`, `src/core/capture-run.ts`, `src/core/run.ts` (optional sidechain size/mtime fields), `src/core/store/ingest-cache.ts` (new), `src/core/reset.ts`, and their tests (`src/core/ingest.test.ts`, `src/core/capture-run.test.ts`, `src/core/store/ingest-cache.test.ts`, `src/core/reset.test.ts`).
**Done when:** tests fail first, then pass: a test counting file reads shows a second ingest over unchanged fixtures reads no sub-transcript and parses no parent transcript; a test shows incremental and full (empty-store) ingest produce identical stores, including after a parent gains a newer notification (status update applies) and after a sub-transcript grows (re-read and re-assembled); a run assembly reads its sub-transcript once; the cache is stored beside the run store and a wrong-version or corrupt cache degrades to empty; `reset` at the default `derived` scope clears the cache; existing ingest and reset tests stay green; the lead records warm `handler list` time before and after on the same store copy.
**Depends on:** 7, 17
**Estimate:** 3
**Notes:** Covers FR-36. Motivating measurement is in the spec (warm `handler list` 13.2-18.4 s). Persist the cache only through `src/core/store/json-store.ts`. The before/after timing is a manual step by the lead and is not an automated test; report the measurement without asserting a cause beyond what the profile shows.
**Done:** [x]

## Summary

- Total tasks: 18
- Total estimated effort: 52 story points
- Critical path: Tasks 1 → 2 → 6 → 13 → 14 → 16
- Risks: Task 7 (alters the first-snapshot-wins invariant and merges two discovery paths; most regression surface). Task 2 (the legacy tool-name to `toolStats` category mapping cannot be verified from the repo, only the 7 legacy key names could). Task 6 (single shared assembler that three consumers depend on). Task 16 (depends on the real data state; manual). Parallel waves after Task 1: {2, 3, 4, 5, 9}; then {6, 12}; then {7, 10, 13}; then {8, 11, 14, 15, 17}; then {16, 18}.
