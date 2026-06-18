# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

In implementation. The MVP is broken into 5 features in `docs/features.md`; per-feature task lists live in `docs/tasks/`. All five MVP features are complete (spec Reqs 1–21): agent sources & identity (Feature 1), run ingestion & attributed history (Feature 2), deterministic behavioral scoring (Feature 3), static definition assessment & conventions sync (Feature 4), and per-agent notes (Feature 5). The CLI can register sources (`source register`/`source list`), ingest runs from Claude Code's transcripts, `list`/`show` attributed agents with metrics and a per-run deterministic score (band, 0–100 composite, and the failing Tier A + tool-utilization checks), `conventions` to check each definition against the distilled Anthropic subagent conventions (checks 16a–e + undeclared-scope smell) with a staleness header, and `note set`/`note show`/`note edit` to attach a freeform note to an agent (keyed on the identity tuple so it survives rename/edit/delete; the note also renders inline in `show`). The conventions artifact is distilled offline by the `handler-sync-conventions` skill (the only network path, under `.claude/skills/`) and a skill-generated default ships inlined in the bundle, so checks work on a fresh install. The design docs remain the source of truth:

- `docs/concept.md` — the "what and why" (problem, audience, capabilities, milestones, risks).
- `docs/spec.md` — the **MVP** product spec: 21 numbered, testable functional requirements with RFC-2119 language, scoped to MVP only. v1/v2 work is explicitly in "Out of Scope (Deferred)".
- `docs/features.md` — MVP feature breakdown; `docs/tasks/feature-*.md` — per-feature task lists.

Read `docs/spec.md` before implementing anything; it is the authoritative requirement set.

### Stack & layout

TypeScript + ESM (Node ≥20). Core library in `src/core/` behind a thin CLI in `src/cli/` (the CLI holds no logic — a future GUI consumes the same core). Build: **tsdown** (Rolldown). Test: **Vitest**. Lint: **ESLint** (flat config + typescript-eslint). Format: **Prettier**. Pre-commit: **husky + lint-staged**. CLI: **Commander + chalk**.

### Commands

- `npm test` — run the full test suite (Vitest, `src/**/*.test.ts`).
- `npm run test:watch` — watch mode.
- Run a single test file: `npx vitest run src/core/index.test.ts`.
- Run tests matching a name: `npx vitest run -t "version constant"`.
- `npm run typecheck` — `tsc --noEmit` (build is bundler-driven; tsc only typechecks).
- `npm run lint` — ESLint over the repo.
- `npm run format` — Prettier write; `npm run format:check` to verify.
- `npm run build` — tsdown bundles `src/core` + `src/cli` to `dist/` (ESM `.js` + `.d.ts`; the CLI bin keeps its shebang).

## What handler is

A local-first CLI tool that logs and evaluates **user-authored** Claude Code subagents (definitions under `~/.claude/agents` and `<repo>/.claude/agents`) — and only those, never built-in or plugin agents. The MVP observes and evaluates; it does not edit agents.

## Architecture handler depends on (Claude Code's on-disk data model)

This is the load-bearing, non-obvious part — validated empirically against real `~/.claude` data, and the basis for most requirements:

- Transcripts live at `~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl` (one JSON object per line).
- Each **subagent run** is isolated to its own file: `~/.claude/projects/<encoded-project>/<sessionId>/subagents/agent-<agentId>.jsonl` (entries marked `isSidechain: true`).
- **Attribution is deterministic, no heuristics:** the parent session's `Task` result entry carries a `toolUseResult` summary with `agentType` (the agent name), `agentId` (join key to the sub-transcript file), `status`, `totalDurationMs`, `totalTokens`, `totalToolUseCount`, and `toolStats`. Most MVP metrics come straight from this object; the per-run sub-transcript supplies turn-level detail (tool calls, denials) for the deterministic scoring.
- This `toolUseResult` shape was confirmed identical across the 20 Claude Code versions present in the data, but parse defensively: guard on schema presence and tolerate runs without a completed summary (interrupted runs).
- MVP relies on transcript parsing only. A `SubagentStop` hook is a deferred v1 add, not a dependency.

## Hard invariants (do not violate)

- **User-created agents only.** Exclude built-in/plugin agents via a builtin denylist. Resolve run names against configurable sources (user-level + per-repo `.claude/agents`, derived from the run's `cwd`).
- **Agent identity = `(source-type, normalized-source-path, name)`.** When a run could match multiple sources, attribute by the registered repo source whose path is the nearest ancestor of the run's `cwd`, else fall back to user-level. Snapshot the definition _content_ (not a path ref) on each run so history survives renames/edits/deletions. Keep-and-tag runs whose definition can't be found; never drop them.
- **MVP scoring is deterministic, no LLM-judge.** The MVP behavioral score is Tier A checks + tool-utilization only (see `docs/spec.md` Req 12 and the Evaluation Baseline in the concept). The interpretive "judged quality" (Tier C) and reference-relative (Tier B) tiers are deferred to v1 — do not pull them into the MVP.
- **Local-only.** The MVP makes no network calls except the opt-in conventions-doc fetch; deterministic checks send no agent definitions, code, or transcripts anywhere.
- **Observe/evaluate only.** No agent-editing in the MVP (that is the v2 skill-registry vision).

## Development approach

**Use TDD.** Write a failing test first, then write the minimum code to make it pass, then refactor. No production code without a test driving it. Requirements in `docs/spec.md` are numbered and testable — map each test to the requirement it covers.

## Technical direction (from the concept; realized in the MVP)

- Stack is JS/TS. Structured as a **core library behind a thin CLI**, so a later GUI can consume the same API and the GUI never holds logic. This is in place: all behavior lives in `src/core/`; `src/cli/` only parses args and formats output.
- Persistence is a set of **versioned local JSON stores** under `~/.handler/` (run store, score store, note store, conventions artifact), behind a single narrow boundary (`src/core/store/json-store.ts`) so the backing implementation could later swap to SQLite without touching callers. Each store carries a schema `version` and degrades a wrong-version/corrupt file to empty rather than migrating. Scores and notes are keyed by agent identity (+ run id / rubric version), so a rubric change adds a new annotation rather than rewriting history.

## Git

Active branch is `main`. The repo's history starts from the docs commit. Branch before committing on `main` only if asked; otherwise follow the user's lead on when to commit.

Name new branches per the [Conventional Branch](https://conventionalbranch.org/) spec: `<type>/<description>`, where `type` is one of `feature`/`feat`, `bugfix`/`fix`, `hotfix`, `release`, or `chore`. Descriptions use only lowercase letters, digits, and hyphens (no underscores, no uppercase, no leading/trailing or consecutive hyphens); dots are allowed only in `release/` version numbers. Keep them short and descriptive, and include a ticket number when one applies (e.g. `feature/issue-123-attributed-history`). Trunk branches (`main`/`master`/`develop`) need no prefix.
