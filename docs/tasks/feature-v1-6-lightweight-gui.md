# Task List: V1 Feature 6 — Lightweight GUI

**Feature source:** `docs/specs/v1/feature-6-lightweight-gui.md` · `docs/specs/v1/features-v1.md` (Feature 6)
**Requirements covered:** spec Reqs 35–36 (`docs/spec-v1.md`), US-14
**Branch:** `feature/lightweight-gui`
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor. All data access and aggregation logic in `src/core/`; the HTTP server is a thin transport with no business logic; the browser client (React SPA) is a pure renderer with no business logic. UI components use shadcn/ui primitives, styled with Tailwind CSS and the Saboteur style guide.

The existing `src/core/` already exposes agents, runs, scores, conventions, and notes — this feature adds a thin HTTP API surface over those existing core functions, a Vite/React/Tailwind/shadcn SPA, and the `handler gui` CLI command that wires them together.

---

### Task 1: Core API module for GUI data access

**What:** A dedicated core module (`src/core/gui/`) exporting typed functions the HTTP server will call — one function per API endpoint shape — so all data-access logic lives in core and the server holds no logic.
**Files:** `src/core/gui/agents.ts`, `src/core/gui/agent-detail.ts`, `src/core/gui/index.ts`, tests for each; export from `src/core/index.ts`.
**Done when:** `listAgents(registry, runStore)` returns an array of `{ name, sourceType, sourcePath, lastRunDate | null }` sorted by name; `getAgentDetail(identity, registry, runStore, scoreStore, noteStore, conventionsStore)` returns a structured object mirroring the data `handler show` renders — run history (each run with Tier A composite + failing checks, Tier B section or `null`, Tier C annotation or `null`), conventions check results or `null`, and the freeform note or `null`; both functions are pure over their inputs and mutate nothing; absent data (no runs, no Tier B/C, no conventions, no note) is represented as typed `null` rather than omitted keys; tests cover: roster with multiple agents from mixed sources, agent with no runs, agent with runs but no Tier B/C scores, agent with no conventions results, agent with no note, and the full happy-path with all data present. Satisfies Reqs 3, 4, 5, 6, 8, 9, 10, 11, 13.
**Depends on:** none
**Estimate:** 5
**Notes:** The Tier A composite and failing checks come from `scoreRun` / `ScoreStore`; Tier B from the reference-relative store; Tier C from the judged-quality annotation store — import those directly rather than re-implementing. Mirror the data-assembly logic in `src/cli/commands/show.ts` but keep this module's output as plain typed objects (no ANSI / CLI formatting). The `getAgentDetail` signature will be the ground truth the server serialises to JSON — nail the shape here before writing the server.

---

### Task 2: HTTP server module (thin transport) ✅ COMPLETE

**What:** A `startGuiServer(port, cliContext): Promise<{ url: string; close(): Promise<void> }>` function that starts a localhost-only HTTP server, serves the built SPA as static assets from a configurable assets directory, and exposes a read-only JSON API over the Task 1 core functions — no business logic in the server layer.
**Files:** `src/core/gui/server.ts`, `src/core/gui/server.test.ts`; export from `src/core/index.ts`.
**Done when:** `GET /api/agents` responds with the `listAgents` result serialised as JSON; `GET /api/agents/:identity` responds with the `getAgentDetail` result serialised as JSON (404 for an unknown identity); all routes are read-only (`POST`/`PUT`/`DELETE` return 405); the server binds only to `127.0.0.1` (never `0.0.0.0`); unknown routes that are not `/api/*` are served from the static assets directory (SPA fallback to `index.html`); calling `close()` shuts the server and resolves; the server layer calls only Task 1 functions — it contains no aggregation, filtering, or score logic of its own. Tests drive the API routes with mock `CliContext` values (no real stores needed): 200 responses with correct JSON shapes, 404 for unknown agent, 405 for mutation verbs, and static-asset fallback behavior. Satisfies Reqs 2, 3, 4, 5, 12.
**Depends on:** 1
**Estimate:** 3
**Notes:** Use Node's built-in `http` module or a minimal dependency (e.g. `fastify` or `hono`) consistent with the project's philosophy of minimal runtime dependencies — check `package.json` for what is already present before adding a new dependency. The static-asset directory path is passed at construction time so tests can point it at a fixture directory rather than the built SPA. The identity key format used in the URL path must round-trip cleanly; URL-encode it or use a stable slug.

