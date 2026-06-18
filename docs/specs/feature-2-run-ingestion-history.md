# Feature Spec: Run ingestion & attributed history

**Feature source:** `docs/features.md` (Feature 2)
**Requirements covered:** spec Reqs 1, 2, 6, 7, 9, 10, 11 (`docs/spec.md`)
**User stories:** US-1, US-5 (completes US-2, US-4)
**Depends on:** Feature 1 (source registry, identity tuple, `resolveAgent`, builtin denylist)

## Overview

handler reads Claude Code's existing on-disk transcripts and turns them into an attributed, queryable run history for each agent the user authored. Today there is no record of how an agent actually ran; this feature ingests every subagent run automatically — no instrumentation — attributes it deterministically to one agent identity, snapshots the definition that was in effect, and exposes the result through `list` and `show` CLI commands. It is the load-bearing slice every later feature reads from.

## Goals

- Every user-authored subagent run in the transcripts is ingested and attributed to a single agent identity, with builtins/plugins excluded.
- Each run carries a content snapshot of its definition, so history survives renames, edits, and deletions.
- Interrupted runs and runs with no findable definition are kept and tagged, never dropped.
- A developer can list their agents and view per-agent run history plus metrics (count, duration, tool usage, tokens, last-used) from the CLI.
- Ingestion degrades gracefully when Claude Code's transcript schema is absent or changed.

## Non-goals

- No behavioral scoring (Feature 3) or static definition assessment (Feature 4).
- No real-time capture / `SubagentStop` hook — transcript parsing only.
- No trend-over-time analytics or roster-level cross-agent insights (deferred v1).
- No editing of agents or transcripts.
- No derived dollar cost — tokens only (see Req 11).

## User stories

- As an agent author, I want every run ingested automatically from existing logs, so I never instrument or record runs by hand.
- As an agent author, I want runs attributed only to agents I created, so my data isn't polluted by builtins/plugins.
- As an agent author, I want history preserved across rename/edit/delete, so my timeline survives changes.
- As an agent author, I want to list my agents and see each one's run history and metrics from the CLI.

## Functional requirements

1. The system MUST discover and parse parent-session transcript JSONL under `~/.claude/projects/<encoded-project>/` without requiring instrumentation. [Req 1]
2. The system MUST attribute each run via the parent `Task` result's `toolUseResult.agentType` (name) and `agentId`, resolving name + run `cwd` to one identity using Feature 1's `resolveAgent`. [Req 2]
3. The system MUST exclude built-in/plugin agents using Feature 1's denylist. [Req 2]
4. The system MUST guard on presence of the expected `toolUseResult` schema and skip/degrade rather than throw on absent or unexpected shapes. [Req 7]
5. The system MUST keep and tag runs that have no completed summary (interrupted) and runs whose definition cannot be found (orphan), rather than dropping them. [Req 6]
6. The system MUST snapshot the definition's content (not a path reference) per run at ingest time. [Req 9]
7. Ingestion MUST be idempotent: re-ingesting the same transcripts MUST NOT duplicate runs (keyed by agent identity + run id).
8. Ingestion MUST run lazily on read: `list` and `show` MUST refresh from the transcripts on invocation, so output is current without a separate command.
9. The run store MUST persist across process restarts, append-only, keyed by agent identity + run id, reusing Feature 1's JSON file store under `~/.handler/`.
10. The system MUST provide a CLI command to list the user's agents. [Req 10]
11. The system MUST provide a CLI command to show, per agent, run history and metrics: invocation count, duration, tool usage, token total, and last-used date. Cost is reported as token totals only (no derived dollar figure). [Req 11]
12. Metrics MUST derive from the per-run `toolUseResult` summary (`totalDurationMs`, `totalTokens`, `totalToolUseCount`, `toolStats`); runs lacking a summary MUST be counted but shown as incomplete.

## Open questions

None identified. Resolved during specification:

- **Ingestion trigger** → lazy-on-read; no separate `ingest` command in the MVP (Req 8).
- **Store backend** → continue Feature 1's JSON file store under `~/.handler/`; SQLite remains the documented future direction (Req 9).
- **Cost metric** → tokens only; no static pricing table (Req 11).

## Out of scope (deferred)

- Persistent queryable store with per-agent trends (v1).
- `SubagentStop` hook for real-time capture (v1).
- Derived dollar cost via a model-pricing table (v1, alongside roster insights).
- Data-retention/pruning policy as history grows (post-MVP).
