# Feature Spec: Real-time capture hook (V1 Feature 5)

**Source:** `docs/specs/v1/features-v1.md` Feature 5 · `docs/spec-v1.md` Reqs 37–38 · US-15
**Status:** Draft

## Overview

handler ingests subagent runs by scanning Claude Code's on-disk transcripts after the fact, which means a developer must explicitly re-run ingestion to see recent activity. This feature adds an optional `SubagentStop` hook that captures a run at the moment it completes, making new runs visible immediately. The hook is complementary to transcript parsing — it accelerates availability but never replaces it, and the system must remain fully functional when the hook is disabled.

## Goals

- A developer can opt in to real-time run capture so new runs appear in `handler` without a manual ingest step.
- A hook event and the corresponding transcript span always resolve to exactly one run record — no duplicates regardless of the order events arrive.
- Enabling or disabling the hook requires no structural change to the run store or any other part of the system.
- Transcript parsing remains the authoritative source of run content; the hook is an accelerant, not a replacement.

## Non-goals

- The hook does not replace or deprecate transcript-based ingestion; both paths must remain independently operable.
- The hook does not add new fields or metrics beyond what transcript parsing already captures; it only changes when a record becomes available.
- No GUI for hook configuration (V1 Feature 6).
- No network calls — the hook is local to the developer's machine.
- Hook installation into Claude Code's configuration is the developer's responsibility; handler does not modify Claude Code settings automatically.

## User stories

- **US-15** As an agent author, I want optional real-time run capture via a hook, so I don't have to wait for transcript parsing.

## Functional requirements

1. The system MUST provide a `SubagentStop` hook handler that, when invoked by Claude Code, captures the run event and persists it to the run store using the same attribution logic as transcript ingestion (agent identity = `(source-type, normalized-source-path, name)`; nearest-ancestor repo-source resolution; user-level fallback). [US-15] (Req 37)
2. The system MUST reconcile a hook event and its corresponding transcript span — matched by `agentId` (run id) — into a single run record; if a record for that `agentId` already exists in the store, the system MUST NOT create a duplicate regardless of which path (hook or transcript parse) wrote it first. [US-15] (Req 37)
3. When a hook event arrives before the transcript span has been ingested, the system MUST create an initial run record from the hook payload and update it in-place when the transcript span is subsequently ingested, preserving the original record's identity and not creating a second record. [US-15] (Req 37)
4. When a transcript span is ingested for a run already captured by the hook, the system MUST use the transcript span as authoritative for all run content (output, tool calls, turn detail, per-run scoring inputs), updating the existing record rather than replacing it with a new one. [US-15] (Reqs 37, 38)
5. The hook MUST be disabled by default; a developer opts in by registering it in their Claude Code hooks configuration. The system MUST NOT require the hook to be enabled for any operation — ingestion, scoring, conventions checks, trend, insights, show, and all other commands MUST function identically with the hook disabled. [US-15] (Req 38)
6. The hook handler MUST apply the same agent-identity filtering as transcript ingestion: it MUST skip runs attributed to built-in or plugin agents and MUST NOT persist records for agents not resolvable to a user-created agent definition. [US-15] (Req 37)
7. The hook handler MUST be defensive: a malformed, incomplete, or interrupted hook payload MUST be kept-and-tagged (consistent with MVP Req 7) rather than dropped, and MUST NOT cause the handler process to exit with an error that surfaces to the user's Claude Code session. [US-15] (Req 37)
8. The system MUST provide a CLI sub-command (`hook enable` / `hook disable` or equivalent) that prints the configuration fragment the developer needs to add to their Claude Code hooks file, so registration is a copy-paste action rather than requiring knowledge of the hooks schema. [US-15]
9. The hook handler MUST make no network calls; all reconciliation and store writes MUST be local. [US-15]
10. Duplicate-guard MUST be keyed on `agentId` (the run id join key established by MVP Req 2), consistent with the existing store identity `(source-type, normalized-source-path, name, agentId)`. [US-15] (Req 37)

## Open questions

None identified. Key design decisions resolved from the authoritative sources:

- Reconciliation key: `agentId` from the `toolUseResult` payload — already the unique join key in the MVP store (Req 2 / `docs/spec.md`).
- Transcript wins on content: Req 38 makes transcript parsing the source of truth; hook data is superseded by the transcript span for all scoring inputs.
- Hook-first arrival: create a partial record immediately, enrich it when the transcript span lands; no duplicate on enrichment.
- No auto-install: handler does not touch Claude Code configuration files; the `hook enable` command outputs the config fragment.

## Out of scope (deferred)

- Automatic installation or modification of Claude Code hooks configuration files.
- GUI for hook status or enable/disable (V1 Feature 6).
- A `SubagentStart` hook or any pre-run capture path (not in spec).
- Streaming or incremental ingest during a run (capture is at stop time only).
- Hook-based trigger for automatic re-scoring or conventions recheck (post-v1).
