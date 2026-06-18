# Task List: Feature 2 — Run ingestion & attributed history

**Feature source:** `docs/specs/feature-2-run-ingestion-history.md`
**Requirements covered:** spec Reqs 1, 2, 6, 7, 9, 10, 11 (`docs/spec.md`)
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor.

Builds on Feature 1's existing modules: `resolveAgent`, `agentIdentity`/`identityKey`, the `json-store` persistence boundary, and the `AgentSource` model.

---

### Task 1: JSONL line reader primitive

**What:** A reader that parses a `.jsonl` file into typed entries, tolerating malformed/blank lines.
**Files:** `src/core/transcripts/jsonl.ts`, test.
**Done when:** `readJsonl(path)` returns one parsed object per valid line; blank lines are skipped and a malformed line is dropped (or collected) without throwing; a missing file returns `[]`; tests cover valid, blank, malformed, and missing-file cases.
**Depends on:** none
**Estimate:** 2
**Notes:** Pure parsing only — no domain knowledge of transcript shapes. Underpins Task 3 and (later) Feature 3's sub-transcript reads.
**Done:** [x]

### Task 2: Transcript discovery

**What:** Locate parent-session transcript files under `~/.claude/projects/<encoded-project>/<sessionId>.jsonl`.
**Files:** `src/core/transcripts/discover.ts`, test.
**Done when:** given a projects root, returns the set of parent-session `.jsonl` paths, excluding the per-run `<sessionId>/subagents/` sidechain files; a missing/empty projects dir returns `[]`; the projects root is overridable for tests; tests cover nested project dirs and sidechain exclusion.
**Depends on:** none
**Estimate:** 2
**Notes:** Default root `~/.claude/projects`; keep it injectable. Don't decode the encoded-project name unless a downstream task needs the real path — `cwd` comes from entry fields (Task 3), not the folder name.
**Done:** [x]

### Task 3: Task-result extraction + `toolUseResult` schema guard

**What:** From parsed parent-session entries, extract each subagent run's attribution + summary, guarding on schema presence.
**Files:** `src/core/transcripts/extract.ts`, test.
**Done when:** for each `Task` result entry with a well-formed `toolUseResult`, produces a `RawRun` carrying `agentType`, `agentId`, `cwd`, `status`, `totalDurationMs`, `totalTokens`, `totalToolUseCount`, `toolStats`; entries missing/!matching the expected schema are skipped or marked incomplete rather than throwing; an interrupted run (no completed summary) is emitted tagged `incomplete`; tests use real captured transcript fixtures plus a schema-drift fixture.
**Depends on:** 1
**Estimate:** 3
**Notes:** Highest-uncertainty task — pin behavior against a real `~/.claude` fixture (Reqs 2, 4, 7, 12). All defensive guarding lives here so callers can assume a clean `RawRun`.
**Done:** [ ]

### Task 4: Definition snapshot loader

**What:** Read an agent definition's current file content from its source, for per-run snapshotting.
**Files:** `src/core/snapshot.ts`, test.
**Done when:** `loadDefinitionSnapshot(source, name)` returns the content of `<source.agentsDir>/<name>.md` when present, and `null` when the file is missing (orphan); tests cover present, missing, and a name with no matching file.
**Depends on:** none
**Estimate:** 2
**Notes:** Stores content, not a path (Req 9). `null` is the orphan signal Task 5 tags on (Req 6). Uses F1's `AgentSource.agentsDir`.
**Done:** [ ]

### Task 5: Attributed run model + assembly

**What:** Combine a `RawRun` with F1 resolution and a definition snapshot into a persisted `Run` record with tags.
**Files:** `src/core/run.ts`, test.
**Done when:** given a `RawRun` + registered sources, produces a `Run` with `{ identityKey, runId (agentId), summary fields, definitionSnapshot, tags }`; a builtin/unresolvable name is dropped via `resolveAgent` returning null; a resolved-but-missing definition is kept and tagged `orphan`; an incomplete `RawRun` keeps its `incomplete` tag; tests cover attributed, orphan, incomplete, and builtin-excluded cases.
**Depends on:** 3, 4
**Estimate:** 3
**Notes:** Ties Task 3 + F1 `resolveAgent`/`agentIdentity`/`identityKey` + Task 4. Keep-and-tag, never silently drop attributable runs (Req 6). Run id = `agentId`.
**Done:** [ ]