---

### Task 3: SPA scaffold — Vite + React + Tailwind CSS + shadcn/ui

**What:** Scaffold a client-side React SPA under `gui/` at the repo root: Vite config, TypeScript config, Tailwind CSS setup, shadcn/ui initialisation, and a minimal root component that mounts without error — this task establishes the build tooling and style foundation only, with no feature UI.
**Files:** `gui/` directory — `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `tailwind.config.ts`, `postcss.config.js`, `components.json` (shadcn), `package.json`; update root `package.json` with a `build:gui` script that runs `vite build` inside `gui/` and outputs to `dist/gui/`.
**Done when:** `npm run build:gui` from the repo root builds the SPA to `dist/gui/` with `index.html` and bundled assets; Tailwind CSS purges and produces a stylesheet; shadcn/ui's CLI has been run at least once (the `components.json` config is present and a placeholder component such as `Button` is installed); the Saboteur style guide tokens (colours, typography, spacing) are applied via Tailwind config per the guidance at https://github.com/saboteur-works/saboteur-styles; `npm run typecheck` (or a `gui`-local equivalent) passes with no errors; the SPA renders a placeholder "handler" heading in the browser with correct font and colours from the style guide. Satisfies Reqs 5, 5a, 5b, 5c.
**Depends on:** none (parallelisable with Tasks 1 and 2)
**Estimate:** 3
**Notes:** The `gui/` directory is a self-contained workspace with its own `package.json` and `node_modules`; do not mix its dependencies with the root package. The Vite build output path must match the static-asset directory the server expects (`dist/gui/`) — confirm this against Task 2's `startGuiServer` call before merging. Read the Saboteur style guide at https://github.com/saboteur-works/saboteur-styles before setting colour/font tokens; do not invent the palette. No application routes or data-fetching in this task.

---

### Task 4: API client module (browser-side, no logic)

**What:** A typed fetch wrapper in `gui/src/api/` that calls the Task 2 JSON API endpoints and returns typed response objects — the only browser-side "logic" is URL construction and error handling; no data transformation.
**Files:** `gui/src/api/client.ts`, `gui/src/api/types.ts` (shared type definitions mirroring the Task 1 output shapes).
**Done when:** `fetchAgents()` calls `GET /api/agents` and returns a typed `AgentSummary[]`; `fetchAgentDetail(identity)` calls `GET /api/agents/:identity` and returns a typed `AgentDetail | null` (null on 404); both functions propagate network or non-2xx errors as thrown errors (callers handle them); types in `gui/src/api/types.ts` are structurally compatible with the Task 1 output types (keep them in sync manually — no cross-build type sharing in this task); `npm run typecheck` inside `gui/` passes. Satisfies Reqs 3, 5.
**Depends on:** 3
**Estimate:** 2
**Notes:** No business logic here — any temptation to filter, sort, or aggregate in the client is a signal the logic belongs in Task 1 instead. Use the browser's native `fetch`; no axios or additional HTTP clients. The `identity` parameter format must match the URL encoding chosen in Task 2.

---

### Task 5: Roster view

**What:** A roster page (`gui/src/pages/RosterPage.tsx`) that fetches the agent list via the Task 4 API client and renders it as a navigable table with agent name, source type, and last-run date.
**Files:** `gui/src/pages/RosterPage.tsx`, `gui/src/components/RosterTable.tsx`; wire as the `/` route in `gui/src/App.tsx` (add `react-router-dom` if not already present from Task 3).
**Done when:** Navigating to `/` fetches agent data and renders a table with columns: Name, Source Type, Last Run (formatted date or "never"); each row is clickable and navigates to `/agents/:identity`; while loading, a loading indicator is shown; on fetch error, an error message is shown; when the roster is empty, a "no agents found" state is shown; table and row components use shadcn/ui primitives (e.g. `Table`) wherever a suitable primitive exists; styling follows the Saboteur style guide; the page holds no data transformation — it renders what the API returns. Satisfies Reqs 6, 7, 13.
**Depends on:** 4
**Estimate:** 3
**Notes:** Sort order, pagination, filtering, and column sorting are explicitly deferred (spec non-goals) — render the roster in the order the API returns it. The clickable-row navigation to the detail view is required; no tooltip, preview, or hover state is needed beyond what shadcn/ui provides by default.

---

### Task 6: Detail view — run history and Tier A scores

**What:** A detail page (`gui/src/pages/AgentDetailPage.tsx`) that fetches agent detail via the Task 4 API client and renders the run history table with per-run Tier A composite score, band, and failing checks.
**Files:** `gui/src/pages/AgentDetailPage.tsx`, `gui/src/components/RunHistoryTable.tsx`; register `/agents/:identity` route in `gui/src/App.tsx`.
**Done when:** Navigating to `/agents/:identity` fetches the agent detail and renders: the agent name and source; a run history table with columns Run ID (or date), Duration, Tokens, Tool-use count, Tier A composite score, Band, and Failing checks; rows are ordered newest-first; while loading, a loading indicator is shown; on 404, a "agent not found" message is shown; with no runs, a "no runs ingested" message is shown; components use shadcn/ui primitives; styling follows the Saboteur style guide; no data transformation in the component. Satisfies Reqs 8, 13.
**Depends on:** 5
**Estimate:** 3
**Notes:** The run identity for display can be the run's timestamp formatted as a readable date; the raw run ID need not be exposed to the user. Failing checks should be rendered as a short list, not a raw array dump — but keep formatting trivial (e.g. a comma-separated string or a bullet list); no complex UI is required here.

---

### Task 7: Detail view — Tier B, Tier C, absent-data indicators

**What:** Extend the detail page to surface Tier B and Tier C data per run, with clear "not computed" / "insufficient history" indicators when absent.
**Files:** `gui/src/pages/AgentDetailPage.tsx` (extend), `gui/src/components/TierBSection.tsx`, `gui/src/components/TierCSection.tsx`.
**Done when:** When Tier B data is present for a run, a "Tier B" section renders the reference-relative signals; when absent, the section renders "Tier B: insufficient history" (or equivalent); when Tier C data is present for a run, a "Tier C" section renders the judged-quality annotation and reasoning; when absent, the section renders "Tier C: not computed"; both sections are visually distinct from the Tier A score row; no blank sections or zero-defaults are used for absent data; components use shadcn/ui primitives; styling follows the Saboteur style guide. Satisfies Reqs 9, 13.
**Depends on:** 6
**Estimate:** 2
**Notes:** The absent-data indicators must use the exact language from the spec ("not computed", "insufficient history") to be unambiguous; do not substitute empty strings, dashes, or zeros. Tier B and Tier C sections should be collapsible if a shadcn/ui `Accordion` or `Collapsible` primitive is available and fits naturally — but this is optional, not required.

---

### Task 8: Detail view — conventions results and note ✅ COMPLETE

**What:** Extend the detail page to surface conventions check results and the freeform note, with clear indicators when each is absent.
**Files:** `gui/src/pages/AgentDetailPage.tsx` (extend), `gui/src/components/ConventionsSection.tsx`, `gui/src/components/NoteSection.tsx`.
**Done when:** When conventions check results exist for the agent, a "Conventions" section renders each check name and pass/fail status; when absent, the section renders "No conventions check results" (or equivalent); when a note exists, a "Note" section renders the freeform note text; when no note exists, the notes section is omitted or shows "No note set"; neither section is blank or shows raw null/undefined; components use shadcn/ui primitives; styling follows the Saboteur style guide. Satisfies Reqs 10, 11, 13.
**Depends on:** 6
**Estimate:** 2
**Notes:** The conventions check results shape comes from `getAgentDetail` in Task 1 — render exactly what the API returns without re-interpreting pass/fail logic in the component. The note is freeform text; render it in a readable `<pre>` or text block, not a form input (read-only invariant).

---

### Task 9: `handler gui` CLI command

**What:** Register a `handler gui` sub-command that starts the HTTP server (Task 2) with the built SPA static assets, prints the local URL, and keeps the process alive until the user interrupts (Ctrl-C).
**Files:** `src/cli/commands/gui.ts`, `src/cli/commands/gui.test.ts`; register in `src/cli/index.ts`.
**Done when:** `handler gui` starts the server on a localhost port (default 4242, configurable via `--port`), prints a line of the form `handler GUI: http://localhost:4242`, and blocks until SIGINT/SIGTERM; on shutdown, the server closes cleanly and the process exits 0; the command resolves the built SPA directory relative to the CLI bundle's `__dirname` (pointing to `dist/gui/`); the command holds no business logic — it only calls `startGuiServer` and handles process lifecycle; `npm run lint`, `npm run typecheck`, and `npm run build` all pass. Satisfies Reqs 1, 2.
**Depends on:** 2
**Estimate:** 2
**Notes:** The command must not start if `dist/gui/` does not exist — print a clear error ("GUI assets not built — run `npm run build:gui` first") and exit non-zero. The default port (4242) should be checked for conflicts and the error message should tell the developer to use `--port` if 4242 is taken. Mirror the `CliContext` initialisation pattern from other commands (`ingest`, `show`).

