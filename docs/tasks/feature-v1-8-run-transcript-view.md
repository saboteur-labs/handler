# Task List: V1 Feature 8 — Run Transcript View

**Feature source:** `docs/specs/v1/feature-8-run-transcript-view.md` · `docs/spec-v1.md` Reqs 45–53
**Requirements covered:** spec-v1 Reqs 45–53, US-18
**Branch:** `feature/run-transcript-view`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. Tests must map to the requirement(s) they cover. All transcript-parsing logic lives in `src/core/`; `src/cli/` and `gui/` are thin renderers with no logic of their own.

The existing parsers (`readTelemetry` in `src/core/transcripts/telemetry.ts` and `readActivity` in `src/core/scoring/activity.ts`) already walk the same sidechain JSONL this feature reads. Both establish the parse-defensively idiom and confirm the entry shapes: assistant entries carry `message.content` with `tool_use` blocks (`id`, `name`, `input`); user entries carry `tool_result` blocks (`tool_use_id`, `is_error`, `content`). The new `readTranscript` function walks the same file and produces the structured `RunTranscript` model; it does not replace or call the existing parsers.

The CLI command pattern follows `src/cli/commands/show.ts` and `src/cli/commands/trend.ts`: thin command registration that calls core, then formats output with chalk. The GUI extension adds one new API endpoint to `src/core/gui/server.ts`, one new core function in `src/core/gui/`, a browser-side API call in `gui/src/api/client.ts`, and a panel component in the existing `AgentDetailPage`.

---

### Task 1: `RunTranscript` model and `readTranscript` core function

**What:** A new `src/core/transcripts/transcript.ts` module exporting the `RunTranscript` model and a `readTranscript(sidechainPath, options?)` function that parses the sidechain JSONL into a structured, renderable transcript with tool-result truncation.
**Files:** `src/core/transcripts/transcript.ts`, `src/core/transcripts/transcript.test.ts`; export from `src/core/index.ts`.
**Done when:**

- `RunTranscript` interface is exported with: `taskPrompt: string | undefined`; `turns: readonly TranscriptTurn[]`; `stopReason: StopReason | undefined` (reuse the existing `StopReason` type from `telemetry.ts`).
- `TranscriptTurn` is exported with: `textBlocks: readonly string[]` (assistant prose); `toolCalls: readonly TranscriptToolCall[]`.
- `TranscriptToolCall` is exported with: `id: string`; `name: string`; `input: Record<string, unknown>`; `result: TranscriptToolResult | undefined`.
- `TranscriptToolResult` is exported with: `toolUseId: string`; `isError: boolean`; `content: string`; `truncated: boolean`.
- `ReadTranscriptOptions` is exported with `truncateBytes?: number` (default 2048) and `full?: boolean` (when `true`, disables truncation regardless of `truncateBytes`).
- `readTranscript(sidechainPath: string, options?: ReadTranscriptOptions): RunTranscript` is exported.
- `taskPrompt` is the non-`tool_result` text from the first `user` entry's content; absent when no such entry exists or the content is empty.
- Turns are in order; each turn collects the assistant `text` blocks (concatenated) and `tool_use` blocks; the corresponding `tool_result` blocks from the immediately following `user` entry are attached to each call by `tool_use_id`.
- Tool-result content is truncated to `truncateBytes` (default 2048) bytes with `truncated: true` when the payload exceeds the limit; when `full: true` or `truncateBytes` is `Infinity`, no truncation occurs and `truncated` is `false`.
- When the sidechain is missing, empty, or malformed, `readTranscript` returns `{ taskPrompt: undefined, turns: [], stopReason: undefined }` and does NOT throw.
- No rendering or ANSI logic is present in this module.
- Tests cover: empty file (empty transcript returned); missing file (empty transcript, no throw); a file with a task prompt but no turns; a file with multiple assistant turns and interleaved tool calls and results; a tool result whose content exceeds 2048 bytes (default truncation, `truncated: true`); the same file called with `full: true` (no truncation, `truncated: false`); a tool result with no matching tool call in the prior assistant turn (result is not attached, no crash); a file where the first `user` entry has only `tool_result` blocks (no `taskPrompt`); `stopReason` extracted correctly from the final `end_turn`/`max_tokens` stop reason.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** none
**Estimate:** 5
**Notes:** Mirror the `readJsonl` + `contentBlocks` idiom from `telemetry.ts` and `activity.ts` — do not import those modules; copy the defensive helpers locally or refactor into a shared utility only if that utility already exists. The pairing of `tool_use` to `tool_result` blocks must be done by `tool_use_id` / `id` matching across the assistant→user entry boundary; a tool call whose result is in a later user entry (e.g. a multi-turn call) may be left with `result: undefined` without error — do not over-engineer. The `StopReason` type is already exported from `src/core/transcripts/telemetry.ts` — import and re-export rather than redefining. Covers Reqs 45, 46, 47.

