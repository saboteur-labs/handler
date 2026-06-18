# Feature Spec: Richer run record & definition-change correlation

**Feature source:** design discussion (proposed Feature 6, **v1 follow-on** — beyond MVP Reqs 1–21)
**Requirements covered:** net-new v1; extends `docs/spec.md`
**User stories:** US-R1, US-R2
**Depends on:** Feature 2 (run store, transcript parsing, per-run definition snapshots), Feature 3 (supplies the behavioral composite consumed by the correlation delta)

## Overview

Handler today stores a thin run record — mostly the `toolUseResult` summary counts — and treats each run in isolation. Two deterministic, local, observe-only capabilities deepen that without any new data source. **(1) Richer run record:** extract far more per-run signal from the sub-transcript JSONL and parent `Task` result handler already ingests. **(2) Definition-change correlation:** reuse the per-run definition-content snapshots handler already stores to detect when an agent's definition changed and surface the before/after metric delta across that edit — turning "I tweaked this agent" into "here's what measurably changed."

## Goals

- Each run record carries detailed per-turn signal (tokens, latency, errors, edits, outcome) derived only from local transcripts.
- The author can see, per run, how the agent spent its turns — not just aggregate counts.
- When an agent's definition changes, the author sees that edit on the timeline and a trustworthy metric delta across it.
- All new data is deterministic and reproducible from the same transcripts.
- Nothing leaves the machine; no agent definition is modified.

## Non-goals

- No LLM-judge or interpretive quality assessment (Tier C, deferred).
- No git/code-survival or test-outcome correlation (separate follow-on feature).
- No agent editing, suggestions, or remediation.
- No network calls.
- No new scoring rubric — this feeds Feature 3, it does not redefine it.

## User stories

- US-R1: As an agent author, I want detailed per-run telemetry, so I can see where a run spent tokens/time and where it errored or thrashed.
- US-R2: As an agent author, I want a trustworthy metric impact for a definition change, so I can tell whether an edit helped.

## Functional requirements

1. The system MUST extract, per run, from the sub-transcript and parent `Task` result, using no LLM and no network: per-turn token usage (input/output/cache-read/cache-create); per-turn timestamps; tool inputs/outputs including `Bash` exit codes and error payloads; files edited; the agent's final result text; stop reason (clean / interrupted / max-tokens); model per turn; `TodoWrite` planning activity; and error→retry loops.
2. The system MUST compute a per-run latency distribution (at minimum p50 and p95 turn latency) from per-turn timestamps.
3. Parsing MUST guard on schema presence and degrade missing fields gracefully without dropping the run (consistent with Req 7 of `docs/spec.md`).
4. The system MUST detect a definition change for an agent identity by comparing stored definition-content snapshots across its attributed runs, segmenting the run history into definition-snapshot versions.
5. For each detected change the system MUST compute a before/after delta by **aggregating runs grouped by definition-snapshot version** (not a single-run pair), over: the Feature 3 behavioral composite/band as the headline; its tool-error-count and terminal-status components (labeled as composite components, not independent signals); and token total as a cost lens. The composite delta MUST compare scores computed under the **same (current) rubric version**, recomputing the older version's runs if needed. Deltas drawn from fewer than a documented minimum number of runs on either side MUST be flagged low-confidence.
6. The system MUST surface detected definition changes and their deltas both as an inline "definition changed" marker with the delta on the `handler show` run timeline, and via a dedicated `handler diff <agent>` command for edit-to-edit detail.
7. All new per-run fields MUST be persisted in the run store; the run-store schema version MUST be bumped, and ingest MUST re-parse transcripts still on disk to backfill the new fields for already-ingested runs. Runs whose transcripts are no longer on disk remain thin (fields absent), consistent with the store's degrade-not-migrate rule.

## Open questions

None identified. Resolved during specification:

- **Delta metric set** (Req 5) → behavioral composite headline + tool-error/status components + token total; cache-hit rate and p95/granted-but-unused dropped as delta metrics (noisy or static). Same-rubric-version comparison; aggregate-by-version with a low-confidence flag.
- **Surface** (Req 6) → both inline marker in `show` and a dedicated `diff` command.
- **Backfill** (Req 7) → bump schema and re-ingest to backfill from on-disk transcripts; runs without surviving transcripts stay thin.

## Out of scope (deferred)

- Git code-survival and test-outcome correlation (its own deterministic follow-on spec).
- Lifecycle-hook (`SubagentStop`/`PostToolUse`) ingestion triggers.
- LLM-judged quality (Tier C) and reference-relative scoring (Tier B).
- Cache-hit-rate and tail-latency deltas, and cross-agent roster trends.
