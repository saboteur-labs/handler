# Task List: V1 Feature 3 — Tier C judged-quality signal

**Feature source:** `docs/specs/v1/feature-3-tier-c.md` · `docs/specs/v1/features-v1.md` (Feature 3)
**Requirements covered:** spec Reqs 26–30 (`docs/spec-v1.md`), US-11, US-16 (annotation/store reuse touches Req 29)
**Branch:** `feature/tier-c-judged-quality`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. Core logic in `src/core/scoring`; the CLI stays a thin formatter. Tier C is the **only** new network/LLM path in v1, so it is **strictly opt-in** and **hard-segregated**: it must never read, write, blend into, or alter the Tier A `Score` or any Tier B annotation. It is computed only on explicit request, stored as its own versioned annotation, and rendered as its own labeled section.

Key architectural facts: Tier C reuses the per-run **definition snapshot** already captured on each `Run` (description + system prompt) and the run's **output**, located from the sub-transcript (the final assistant turn / `Run.telemetry`) — the same output-extraction seam Tier B's contract check (`src/core/scoring/tier-b-contract.ts`) introduced; reuse it, do not reimplement. The network call lives behind a single narrow judge-client seam so tests stay offline (inject a fake judge) and the user supplies their own API access — no managed/hosted model config (feature non-goal). Anchors are user-labeled few-shot examples, stored separately from judge annotations.

---

### Task 1: Tier C types + rubric version constant (core)

**What:** Define the Tier C result/anchor types and the dedicated `TIER_C_VERSION` rubric constant.
**Files:** `src/core/scoring/tier-c.ts` (types + `TIER_C_VERSION`), test; export from `src/core/index.ts`.
**Done when:** `TierCResult` (signal label — pass/fail or a scored band — plus `reasoning`, `rubricVersion`, `createdAt`) and `TierCAnchor` (definition snapshot ref, run output ref, user `score`, user `reasoning`, `createdAt`) types exist; `TIER_C_VERSION` is defined independent of `RUBRIC_VERSION` and `TIER_B_VERSION`. Tests assert the type shape via a constructed fixture and the version constant value.
**Depends on:** none
**Estimate:** 1
**Notes:** Satisfies the annotation-contents requirement (Req 27 / feature Req 4). Bump `TIER_C_VERSION` independently so a rubric change adds annotations rather than rewriting (feature Req 3).
**Done:** [x]

### Task 2: Tier C annotation store (core)

**What:** A store for judged-quality annotations keyed by agent identity + run id + `TIER_C_VERSION`, behind the existing `json-store` boundary.
**Files:** `src/core/store/tier-c-store.ts`, test; export from `src/core/index.ts`; default path env var (e.g. `HANDLER_TIERC`).
**Done when:** `TierCStore` round-trips a `TierCResult` keyed by `(identityKey, runId, tierCVersion)`; a version change adds a row rather than rewriting an existing one; a wrong-version/corrupt file degrades to empty (consistent with the other stores); it never reads or writes Tier A score or Tier B annotations. Tests cover add/get, version isolation, and corrupt-file degradation.
**Depends on:** 1
**Estimate:** 2
**Notes:** Mirror `src/core/store/score-store.ts` / `tier-b-store.ts` exactly. Satisfies Reqs 27/29 versioned-annotation invariant (feature Reqs 3, 6).
**Done:** [x]

### Task 3: Anchor store (core)

**What:** A store for human-labeled anchors, versioned and keyed by agent identity + run id, distinct from the Tier C annotation store.
**Files:** `src/core/store/anchor-store.ts`, test; export from `src/core/index.ts`; default path env var (e.g. `HANDLER_ANCHORS`).
**Done when:** `AnchorStore` round-trips a `TierCAnchor` keyed by `(identityKey, runId)`; anchors are retrievable per agent independently of any judge invocation; a wrong-version/corrupt file degrades to empty. Tests cover add/get-by-agent, multiple anchors per agent, and corrupt-file degradation.
**Depends on:** 1
**Estimate:** 2
**Notes:** Separate store, not folded into Tier C annotations — satisfies feature Req 10 (anchors retrievable/auditable independently). Keyed by identity + run id so anchors survive rename/edit like the note store.
**Done:** [x]