---

### Task 2: CLI `handler transcript` command

**What:** Register a `handler transcript <agent> <runId>` CLI command in `src/cli/commands/transcript.ts` that locates the run, resolves `run.sidechainPath`, calls `readTranscript`, and renders the sectioned output to stdout.
**Files:** `src/cli/commands/transcript.ts`, `src/cli/commands/transcript.test.ts`; register in `src/cli/index.ts`.
**Done when:**

- `handler transcript <agent> <runId>` resolves the named agent and exact run id from the ingested run store, then renders a transcript to stdout.
- `handler transcript <agent> --latest` resolves the most-recent run of the named agent (by `run.timestamp`, falling back to store insertion order when timestamps are absent) without requiring the caller to supply a run id.
- `handler transcript <agent> <runId> --full` calls `readTranscript` with `full: true`, disabling all tool-output truncation.
- Rendered output has four clearly distinguished sections (using chalk heading / divider lines consistent with `show.ts` style):
  - (a) Header: agent name, run id, timestamp (formatted), status.
  - (b) Task prompt (labelled "Task prompt").
  - (c) Each turn in order: assistant text blocks rendered as prose; each tool call rendered with name and input (pretty-printed JSON, indented); the tool result rendered inline below the call, with a `[truncated]` indicator appended when `result.truncated` is `true` and `--full` was not passed; `[error]` prefix when `result.isError` is `true`.
  - (d) Footer: stop reason (or "unknown" when `undefined`).
- When `run.sidechainPath` is `undefined` or the run is tagged `incomplete` or `orphan`, the command prints an informative message (`No transcript available for this run (status: <tag>).`) and exits non-zero (code 1) without rendering a partial transcript.
- When the named agent cannot be found, the command prints `No runs found for agent "<name>".` and exits non-zero.
- When the named agent is ambiguous across multiple sources, the command prints the same disambiguation listing as `show`.
- When `--latest` is passed with a `<runId>` positional, the command ignores the positional and uses the latest run (or could be designed to require one or the other — pick a clean UX and document it in a comment).
- The command holds no parsing logic — it only calls `readTranscript` and formats the returned model.
- Tests cover: agent not found (non-zero exit, error message); agent found, run found, sidechain available (full render, correct sections); agent found, run found, sidechain unavailable (`incomplete` tag — non-zero exit, informative message); agent found, run found, sidechain unavailable (`orphan` tag — same); `--latest` selects the most-recent run; `--full` passes `full: true` to `readTranscript`; tool result with `truncated: true` renders `[truncated]` marker; tool result with `isError: true` renders `[error]` prefix; ambiguous agent name (disambiguation message, no crash).
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 1
**Estimate:** 5
**Notes:** The ingest → `summarizeAgents` → name-match pattern from `show.ts` is the right template for finding the agent and its runs. Run id lookup: filter `agentRuns` (the runs for the matched agent) by `run.runId === runId`. For `--latest`: sort by `run.timestamp` descending (parse as `Date`, treat `undefined` as epoch 0) and take the first. The `CliContext` shape is defined in `src/cli/commands/source.ts` — use the same `ctx.out` / `ctx.err` pattern and the `process.exitCode = 1` idiom from other commands (do not call `process.exit` directly). Register the command in `src/cli/index.ts` alongside the other `register*Command` calls. Covers Reqs 48, 49, 50, 51, 52.