---

### Task 10: Build integration — `npm run build` produces a complete distributable

**What:** Update the root build pipeline so `npm run build` (or a dedicated `npm run build:all`) builds both the CLI bundle and the SPA, placing `dist/gui/` alongside `dist/` so the installed package ships the GUI assets.
**Files:** Root `package.json` (`scripts` section), `tsdown.config.ts` or build config if relevant; update `.gitignore` and `package.json` `files` field if needed to include `dist/gui/`.
**Done when:** Running `npm run build` from the repo root produces both `dist/` (CLI + core) and `dist/gui/` (SPA assets); `handler gui` resolves the SPA directory correctly from the built CLI binary; `npm run build` is a single command with no manual steps; `npm run lint`, `npm run typecheck`, and `npm run build` all pass; the `dist/gui/` directory is included in the npm package `files` field. Satisfies Reqs 1, 2, 5a.
**Depends on:** 3, 9
**Estimate:** 2
**Notes:** The SPA build (`vite build` in `gui/`) can be invoked as a pre-step or chained command in `package.json` scripts — keep it simple; no custom build orchestration. Confirm the `__dirname`-relative path in the `handler gui` command (Task 9) resolves correctly after `npm pack` / global install, not just from the local repo.

---

### Task 11: End-to-end integration test

**What:** A test that starts the HTTP server against fixture data, calls the JSON API endpoints, and verifies the full pipeline from core data through serialised HTTP responses — confirming no business logic leaked into the server layer.
**Files:** `src/core/gui/server.integration.test.ts`
**Done when:** Starting `startGuiServer` with a `CliContext` seeded from fixture transcripts (reusing Feature 2 fixtures); `GET /api/agents` returns a correctly shaped roster with the expected agents; `GET /api/agents/:identity` for a known agent returns the full detail object with run history, Tier A scores, and `null` for absent Tier B/C/conventions/note data; `GET /api/agents/unknown` returns 404; a `POST /api/agents` returns 405; the server is closed cleanly after each test; `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass. Satisfies Reqs 3, 4, 5, 8, 9, 10, 11, 12, 13.
**Depends on:** 2, 10
**Estimate:** 3
**Notes:** Reuse the transcript fixtures and `CliContext` initialisation helpers from the Feature 2 / Feature 3 integration tests. Test the server over real HTTP (`http.request` or `fetch` to `localhost`) rather than mocking the transport — the point of this test is to verify the server layer wires core correctly with no logic leakage. No browser automation (Playwright/Cypress) is in scope for this task; browser-level testing is deferred.

---

## Summary

- **Total tasks:** 11
- **Total estimated effort:** 30 points
- **Critical path:** Task 1 → Task 2 → Task 9 → Task 10 → Task 11 (core API → server → CLI command → build integration → integration test). Task 3 is parallelisable with Tasks 1 and 2; Tasks 4–8 form the SPA chain that depends on Task 3.
- **Risks:** Task 1 — the `getAgentDetail` shape must be nailed before the server and SPA are built against it; a shape change later cascades across Tasks 2, 4, 6, 7, 8. Task 3 — integrating Tailwind CSS + shadcn/ui + the Saboteur style guide tokens requires reading the style guide before writing any config; incorrect token mapping will produce a visually wrong UI that is hard to fix incrementally. Task 10 — the `__dirname`-relative path to `dist/gui/` must be validated against both local dev and installed-package execution contexts, not just the repo root.