### Task 4: Judge prompt builder (core)

**What:** Assemble the judge prompt from the run's definition snapshot, the run's output, and any existing anchors for the agent as few-shot examples.
**Files:** `src/core/scoring/tier-c-prompt.ts`, test; export from `src/core/index.ts`.
**Done when:** Given a run, its located output, and a list of anchors, the builder produces a deterministic prompt embedding the definition snapshot (description + system prompt) and the run output, with the agent's anchors rendered as few-shot examples when present and omitted cleanly when absent (the prompt is still valid with zero anchors). Tests cover the no-anchor path, the with-anchors path, and that the definition snapshot + output are included.
**Depends on:** 1
**Estimate:** 3
**Notes:** Reuse the output-extraction seam from `src/core/scoring/tier-b-contract.ts` (final assistant turn / `Run.telemetry`); do not reimplement. Satisfies Req 26 (inputs) and Req 30 (anchors as few-shot, optional) — feature Reqs 1, 9.
**Done:** [x]

### Task 5: LLM judge client seam (core)

**What:** A single narrow client that sends the prompt to the user-supplied LLM and parses the response into a `TierCResult`, with safe failure.
**Files:** `src/core/scoring/judge-client.ts`, test; export from `src/core/index.ts`.
**Done when:** A `JudgeClient` interface plus a default implementation issues the call using user-supplied API access (env/config, no managed model config), parses a well-formed response into `{ label, reasoning }`, and on any failure (network/API/timeout/malformed response) throws or returns an explicit error result **without** producing a partial `TierCResult`; the interface is injectable so all tests run offline against a fake. Tests cover successful parse, malformed-response handling, and the failure-leaves-no-result contract using a fake client.
**Depends on:** 1
**Estimate:** 3
**Notes:** This is the **only** network path in v1 — isolate it behind the interface so nothing else does I/O. Defaults to the latest Claude model per project guidance. Satisfies Req 26 and feature Req 12 (no partial state on failure).
**Done:** [x]

### Task 6: Tier C orchestrator (core)