---

### Task 3: GUI core API — `getRunTranscript` function

**What:** Add a `getRunTranscript(runId: string, allRuns: readonly Run[]): RunTranscript | null` function to `src/core/gui/` that the server will call for the new transcript endpoint.
**Files:** `src/core/gui/transcript.ts` (new), `src/core/gui/transcript.test.ts`; export from `src/core/gui/index.ts`.
**Done when:**

- `getRunTranscript(runId: string, allRuns: readonly Run[]): RunTranscript | null` is exported.
- Locates the run by `run.runId === runId` in `allRuns`; returns `null` when not found.
- When the run's `sidechainPath` is `undefined` or the run is tagged `incomplete` or `orphan`, returns `null` rather than calling `readTranscript` (the GUI will surface this as "unavailable").
- Otherwise calls `readTranscript(run.sidechainPath)` with default truncation options and returns the result.
- Tests cover: run not found (returns `null`); run found, sidechain unavailable (tagged `incomplete` — returns `null`); run found, sidechain unavailable (tagged `orphan` — returns `null`); run found, `sidechainPath` undefined (returns `null`); run found and sidechain available (returns the `RunTranscript` from `readTranscript`).
- No rendering logic in this module.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 1
**Estimate:** 2
**Notes:** The function takes `allRuns` as a parameter (pure over inputs) so callers are not forced to read the store again — the server already has a `runs` list from `ingest`. The GUI never exposes a `--full` toggle (that is CLI-only per the spec); always use default truncation. Covers Req 53 (core side of the GUI surface).

---

### Task 4: GUI server — `GET /api/runs/:runId/transcript` endpoint

**What:** Add a `GET /api/runs/:runId/transcript` route to `src/core/gui/server.ts` that calls `getRunTranscript` and returns the serialised `RunTranscript` (or 404 when unavailable).
**Files:** `src/core/gui/server.ts` (extend), `src/core/gui/server.test.ts` (extend).
**Done when:**

- `GET /api/runs/:runId/transcript` for a known run with an available sidechain returns HTTP 200 with a JSON body that is the serialised `RunTranscript`.
- `GET /api/runs/:runId/transcript` for an unknown run id returns HTTP 404 with `{ "error": "..." }`.
- `GET /api/runs/:runId/transcript` for a run whose sidechain is unavailable (tagged or `sidechainPath` absent) returns HTTP 404 with `{ "error": "Transcript not available for this run." }`.
- `POST /api/runs/...` returns 405 (covered by the existing mutation-verb guard — verify it extends to this path).
- The server layer calls only `getRunTranscript` — it contains no parsing logic of its own.
- Existing server tests still pass unchanged.
- New tests cover: 200 with correct JSON shape; 404 for unknown run id; 404 for unavailable sidechain; 405 for mutation verbs on this route.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass.

**Depends on:** 3
**Estimate:** 2
**Notes:** The `runs` list for `getRunTranscript` comes from the `ingest(...)` call already made at the top of `handleApiRequest` — pass it through rather than re-reading. The route pattern `/api/runs/:runId/transcript` must be parsed from `pathname` with the same string-based matching used for `/api/agents/:identity` — no router library is in use. Covers Req 53 (server side of the GUI surface).

---

### Task 5: GUI browser-side API client and types for transcript