### Task 6: Append-only run store

**What:** Persist `Run` records keyed by identity + run id, idempotent on re-ingest, reloading across restarts.
**Files:** `src/core/store/run-store.ts`, test.
**Done when:** adding runs then listing returns them; re-adding the same `(identityKey, runId)` does not duplicate; a fresh instance reloads persisted runs; query by `identityKey` returns that agent's runs; tests cover add, dedupe, reload, and per-agent query.
**Depends on:** 5
**Estimate:** 3
**Notes:** Build on F1's `json-store` (`readJsonFile`/`writeJsonFile`); default `~/.handler/runs.json`, overridable like the source registry. Versioned stored shape (`{version:1, runs:[…]}`). Append-only (Reqs 7, 8, 9).
**Done:** [ ]

### Task 7: Lazy ingestion orchestrator

**What:** End-to-end ingest: discover → read → extract → assemble → store, returning the current run set.
**Files:** `src/core/ingest.ts`, test.
**Done when:** `ingest({ sources, projectsRoot?, storePath? })` parses all discovered transcripts, attributes and stores all user-authored runs, excludes builtins, and is idempotent across repeated calls; tests drive a fixture projects dir end-to-end and assert the stored run set (and that a second call adds nothing).
**Depends on:** 2, 3, 5, 6
**Estimate:** 3
**Notes:** This is the lazy-on-read entry (Req 8) the CLI calls before reading. Wires Tasks 2/3/5/6; no new parsing logic of its own.
**Done:** [ ]

### Task 8: Metric aggregation

**What:** Aggregate a per-agent run set into display metrics.
**Files:** `src/core/metrics.ts`, test.
**Done when:** given an agent's runs, computes invocation count, total/average duration, aggregated tool usage (from `toolStats`/`totalToolUseCount`), total tokens, and last-used timestamp; incomplete runs are counted but excluded from summary totals (or flagged); tests cover multi-run aggregation and an incomplete run.
**Depends on:** 5
**Estimate:** 2
**Notes:** Tokens only — no derived dollar cost (Req 11). Pure function over `Run[]`.
**Done:** [ ]

### Task 9: CLI `list` command

**What:** A thin `handler list` that ingests then lists the user's agents.
**Files:** `src/cli/commands/list.ts`, wiring in `src/cli/index.ts`, test.
**Done when:** `handler list` runs ingestion then prints one line per distinct agent identity (name, source, run count); an integration test drives the CLI over a fixture and asserts output; the command holds no logic beyond calling core.
**Depends on:** 7
**Estimate:** 2
**Notes:** Follows the F1 `source` command pattern (`CliContext`, injectable store/projects paths via options/env). Reuse the `run`/`CliContext` seam in `src/cli/index.ts`.
**Done:** [ ]

### Task 10: CLI `show <agent>` command

**What:** A thin `handler show <agent>` that ingests then prints one agent's run history + metrics.
**Files:** `src/cli/commands/show.ts`, wiring in `src/cli/index.ts`, test.
**Done when:** `handler show <name>` prints per-run history and the aggregated metrics from Task 8 (count, duration, tool usage, tokens, last-used), tagging incomplete/orphan runs; an unknown agent prints a clear "no runs" message; an integration test asserts output over a fixture.
**Depends on:** 7, 8
**Estimate:** 2
**Notes:** Resolve which agent by name; if a name is ambiguous across sources, list the matches. Tokens only.
**Done:** [ ]

---

## Summary

- **Total tasks:** 10
- **Total estimated effort:** 24 story points
- **Critical path:** Tasks 1 → 3 → 5 → 6 → 7 → 10 (16 points). Tasks 2 and 4 feed in off the path; Tasks 8/9 branch from 7.
- **Risks:** Task 3 carries the most uncertainty — the real `toolUseResult`/transcript shape and schema-drift tolerance (Reqs 4, 7) must be pinned against real `~/.claude` fixtures, not assumptions. Task 7 is the integration point where discovery/extraction/attribution/store meet — most likely place for wiring bugs. Task 2's projects-dir traversal and sidechain exclusion is low-logic but easy to get subtly wrong (don't ingest sub-transcripts as parent sessions).
