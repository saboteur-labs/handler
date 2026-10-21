# Subagent run capture (restoring attribution)

> Pipeline note: this run deliberately skipped the product-spec and feature-list rungs. Its scope was decided at Gate 0 and was not checked against a new product-level view. It restores `docs/spec.md` Reqs 2, 6, 7 and `docs/spec-v1.md` Reqs 37-38, which predate the pipeline schema and are context only. The document exceeds the usual 500-word guideline because it covers four coupled capture paths; they share one reconciliation rule and are specced together.

## Overview

Handler attributes a subagent run only when the parent session's `Task` result carries `toolUseResult.agentType` and `agentId`. Measured 2026-10-21 against `~/.claude/projects`: of 1,318 `Agent` tool results, 0 carry both; 1,297 are `status: "async_launched"` with no agentType and no totals. A fresh `handler list` ingest reports "No agent runs found." The real store holds 88 runs, all `source: "transcript"`, dated 2026-07-09 to 2026-08-16. Separately, `parseHookPayload` requires camelCase fields, but Claude Code's real SubagentStop payload is snake_case; it accepted 0 of 1,886 recorded payloads with a non-empty `agent_type`. The handler hook is not installed. Every one of the 1,324 sub-transcripts has a sibling `agent-<id>.meta.json` naming `agentType`. This feature makes ingestion discover runs from that metadata, keeps the legacy path working, makes the hook accept the real payload, and adds `import-runlog` to backfill runs from the runlog recorder's records. Completion is visible in the parent session as `<task-notification>` entries: joining 1,326 on-disk runs to notifications by `<task-id>` (= agentId) on 2026-10-21, 1,325 have at least one notification, and the last notification's `<status>` is completed on 1,321, killed on 3, failed on 1 (1 run has none). Meta `finished` is only ever `true` (261 runs) or absent, never `false`, and one `finished: true` run's last notification is `failed`, so `finished` does not signal success. The sub-transcript's last `stop_reason` is `tool_use` or absent on 485 runs whose notification says completed, so it is not a completion signal either. 142 notification task-ids match no on-disk run and are ignored. One run's status changed after a `completed` notification (resume). Notification `<usage>` agrees with sub-transcript computations: over 1,286 runs with exactly one usage-bearing notification, `tool_uses` equals the sub-transcript tool_use block count in 1,283, `duration_ms` is within 10% of the first-to-last entry timestamp span in all 1,286, and `subagent_tokens` matches the final assistant turn's input + cache_read + cache_creation + output tokens within 2% in 1,016 (it is a final-turn context size, not cumulative consumption). Whether the 88 legacy runs' `totalTokens` used the same definition cannot be checked, because their transcripts are deleted. Why the result shape changed is not determinable from current data; this spec makes no claim about it.

## Goals

- A fresh ingest of the current transcripts attributes on the order of the 1,164 user-authored runs the runlog shows, not 0.
- Runs are discovered from `agent-*.meta.json` plus the sibling sub-transcript, including nested runs (spawnDepth 2 or more), with metrics computed from the sub-transcript.
- Legacy `toolUseResult` data still ingests, and a run seen by several paths is stored once.
- The SubagentStop hook accepts the real snake_case payload and never throws or exits non-zero.
- Test fixtures are pinned to the real shapes (meta.json, async_launched result, snake_case hook payload, runlog envelope).

## Non-goals

- Changing the runlog recorder (`runlog-record.sh`), which is read-only for this feature.
- Recovering runs whose transcripts are deleted and which no runlog holds.
- Editing agents, network calls, or any LLM use; capture stays deterministic, local-only, and observe-only.
- Updating `CLAUDE.md` (a later documentation stage).
- Deciding what produces SubagentStop events with an empty `agent_type`.

## User stories

- US-1: As a handler user, I want to have runs discovered from the sub-transcript metadata so that `list` and `show` display my real recent runs.
- US-2: As a handler user, I want to see nested runs captured with their parent so that spawn chains remain visible.
- US-3: As a handler user, I want to keep older sync-shaped data working without double-counting so that existing history stays correct.
- US-4: As a handler user, I want to use the SubagentStop hook with Claude Code's real payload so that runs are captured in real time without errors.
- US-5: As a handler user, I want to import runs from the runlog so that history the transcripts no longer hold can be backfilled.
- US-6: As a handler maintainer, I want to rely on fixtures that match real on-disk shapes so that tests fail when the real shapes drift.

## Functional requirements