**What:** Extend `gui/src/api/client.ts` and `gui/src/api/types.ts` with a `fetchRunTranscript(runId)` function and the corresponding `RunTranscript` browser-side type, so the GUI panel can call the new endpoint with no logic of its own.
**Files:** `gui/src/api/client.ts` (extend), `gui/src/api/types.ts` (extend).
**Done when:**

- `RunTranscriptData` (or equivalent name avoiding collision with the core type) is added to `gui/src/api/types.ts` with: `taskPrompt: string | undefined`; `turns: readonly TranscriptTurnData[]`; `stopReason: string | undefined`.
- `TranscriptTurnData` includes `textBlocks: readonly string[]` and `toolCalls: readonly TranscriptToolCallData[]`.
- `TranscriptToolCallData` includes `id: string`; `name: string`; `input: Record<string, unknown>`; `result: TranscriptToolResultData | undefined`.
- `TranscriptToolResultData` includes `toolUseId: string`; `isError: boolean`; `content: string`; `truncated: boolean`.
- `fetchRunTranscript(runId: string): Promise<RunTranscriptData | null>` is exported from `gui/src/api/client.ts`; returns `null` on HTTP 404.
- Non-404 errors are thrown as-is (consistent with existing client functions).
- `npm run typecheck` inside `gui/` passes.

**Depends on:** 4
**Estimate:** 2
**Notes:** Follow the exact pattern of `fetchAgentDetail` in `gui/src/api/client.ts` — URL-encode the `runId` parameter consistently with the server route. Types are maintained manually in sync with the server-side model (same approach as `RunDetail` / `AgentDetail`); no cross-build type sharing. Covers Req 53 (browser-side API layer).

---

### Task 6: GUI transcript panel in the agent detail view

**What:** Add a `TranscriptPanel` component in `gui/src/components/TranscriptPanel.tsx` and integrate it into the existing per-run detail area in `gui/src/pages/AgentDetailPage.tsx`, rendering the transcript for each run entry via the Task 5 API client.
**Files:** `gui/src/components/TranscriptPanel.tsx` (new); `gui/src/pages/AgentDetailPage.tsx` (extend).
**Done when:**

- `TranscriptPanel` accepts a `runId: string` prop and fetches the transcript via `fetchRunTranscript(runId)` on mount.
- While loading, the panel shows a loading indicator consistent with the page's existing loading style.
- When the transcript is unavailable (404 / `null`), the panel shows "Transcript not available for this run." with the same muted styling used for absent-data indicators elsewhere in the detail view.
- When the transcript is loaded, the panel renders:
  - The task prompt (labelled "Task prompt") in a readable block.
  - Each turn in order: assistant text blocks as paragraphs; each tool call with its name and input (pretty-printed, monospace); the tool result below the call, with a "(truncated)" note when `result.truncated` is `true` and an "[error]" indicator when `result.isError` is `true`.
  - The stop reason in a footer line.
- The panel holds no parsing, filtering, or aggregation logic — it renders exactly what the API returns.
- The panel is integrated into `AgentDetailPage` within the existing per-run card (alongside `TierBSection` and `TierCSection`) as a collapsible section using a shadcn/ui `Collapsible` or `Accordion` primitive (collapsed by default — the transcript is verbose and optional to view per run).
- Styling follows the Saboteur style guide; uses shadcn/ui primitives consistently with the rest of the detail page.
- `npm run typecheck` inside `gui/` passes; `npm run build:gui` succeeds.

**Depends on:** 5
**Estimate:** 3
**Notes:** Each run card in `AgentDetailPage` already renders `TierBSection` and `TierCSection` side by side. Add the `TranscriptPanel` below those (full-width, collapsible) within the same card `<div>`. A lazy-load pattern (only `fetchRunTranscript` when the collapsible is opened) is preferred over fetching all transcripts on page load — but is not strictly required; implement what is simpler and note the trade-off in a comment. The `runId` prop maps to `run.runId` already available from the `RunDetail` type. Covers Req 53 (GUI panel deliverable).