**What:** Compose prompt-build + judge-call + persist into an opt-in `judgeRun` that yields and stores a `TierCResult`, fully segregated from Tier A/B.
**Files:** `src/core/scoring/tier-c.ts` (extend Task 1's module), test; export from `src/core/index.ts`.
**Done when:** `judgeRun(run, anchors, judgeClient, store)` builds the prompt (Task 4), calls the judge (Task 5), persists the result via `TierCStore` (Task 2) keyed by `TIER_C_VERSION`, and returns it; it never executes unless explicitly called (no automatic trigger anywhere in ingestion/scoring); on judge failure it persists nothing and surfaces the error; it never reads or writes Tier A `Score` or Tier B annotations. Tests cover the success+persist path, the failure→no-persist path, the with/without-anchors paths, and non-interference with Tier A/B (using a fake judge).
**Depends on:** 2, 3, 4, 5
**Estimate:** 3
**Notes:** Pure orchestration over the seams above. Satisfies Reqs 26–29 (compute, opt-in execution discipline, versioned persist, no-blend) and feature Reqs 1, 2, 6, 12.
**Done:** [x]

### Task 7: Anchor-creation command (CLI)

**What:** A user-initiated command to label a past run with a score and reasoning, creating an anchor.
**Files:** `src/cli/commands/anchor.ts` (or `judge anchor` subcommand), `src/cli/index.ts` wiring, test.
**Done when:** `handler anchor <agent> <runId> --score <s> --reasoning <text>` (final shape TBD) captures the run's stored definition snapshot, the run output, the user-supplied score, and the user-supplied reasoning, and persists a `TierCAnchor` via `AnchorStore`; it errors clearly on an unknown agent/run; anchors are created **only** by this explicit command — never automatically. Tests drive successful creation and the unknown-run error through the CLI.
**Depends on:** 3
**Estimate:** 2
**Notes:** Wire `AnchorStore` + run lookup from `CliContext`. CLI holds no logic — captures inputs and calls core. Satisfies Reqs 30 (user-initiated anchors) — feature Reqs 7, 8.
**Done:** [x]

### Task 8: Opt-in judge invocation with pre-flight warning (CLI)

**What:** The explicit, opt-in entry point that warns before transmitting data, allows abort, then runs the judge.
**Files:** `src/cli/commands/judge.ts` (or `show --judge` flag), `src/cli/index.ts` wiring, `src/cli/format.ts`, test.
**Done when:** Invoking the judge (e.g. `handler judge <agent> <runId>` or `handler show <agent> --judge`) first prints a clear, labeled warning that the run output and definition content will be transmitted to an external model and requires confirmation (with a non-interactive `--yes`/`--confirm` escape); declining aborts with no network call and no state change; confirming calls `judgeRun` and reports the result; a judge failure is reported without altering existing annotations or scores. Tests drive the abort path (no judge call), the confirm path (judge called via fake), and the failure path.
**Depends on:** 6
**Estimate:** 3
**Notes:** Inject the `JudgeClient` from `CliContext` so the test uses a fake (no network). Satisfies Req 28 (opt-in + warning + abort) and feature Reqs 2, 11, 12.
**Done:** [x]

### Task 9: Tier C display section in `show` (CLI)

**What:** Render a distinct, labeled Tier C section — segregated from Tier A/B — wherever stored judged-quality annotations are surfaced.
**Files:** `src/cli/commands/show.ts`, `src/cli/format.ts`, test.
**Done when:** `handler show <agent>` prints, in a clearly labeled "Tier C (judged quality)" section separate from the Tier A/B output, each run's stored signal label and reasoning when a Tier C annotation exists; runs with no annotation render the deterministic sections unchanged and simply omit Tier C; the command holds no Tier C compute logic (reads `TierCStore` and formats only). Tests drive the with-annotation and no-annotation render paths through the CLI.
**Depends on:** 2
**Estimate:** 2
**Notes:** Wire `TierCStore` from `CliContext`, mirroring how `show` wires `ScoreStore`/`TierBStore`. Display only — never triggers a judge call (that stays Task 8's opt-in path). Satisfies Req 27 (segregated, labeled display; deterministic sections intact) — feature Reqs 4, 5, 6.
**Done:** [x]

### Task 10: End-to-end integration test

**What:** A test exercising the full opt-in pipeline from a fixture run through anchor creation, judging, and display — with a fake judge.
**Files:** `src/cli/commands/judge.integration.test.ts` (or extend the show integration test), reusing existing transcript fixtures.
**Done when:** With an injected fake judge: creating an anchor on a past run persists it; invoking the judge after confirmation produces and persists a Tier C annotation that includes the anchor as a few-shot input; `show` renders the Tier C section segregated from Tier A/B; aborting the pre-flight makes no call and writes nothing; a forced judge failure leaves no annotation and does not alter Tier A/B; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
**Depends on:** 7, 8, 9
**Estimate:** 2
**Notes:** Reuse existing ingestion transcript fixtures so the definition snapshot and run output are realistic. No real network call — the fake judge is the seam. Guards the hard invariants: opt-in, never-blend, no-partial-state.
**Done:** [x]

---

## Summary

- **Total tasks:** 10
- **Total estimated effort:** 23 points
- **Critical path:** Tasks 1 → 4 → 5 → 6 → 8 → 10 (Tasks 2, 3 stores and Tasks 7, 9 CLI branch off and rejoin at the integration test).
- **Risks:**
  - Task 5 (judge client) — the only network path; isolate behind an injectable seam so everything else stays offline and testable, and pin the "failure leaves no partial state" contract with explicit tests.
  - Task 8 (opt-in + warning/abort) — the trust boundary; the warning must fire and abort must make zero network calls before any data leaves the machine (Req 28).
  - Tasks 6/9 — guard the hard invariant that Tier C never reads, writes, or blends into the Tier A composite/band or Tier B annotations (separate store, separate display section).