1. FR-1: Ingestion MUST discover each file matching exactly `agent-*.jsonl` that has a sibling `agent-<agentId>.meta.json` under a `subagents/` directory as one candidate run, taking the agent name from the meta file's `agentType` and the run id from the filename. It MUST NOT use a generic `.json` glob, and MUST record the sub-transcript path known at discovery as `sidechainPath` rather than reconstructing it. [US-1]
2. FR-2: For a meta-discovered run, ingestion MUST derive `cwd`, `sessionId`, and `timestamp` from the sub-transcript entries. [US-1]
3. FR-3: Run metrics MUST be computed from the sub-transcript only, by one shared computation used by ingest, the hook, and `import-runlog`: `totalToolUseCount` is the count of tool_use blocks in assistant entries; `totalDurationMs` is the last entry timestamp minus the first; `totalTokens` is the final assistant turn's `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` + `output_tokens` (a final-turn context size, not cumulative consumption); `toolStats` is derived from the same tool_use blocks. Tier B and `insights` compare runs on this definition. Notification `<usage>` MUST NOT be a metric source (tests MAY use it as an oracle). [US-1]
4. FR-4: A run's `status` MUST be the `<status>` of the latest parent-session `<task-notification>` whose `<task-id>` equals the agentId; with no notification, status MUST be unset. Meta `finished` and the sub-transcript's `stop_reason` MUST NOT be used as success signals. Notifications whose task-id matches no on-disk run MUST be ignored. [US-1]
5. FR-5: A run MUST be tagged `incomplete` only when its sub-transcript is missing, empty, unreadable, or holds no usable data; it MUST NOT be tagged `incomplete` because meta `finished` is absent. Such runs MUST be kept, not dropped. [US-1]
6. FR-6: A later ingest MAY update a stored run's status and metrics, as a narrow exception to first-snapshot-wins, but MUST NEVER change its definition snapshot. [US-1]
7. FR-7: Repeated task-notifications or hook stops for one agentId MUST yield one run, not several. [US-1]
8. FR-8: Ingestion MUST parse defensively: a missing, empty, or malformed meta file, sub-transcript, or notification MUST NOT abort ingestion and MUST NOT drop other runs. [US-1]
9. FR-9: Meta-discovered runs MUST pass through the existing identity rules: built-in and plugin agent names MUST be excluded (builtin or unregistered agents are dropped silently), attribution MUST use the nearest-ancestor registered repo source of the run's `cwd` else user-level, and the definition content MUST be snapshotted per run. [US-1]
10. FR-10: A meta-discovered run whose definition cannot be found MUST be kept and tagged, never dropped. Forked-skill runs need no special case. [US-1]
11. FR-11: Runs with `spawnDepth` of 2 or more MUST be ingested, and `parentAgentId` and `spawnDepth` MUST be read from the meta file for meta-discovered runs (not from `parseSidechainParentAgentId`, which remains for the legacy sidechain path). [US-2]
12. FR-12: `show` and `trend` MUST continue to annotate nested runs as `spawned by <agent>` for meta-discovered runs. [US-2]
13. FR-13: A `toolUseResult` carrying `agentType` and `agentId` MUST still produce a run exactly as before this feature. [US-3]
14. FR-14: A `toolUseResult` with `status: "async_launched"` and no `agentType` MUST NOT produce a run on its own and MUST NOT cause an error. [US-3]
15. FR-15: The meta pass MUST run after the legacy pass and MUST check `seenAgentIds`, so a run seen by both paths is stored once. When the legacy result is complete (status, duration, tokens, and tool count present) it MUST supply the metrics and the meta path MUST contribute only fields legacy lacks (`parentAgentId`, `spawnDepth`); when the legacy result is incomplete and the meta run is richer, meta MUST fill the gaps. [US-3]
16. FR-16: The store dedups on `(identityKey, runId)`, not agentId alone; tests for FR-7, FR-15, and FR-27 MUST pin the behavior when one agentId resolves to different identities across paths. [US-3]
17. FR-17: `parseHookPayload` MUST accept the snake_case payload (`agent_id`, `agent_type`, `session_id`, `cwd`, `agent_transcript_path`) and MUST NOT require `status` or any totals. [US-4]
18. FR-18: The hook MUST pass `agent_transcript_path` through to run assembly explicitly rather than calling `assembleRun(..., '')`, and MUST derive metrics per FR-3 when that file exists; when it is missing or incomplete, the hook MUST still record the run tagged `incomplete` with metrics unset. [US-4]
19. FR-19: The hook MUST skip, without error, a payload whose `agent_type` is empty or absent. [US-4]
20. FR-20: The hook handler and `src/cli/hook-handler.ts` MUST never throw and MUST always exit 0, including on malformed JSON, empty stdin, and store errors; the stderr label MUST read `agent_id`. [US-4]
21. FR-21: This feature MUST NOT install or auto-install the hook in user settings. [US-4]
22. FR-22: The run `source` union MUST be `'hook' | 'transcript' | 'runlog'` with precedence transcript > hook > runlog: a transcript record overwrites hook and runlog records; a hook record may overwrite a runlog record but never a transcript record; a runlog record never overwrites a hook or transcript record. [US-4]
23. FR-23: `persist()` in `src/core/ingest.ts` MUST treat a `runlog` record as upgradable in the same way it treats a `hook` record. [US-4]
24. FR-24: `RUN_STORE_VERSION` MUST be bumped from 6 to 7. [US-5]
25. FR-25: `handler import-runlog` MUST scan `<root>/repos/*/*.jsonl` with root defaulting to `~/.claude/runlogs` and overridable (the override points at the runlogs directory), MUST ignore `<root>/sessions/*` pointer files, and MUST NOT filter by repo. [US-5]
26. FR-26: `import-runlog` MUST unwrap `.payload` of `SubagentStop` envelopes (`{v, ts, ts_ms, repo, event, session_id, agent_id, tool_use_id, payload}`) and route them through the parser of FR-17, ignoring other event types. [US-5]
27. FR-27: `import-runlog` MUST deduplicate by `agent_id`, the latest stop winning, MUST skip stops with an empty `agent_type`, and MUST report a count of skipped stops and a count of skipped malformed lines. [US-5]
28. FR-28: `import-runlog` MUST apply the builtin denylist and identity rules of FR-9 and FR-10. [US-5]
29. FR-29: When `agent_transcript_path` does not exist, `import-runlog` MUST fall back to the payload's `cwd` and `session_id`, take the timestamp from the envelope `ts`, record no metrics, and tag the run incomplete or orphan as applicable; when it exists, metrics MUST be computed per FR-3. [US-5]
30. FR-30: Imported runs MUST carry `source: 'runlog'`. `import-runlog` MUST follow the precedence of FR-22 and MUST be idempotent: a second run over the same input adds or changes nothing. [US-5]
31. FR-31: `import-runlog` MUST be observe-only and local-only, MUST NOT modify runlog files, and MUST NOT exit non-zero because of malformed lines. [US-5]
32. FR-32: Because the run store is a regenerable cache, a later version bump or `reset` at the default `derived` scope drops runlog-imported runs, which return only by re-running `import-runlog` while the runlogs still exist; the command's help text SHOULD state this known limitation. [US-5]
33. FR-33: Test fixtures MUST include a real-shaped meta.json, an `async_launched` result, a snake_case SubagentStop payload, and a runlog envelope, and tests for FR-1 to FR-31 MUST use them. [US-6]
34. FR-34: Existing tests that encode the assumed camelCase hook payload MUST be replaced or supplemented by the real-shape fixtures. [US-6]
35. FR-35: Acceptance check: a fresh ingest of the user's current `~/.claude/projects` into an empty store SHOULD attribute a run count on the order of the 1,164 user-authored runs the runlog shows. Exact equality is not required. [US-1]
36. FR-36: Incremental ingest: a repeated ingest MUST NOT re-read a sub-transcript whose size and modification time are unchanged since the stored transcript record was assembled, and MUST NOT re-parse a parent session transcript whose size and modification time are unchanged since its notification statuses and legacy run summaries were last extracted. The store contents after an incremental ingest MUST equal those of a full ingest into an empty store over the same files; status updates from newer notifications still apply. When a run is assembled, its sub-transcript SHOULD be read once. The extraction cache is a regenerable cache stored beside the run store and is cleared by `handler reset` at the default `derived` scope. [US-1]

> Note (measurement only): warm `handler list` over 1.5 GB / 1,383 JSONL files took 13.2-18.4 s; of a 13.3 s profile, 12.3 s was in JSONL reading and 7.4 s was in per-run assembly, which reads each sub-transcript three times. FR-36 was added after Gate 6 at user direction, 2026-10-21.

## Open questions

None — all resolved at Gate 3 (2026-10-21). FR-36 was added after Gate 6 at user direction (2026-10-21) and raised no open questions.

## Out of scope (deferred)

- Recovering runs whose transcripts are deleted and which no runlog holds.
- Changes to the runlog recorder.
- Updating `CLAUDE.md` to reflect the current on-disk data model (follow-up documentation stage; depends on this feature).
- Automatic hook installation.
- Explaining or ingesting empty-`agent_type` SubagentStop events.
- A visible skip total for builtin or unregistered agents found by the meta pass.