---

### Task 7: End-to-end integration test

**What:** An integration test that runs the full transcript pipeline — `readTranscript` over a fixture sidechain, the `getRunTranscript` core function, and the `GET /api/runs/:runId/transcript` server endpoint — confirming each layer delegates correctly with no logic leaking across boundaries.
**Files:** `src/core/gui/server.integration.test.ts` (extend); fixture sidechain JSONL under `src/core/__fixtures__/transcript/` (new or reuse existing sidechain fixtures from Feature 7 if suitable).
**Done when:**

- A fixture sidechain JSONL exists with: a first `user` entry with a non-`tool_result` text block (the task prompt); at least one assistant turn with a `text` block and a `tool_use` block; a following `user` entry with a `tool_result` block whose content exceeds 2048 bytes (to exercise truncation).
- A `Run` seeded in a fixture store has `sidechainPath` pointing at the fixture file.
- `readTranscript` over the fixture returns a `RunTranscript` with the correct `taskPrompt`, one turn, one tool call, and one tool result with `truncated: true`.
- `getRunTranscript(run.runId, [run])` returns the same `RunTranscript`.
- Starting `startGuiServer` with a `CliContext` seeded with the fixture run: `GET /api/runs/<runId>/transcript` returns HTTP 200 with JSON matching the expected `RunTranscript` shape; `GET /api/runs/unknown/transcript` returns HTTP 404; `POST /api/runs/<runId>/transcript` returns HTTP 405.
- All three requirements (Req 45 — model shape, Req 46 — parse-defensively, Req 47 — truncation) are exercised at least once in this test.
- The test imports only from `src/core/index` (for `readTranscript`, `getRunTranscript`) and the server module; it does not call CLI code.
- `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.

**Depends on:** 4, 6
**Estimate:** 3
**Notes:** Prefer copying a real (sanitised) sidechain JSONL excerpt rather than hand-writing the entry shape to avoid synthetic-data divergence from production format. Reuse the `startGuiServer` + `http.request` / `fetch` pattern from the existing `src/core/gui/server.integration.test.ts`. The fixture run can be created as a plain `Run` object (typed literal, not ingested from a full transcript) since the test only needs `run.runId` and `run.sidechainPath` to be populated. Covers Reqs 45–47, 53 holistically; acts as the primary regression net for the full feature.

---

## Summary

- **Total tasks:** 7
- **Total estimated effort:** 22 points
- **Critical path:** Task 1 → Task 2 (CLI); Task 1 → Task 3 → Task 4 → Task 5 → Task 6 (GUI); Task 4 → Task 7. Minimum elapsed path is Task 1 → Task 3 → Task 4 → Task 7 (core → GUI core → server → integration).
- Tasks 2 and 3 are both unblocked once Task 1 is complete and can be worked in parallel.
- Tasks 5 and 6 form the browser chain and depend on Task 4; they are sequential.
- Task 7 depends on Task 4 (server route) and Task 6 (GUI build must succeed for `npm run build`).
- **Risks:**
  - Task 1 — the `tool_use`→`tool_result` pairing across the assistant→user entry boundary is the trickiest part of the model: a tool call in turn N may have its result in the immediately following user entry, but multi-turn tool calls (result delayed by additional assistant turns) should be handled gracefully with `result: undefined` rather than silently dropped — validate this against real fixture data before finalising the pairing logic.
  - Task 2 — the `--latest` + positional `<runId>` interaction needs a clear UX decision: either require exactly one of the two (commander's `.conflicts` option) or document that `--latest` takes precedence. Ambiguous behavior here will produce confusing test failures.
  - Task 6 — lazy-loading the transcript only when the collapsible opens avoids N parallel fetches on page load (one per run card), which would be noticeable on agents with long run histories. Implement lazy fetch; do not eagerly fetch all transcripts on mount.
