# Feature Spec: Lightweight GUI (V1 Feature 6)

**Source:** `docs/specs/v1/features-v1.md` Feature 6 · `docs/spec-v1.md` Reqs 35–36 · US-14
**Status:** Draft
**Style reference:** Saboteur style guidance — https://github.com/saboteur-works/saboteur-styles

## Overview

handler's CLI surfaces rich per-agent data through tabular text output, which becomes unwieldy when browsing across many agents or exploring run history over time. This feature adds a lightweight GUI that gives the developer a visual browsing surface for their roster, run history, per-run scores, conventions check results, and notes — without duplicating any logic. A `handler gui` sub-command starts a local web server that serves a browser-based UI; the server is a thin HTTP transport over `src/core/` and holds no business logic of its own.

## Goals

- A developer can visually browse their full agent roster in a browser UI launched via `handler gui`.
- A developer can navigate from the roster into a per-agent detail view (run history, scores, conventions results, and notes) in a single click.
- A developer can view per-run scores — Tier A, Tier B (when present), and Tier C (when computed) — from the browser UI.
- The GUI layer (server + browser client) holds no business logic: all data access, attribution, and evaluation remain in `src/core/`.
- The GUI ships last and composes across the full v1 feature surface (Features 1–3 for complete score content, Features 4–5 for conventions and notes).

## Non-goals

- The GUI does not compute, ingest, or score runs — it only reads what `src/core/` provides.
- No agent editing or remediation in the GUI (observe-and-evaluate only; v2).
- No export, sharing, or report generation from the GUI (v2).
- No roster-level insights view in the GUI (V1 Feature 4 is CLI-only; cross-feature GUI expansion is deferred).
- No `trend` visualization or charting beyond flat run-history browsing (deferred).
- No authentication, sync, or multi-machine support (local-first only).
- No native desktop packaging (Electron, Tauri, or similar); the browser is the window.

## User stories

- **US-14** As an agent author, I want to browse runs and scores in a GUI, so inspection is visual rather than tabular.

## Functional requirements

### Architecture and invocation (Req 35)

1. The GUI MUST be launched via a `handler gui` sub-command on the existing CLI — no separate binary or package. [US-14] (Req 35) _(OQ-GUI-2 resolved)_
2. `handler gui` MUST start a local HTTP server (bound to localhost) that serves a browser-based UI, then print the URL so the developer can open it. [US-14] (Req 35) _(OQ-GUI-1 resolved)_
3. The local server MUST act as a thin transport over `src/core/`: it routes HTTP requests to core library calls and returns serialised results. The server layer MUST contain no business logic of its own. [US-14] (Req 35)
4. Any new capability the GUI requires — data access, aggregation, filtering — MUST be implemented as a core library addition, not inside the server or browser client layers. [US-14] (Req 35)
5. The browser client MUST contain no business logic: it MUST only render data returned by the local server and issue navigation or read requests back to it. [US-14] (Req 35)
   5a. The browser client MUST be a client-side React single-page application built with Vite and styled with Tailwind CSS. The `handler gui` server MUST serve the built SPA as static assets and expose a small read-only JSON API over `src/core/`; no server-side React rendering (SSR/RSC). [US-14]
   5b. The browser client's visual design (colour, typography, spacing, component styling) MUST follow the Saboteur style guidance at https://github.com/saboteur-works/saboteur-styles. [US-14]
   5c. UI components MUST be built on shadcn/ui primitives wherever a suitable primitive exists, rather than hand-rolling equivalents; the Saboteur style guidance is applied on top of those primitives. [US-14]

### Roster and navigation (Req 36)

6. The GUI MUST display the agent roster as a navigable list or table showing at minimum each agent's name, source type, and last-run date. [US-14] (Req 36) _(OQ-GUI-4 resolved)_
7. The GUI MUST allow the developer to select a roster entry and navigate to a per-agent detail view without leaving the browser tab. [US-14] (Req 36)

### Per-agent detail view (Req 36)

8. The per-agent detail view MUST mirror what `handler show` renders: run history with per-run scores (Tier A composite and failing checks; Tier B section when data is present; Tier C annotation with reasoning when computed), conventions check results, and the freeform note when one exists. [US-14] (Req 36) _(OQ-GUI-3 resolved)_
9. When Tier B or Tier C data is absent for a run, the GUI MUST indicate this clearly (e.g. "not computed" or "insufficient history") rather than displaying a blank or defaulting to zero. [US-14] (Req 36)
10. When no conventions check results exist for an agent, the GUI MUST indicate this clearly rather than displaying a blank section. [US-14]
11. When no note exists for an agent, the GUI MUST omit the notes section or indicate "no note set" rather than displaying a blank. [US-14]

### Read-only and progressive data constraints

12. The GUI MUST be read-only: it MUST NOT alter stored runs, scores, annotations, notes, or agent definitions. [US-14]
13. The GUI MUST function with only MVP + V1 Feature 1 data present (Tier A scores and basic run history), and MUST progressively surface Tier B, Tier C, conventions, and notes content as those features are present in the store — it MUST NOT require all v1 features to be active to be usable. [US-14] (Req 36)

## Open questions

- **OQ-GUI-1: Technology stack.** RESOLVED. Local web server + browser UI. The `handler gui` command starts a lightweight local HTTP server (e.g. on a localhost port) that serves a browser-based UI; `src/core/` is reached via the server's HTTP layer. The browser client is a client-side **React SPA built with Vite** and styled with **Tailwind CSS**, with UI components built on **shadcn/ui primitives** wherever a suitable primitive exists, following the Saboteur style guidance at https://github.com/saboteur-works/saboteur-styles. The server serves the built SPA as static assets plus a small read-only JSON API over `src/core/`; no SSR/RSC. No native packaging, no desktop window. The hard invariant still holds: the server and browser client hold NO logic — all behavior lives in `src/core/`.
- **OQ-GUI-2: Invocation model.** RESOLVED. A `handler gui` sub-command on the existing CLI. No separate binary or package.
- **OQ-GUI-3: Conventions and notes in the GUI.** RESOLVED. Yes — the first cut surfaces per-agent conventions check results (MVP Feature 4) and freeform notes (MVP Feature 5), in addition to the Req 36 minimum. The detail view mirrors what `show` already renders.
- **OQ-GUI-4: Minimum viable browsing interaction.** RESOLVED. A navigable roster list or table with a per-agent detail view (roster → agent detail with run history and scores). Finer interaction details (e.g. pagination, filtering, column sorting) are a remaining non-blocking open question to be decided during implementation.

## Out of scope (deferred)

- Roster-level insights view in the GUI (V1 Feature 4 is CLI-only; cross-feature GUI expansion is v2).
- `trend` charting or score-over-time visualization (v2).
- Agent-editing, remediation suggestions, or any write path from the GUI (v2).
- Shareable or exportable reports from the GUI (v2).
- Multi-machine sync or hosted/cloud GUI mode (v2).
- Finer interaction details for the roster (pagination, filtering, column sorting) — to be decided during implementation.
