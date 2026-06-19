# Task List: V1 Feature 5 — Real-time capture hook

**Feature source:** `docs/specs/v1/feature-5-realtime-hook.md` · `docs/specs/v1/features-v1.md` (Feature 5)
**Requirements covered:** spec Reqs 37–38 (`docs/spec-v1.md`), US-15
**Branch:** `feature/subagentstop-hook`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. All hook handling and reconciliation logic in `src/core/hook/`; CLI command stays a thin formatter. No net calls at any point. Transcript parsing remains the authoritative source of run content; the hook is an accelerant only.

The run store (`src/core/store/run-store.ts`) already deduplicates by `(identityKey, runId)` via `isSameRun`. The hook's reconciliation requirement (Reqs 37, 10) adds a second operation the store does not yet support: **update-in-place** — enriching an existing record rather than ignoring it. Attribution, identity resolution, denylist filtering, and `assembleRun` from `src/core/run.ts` are all reusable; the hook handler will call them directly.

---

### Task 1: Run-store upsert (core)

**What:** Extend `RunStore` with an `upsert(run: Run): void` method that creates the record if absent or merges transcript-authoritative fields into the existing record when a hook-written stub is already present; dedup-add of a transcript record that is identical or fuller than what was stored must never create a second record.
**Files:** `src/core/store/run-store.ts`, `src/core/store/run-store.test.ts`
**Done when:** `upsert` for an unseen `(identityKey, runId)` adds the record (equivalent to `add`); `upsert` for a run already in the store replaces it in-place (same position, no duplicate); a subsequent `list()` returns exactly one record with the updated fields; `add` continues to be a no-op for an already-present record; schema version `RUN_STORE_VERSION` is bumped to reflect the stored shape is semantically compatible with upsert semantics (even if the shape is unchanged — document the version as the reconciliation-capability baseline). Tests cover: add-then-upsert (in-place replacement, no duplicate), upsert-then-upsert (idempotent), add on unseen run, and round-trip through `persist`/re-read.
**Depends on:** none
**Estimate:** 3
**Notes:** The upsert is the mechanism that makes hook-first → transcript-enrichment work (Req 3, Req 4) without a duplicate. Keep `add` unchanged for all existing callers — do not modify the existing dedup-no-op behavior. The in-place replacement must preserve array order (transcript enrichment should not reorder runs). Bump `RUN_STORE_VERSION` from 3 to 4.

---

### Task 2: Hook payload parser (core) ✓ COMPLETE

**What:** A pure function `parseHookPayload(raw: unknown): HookPayload | null` that defensively parses the JSON object Claude Code passes to a `SubagentStop` hook and returns a typed value or `null` for any malformed/missing input — never throws.
**Files:** `src/core/hook/payload.ts`, `src/core/hook/payload.test.ts`; export from `src/core/index.ts`.
**Done when:** `parseHookPayload` returns `null` for `undefined`, `null`, non-object, and objects missing required fields; returns a typed `HookPayload` (at minimum: `agentId`, `agentType`, `cwd`, `sessionId`, `status`, `totalDurationMs`, `totalTokens`, `totalToolUseCount`, `toolStats`) when all required fields are present with the correct types; optional fields (`timestamp`, partial `toolStats`) are tolerated and defaulted; a `HookPayload` is structurally equivalent to a `RawRun` so `assembleRun` can accept it without a separate conversion step. Tests cover: valid full payload, valid minimal payload (optional fields absent), each required field missing/wrong-type, and a completely malformed input.
**Depends on:** none
**Estimate:** 2
**Notes:** Check the Claude Code SubagentStop hook schema against the `RawRun` shape in `src/core/transcripts/extract.ts` — the fields should align closely; reuse or extend the `RawRun` type rather than defining a parallel one. Guard every field access; the hook payload is untrusted external input (Req 7). The `HookPayload` must map cleanly to the existing `assembleRun` signature so attribution, denylist filtering, and snapshotting reuse without modification.

---

### Task 3: Hook handler (core)

