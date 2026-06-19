# Feature Spec: Nested subagent capture (V1 Feature 7)

**Source:** `docs/specs/v1/features-v1.md` Feature 7 · `docs/spec-v1.md` Reqs 39–44 · US-17
**Status:** Draft

## Overview

When a user-authored agent spawns another user-authored agent, the nested run is silently dropped today. `discoverTranscripts` walks only the top-level `<sessionId>.jsonl` files inside each project directory; the `<sessionId>/subagents/` directory, where spawned agents' sidechain files (`agent-<agentId>.jsonl`) live, is structurally excluded. Nested `Task` results — carrying the same `toolUseResult` shape as top-level runs — land inside the spawning agent's own sidechain and therefore never reach extraction. This feature extends discovery to recurse into sidechain files at arbitrary depth, attributes each nested run to its own agent identity tuple (flat attribution, no roll-ups), and captures the parent's `agentId` as a lightweight lineage pointer so `show` and `trend` can display a read-only "spawned by" annotation.

## Goals

- Every run from a user-authored agent spawned by another user-authored agent appears in the roster, run history, and scores alongside top-level runs.
- Each nested run is attributed to its own agent identity tuple using the same resolution logic as top-level runs — no special-casing for depth.
- A `parentAgentId` lineage pointer is persisted on each nested run at near-zero capture cost, so call-tree lineage is reconstructable without re-ingesting history.
- `show` and `trend` display a read-only "spawned by" annotation per nested run, degrading gracefully when the parent is unknown.
- Interrupted or incomplete nested runs are kept-and-tagged, never dropped.

## Non-goals

- Lineage-aware roll-ups — cost, token, or score aggregation across a parent/child call tree — are explicitly out of scope (belong with Feature 4 / Tier B cost).
- No changes to the Tier A composite score formula or to how scores are computed per run; nested runs are scored identically to top-level runs on their own sidechain.
- No new CLI commands; this feature extends `ingest`, `show`, and `trend` in place.
- No double-counting guard for tokens or cost at the roster-level (belongs with lineage roll-ups above).

## User stories

- **US-17** As an agent author, I want runs from agents that my agents spawn to appear in my roster, history, and scores — with a read-only "spawned by" annotation — so I can evaluate my full agent call tree, not just top-level runs.

## Functional requirements

### Discovery (Req 39)

1. `discoverTranscripts` (or an equivalent discovery path invoked by `ingest`) MUST recurse into `<sessionId>/subagents/` directories at arbitrary nesting depth so that sidechain files at any level of the agent call tree are discovered. [US-17] (Req 39)
2. Discovery MUST NOT require advance knowledge of nesting depth; it MUST follow the directory structure as deep as it goes. [US-17] (Req 39)

### Attribution (Req 40)

3. Each nested run MUST be attributed to its own agent identity tuple `(source-type, normalized-source-path, name)` using the same resolution logic as top-level runs: the registered repo-source whose path is the nearest ancestor of the run's `cwd` wins; failing that, fall back to the user-level source. [US-17] (Req 40)
4. A nested run's score, tokens, cost, and all other per-run data MUST NOT be rolled up into or merged with its parent run's record. Each run is an independent attribution unit. [US-17] (Req 40)

### Lineage pointer (Req 41)

5. The system MUST extract the `parentAgentId` from the containing sidechain filename (`agent-<parentAgentId>.jsonl`) and persist it as an optional field on the run record. [US-17] (Req 41)
6. A run-store schema version bump MUST accompany the addition of the `parentAgentId` field; existing records without this field MUST be treated as having `parentAgentId: undefined` (no migration required). [US-17] (Req 41)
7. Top-level runs (discovered from parent-session transcripts, not sidechain files) MUST have `parentAgentId` absent or `undefined`. [US-17] (Req 41)

### Deduplication (Req 42)

8. The ingestion pipeline MUST guard against producing duplicate run records: if a run with a given `agentId` has already been ingested, a subsequent encounter of the same `agentId` (e.g. via an overlapping traversal path or a future change to the top-level walk) MUST be skipped, not written again. [US-17] (Req 42)

### Resilience for incomplete runs (Req 43)

9. Interrupted or incomplete nested runs — where the sidechain file exists but the `toolUseResult` summary is absent or malformed — MUST be kept-and-tagged rather than dropped, consistent with MVP Req 6 and the parse-defensively invariant (MVP Req 7). [US-17] (Req 43)

### "Spawned by" annotation in show and trend (Req 44)

10. The `show` command MUST display a read-only "spawned by `<agent>`" annotation for each run that has a `parentAgentId`, resolving the pointer to the parent run's identity tuple when the parent has been ingested. [US-17] (Req 44)
11. The `trend` command MUST include the "spawned by" annotation when rendering individual run entries that carry a `parentAgentId`. [US-17] (Req 44)
12. When the parent run referenced by `parentAgentId` has not been ingested, or its definition is absent, the annotation MUST degrade gracefully — displaying the raw parent agent name or `agentId` — and MUST NOT cause the `show` or `trend` command to fail. [US-17] (Req 44)

## Open questions

None identified. The flat-attribution + captured-lineage-pointer design was resolved on 2026-06-18 (see `docs/specs/v1/features-v1.md` Feature 7 design decision). All remaining implementation details — deduplication guard, schema version bump, graceful degradation for the "spawned by" annotation, and keep-and-tag for incomplete nested runs — are specified above without ambiguity.

## Out of scope (deferred)

- Lineage-aware roll-ups: cost, token count, or score aggregated across a parent/child agent call tree (belongs with V1 Feature 4 roster insights and Tier B cost signals once the full tree is capturable).
- A dedicated `tree` or `lineage` CLI view showing the full call-tree structure (v2).
- Cross-agent double-counting detection at the roster level when the same tokens appear in both a parent and a nested run's raw record (deferred with roll-ups).
- Automatic re-ingestion of history to backfill `parentAgentId` on pre-existing nested runs that were previously dropped (post-v1).
