# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-implementation. The repository currently contains only design docs — there is no code, `package.json`, or test/build tooling yet. The design docs are the source of truth:

- `docs/concept.md` — the "what and why" (problem, audience, capabilities, milestones, risks).
- `docs/spec.md` — the **MVP** product spec: 21 numbered, testable functional requirements with RFC-2119 language, scoped to MVP only. v1/v2 work is explicitly in "Out of Scope (Deferred)".

Read `docs/spec.md` before implementing anything; it is the authoritative requirement set. When you scaffold the JS/TS project, replace this status section with the real build/lint/test commands (including how to run a single test).

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
- **Agent identity = `(source-type, normalized-source-path, name)`.** When a run could match multiple sources, attribute by the registered repo source whose path is the nearest ancestor of the run's `cwd`, else fall back to user-level. Snapshot the definition *content* (not a path ref) on each run so history survives renames/edits/deletions. Keep-and-tag runs whose definition can't be found; never drop them.
- **MVP scoring is deterministic, no LLM-judge.** The MVP behavioral score is Tier A checks + tool-utilization only (see `docs/spec.md` Req 12 and the Evaluation Baseline in the concept). The interpretive "judged quality" (Tier C) and reference-relative (Tier B) tiers are deferred to v1 — do not pull them into the MVP.
- **Local-only.** The MVP makes no network calls except the opt-in conventions-doc fetch; deterministic checks send no agent definitions, code, or transcripts anywhere.
- **Observe/evaluate only.** No agent-editing in the MVP (that is the v2 skill-registry vision).

## Intended technical direction (from the concept; not yet built)

- Stack is JS/TS. Structure as a **core library behind a thin CLI**, so a later GUI can consume the same API and the GUI never holds logic.
- Persist to an **append-only local store** (e.g. SQLite) keyed by agent identity + run id, with evaluations stored as **versioned annotations** so rubric changes don't rewrite history.

## Git

Active branch is `development`. The repo's history starts from the docs commit. Branch before committing on `development` only if asked; otherwise follow the user's lead on when to commit.