**What:** A function `handleSubagentStop(payload: unknown, sources: readonly AgentSource[], store: RunStore): 'captured' | 'skipped' | 'malformed'` that parses the payload, applies agent-identity filtering (denylist + source resolution), assembles a `Run` with `assembleRun`, and upserts it into the store — never throwing.
**Files:** `src/core/hook/handler.ts`, `src/core/hook/handler.test.ts`; export from `src/core/index.ts`.
**Done when:** Returns `'malformed'` for any payload `parseHookPayload` rejects — does not write to the store; returns `'skipped'` when the agent is a builtin/plugin (denylist) or cannot be resolved to any registered source — does not write to the store; returns `'captured'` and calls `store.upsert(run)` for a valid, attributable payload; a second call with the same `agentId` is an upsert (the existing record is updated in-place, not duplicated); a kept-and-tagged run (orphan, incomplete) is treated as `'captured'` — never dropped (Req 7); the handler makes no network calls (Req 9). Tests cover: full happy-path capture, builtin-agent skip, unresolvable-source skip, malformed payload, orphan (definition missing) kept-and-tagged capture, and idempotent double-call.
**Depends on:** 1, 2
**Estimate:** 3
**Notes:** `assembleRun` already handles builtin filtering and orphan/incomplete tagging — call it directly rather than re-implementing those rules. The return value is for CLI reporting (the hook binary will print it) and for tests; it does not affect store behavior. The `sidechainPath` derived from a hook payload will point to a file Claude Code may not have written yet — `readRunTelemetry` inside `assembleRun` already tolerates a missing sidechain (`existsSync` guard), so no special case is needed here.

---

### Task 4: Hook binary entrypoint (CLI) ✓ COMPLETE

**What:** A thin Node.js executable (`src/cli/hook-handler.ts`) that reads a JSON payload from `stdin`, calls `handleSubagentStop`, and exits 0 regardless of outcome — so a malformed or skipped run never surfaces an error to Claude Code (Req 7).
**Files:** `src/cli/hook-handler.ts`; register as a second bin in `package.json` (e.g. `handler-hook`); update `tsdown` build config to bundle it alongside the main CLI.
**Done when:** `handler-hook` accepts JSON on stdin, calls `handleSubagentStop` with `CliContext` sources and `RunStore`, logs a single line to stderr describing the outcome (`captured`, `skipped`, or `malformed` + the `agentId` when parseable), exits 0 in all cases including parse errors and thrown exceptions; the binary is produced by `npm run build` with its shebang intact; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 3
**Estimate:** 3
**Notes:** Wrap the entire stdin-read → handler call in a top-level `try/catch` that exits 0 — the invariant is "never crash Claude Code" (Req 7). Reading `CliContext` (`SourceRegistry`, `RunStore`) reuses the same initialization path as `handler ingest`; extract that initialization into a shared helper if it isn't already. Do not print to stdout; Claude Code may capture it. The binary name (`handler-hook`) is what goes into the config fragment printed by `hook enable` (Task 5).

---

### Task 5: `hook enable` / `hook disable` CLI command (CLI) ✓ COMPLETE

**What:** Register `handler hook enable` and `handler hook disable` subcommands that print the configuration fragment the developer must add to (or remove from) their Claude Code hooks file, so registration is a copy-paste action (Req 8).
**Files:** `src/cli/commands/hook.ts`, `src/cli/commands/hook.test.ts`; register in `src/cli/index.ts`.
**Done when:** `handler hook enable` prints a ready-to-paste Claude Code hooks configuration block (JSON or YAML matching Claude Code's hooks schema) that registers `handler-hook` as the `SubagentStop` hook handler, with a clear copy-paste instruction in the surrounding prose; `handler hook disable` prints the inverse instruction (what to remove); both commands hold no business logic — they only format and print static text; neither command reads from or writes to any store; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 4
**Estimate:** 2
**Notes:** The configuration fragment must reference the `handler-hook` binary by its exact installed name. Confirm the Claude Code hooks file location and schema (`.claude/settings.json` `hooks` key, or the user-level equivalent) from `docs/` or empirical data before writing the fragment — do not invent it. The command itself does not modify Claude Code's configuration (Req 5 / Non-goals). If the exact hooks schema is unclear, leave a `TODO` comment and note it as a known gap in the task done-check rather than printing a wrong fragment.

---

### Task 6: Transcript-wins enrichment path (core + integration) ✓ COMPLETE

**What:** Extend `handleSubagentStop` (or add a sibling `enrichFromTranscript`) so that when transcript ingestion runs after a hook-written stub, the transcript span's content (telemetry, tool calls, per-run scoring inputs) replaces the hook stub's fields via `store.upsert` — transcript wins on content (Req 4).
**Files:** `src/core/ingest.ts` (extend the existing ingest path to call `upsert` instead of `add` when a record already exists); `src/core/ingest.test.ts`; `src/core/hook/handler.test.ts` (cross-path integration assertions).
**Done when:** Running `ingest` after a hook has written a stub for the same `agentId` produces exactly one run record with the transcript's `telemetry`, `toolStats`, `totalTokens`, and `totalDurationMs` values (not the hook's); running `ingest` before any hook event produces the same result as today (no regression); running the hook after `ingest` has already written a full record does not overwrite the transcript's richer fields with the hook's sparser ones (transcript wins regardless of arrival order — `upsert` must not degrade a richer record to a sparser one); `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 1, 3
**Estimate:** 5
**Notes:** This is the highest-risk task: the "transcript always wins on content" invariant (Req 4) must hold regardless of which path arrives first. The `upsert` implementation from Task 1 replaces in-place — but it must not blindly replace a transcript-rich record with a hook-sparse one. The safest model: mark hook-written records with a `source: 'hook'` tag on the stored `Run`, and have `ingest` use `upsert` unconditionally (transcript wins by always overwriting). Hook handler then only calls `upsert` when `source !== 'transcript'` on the existing record. Define and test all four arrival-order combinations: hook-then-transcript, transcript-then-hook, hook-only, transcript-only. A `source` field on `Run` is a shape change — bump `RUN_STORE_VERSION` again (to 5, or combine with Task 1's bump if tasks are implemented together).

---

### Task 7: End-to-end integration test

**What:** A test exercising the full round-trip: hook payload → `handler-hook` → store stub → `handler ingest` → transcript enrichment → `handler show`, covering both arrival orders and the "no duplicates" invariant.
**Files:** `src/cli/commands/hook.integration.test.ts`
**Done when:** Seeding a fixture project, sending a valid hook payload for an agent run, then ingesting its transcript produces one record in `handler list` with transcript-authoritative content; seeding the transcript first and then sending the hook payload produces one record with the transcript's content intact (no regression); sending a hook payload for a builtin agent produces no record; sending a malformed payload produces no record and does not throw; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 5, 6
**Estimate:** 3
**Notes:** Reuse transcript fixtures from the Feature 2 / Feature 3 integration tests. The hook binary must be invocable from the test (spawn it as a subprocess or call `handleSubagentStop` directly through the core API — prefer the latter for speed and determinism). Cover the "malformed payload exits 0" invariant by checking the process exit code in one test path.

---

## Summary

- **Total tasks:** 7
- **Total estimated effort:** 21 points
- **Critical path:** Task 1 → Task 3 → Task 6 → Task 7 (store upsert enables the handler, which enables the enrichment path, which the integration test validates). Task 2 feeds Task 3 but is independently parallelizable with Task 1. Task 4 depends on Task 3; Task 5 depends on Task 4.
- **Risks:** Task 6 — the transcript-wins invariant across all four arrival-order combinations is the highest-correctness risk; pin each combination with an explicit test before considering it done. Task 4 — the Claude Code hooks schema must be verified empirically before the config fragment is printed; an incorrect fragment silently breaks the developer's hook registration. Task 1 — the `upsert` in-place semantics (no reordering, no silent no-op on a richer record) need careful boundary tests before any caller uses them.
