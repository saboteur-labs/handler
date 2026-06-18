# Feature Spec: Deterministic behavioral scoring

**Feature source:** `docs/features.md` (Feature 3)
**Requirements covered:** spec Reqs 12, 13, 14, 15 (`docs/spec.md`)
**User stories:** US-6
**Depends on:** Feature 2 (per-run records, snapshotted definitions, transcript parsing)

## Overview

Feature 2 makes runs visible but says nothing about whether a run behaved. This feature computes a per-run **deterministic** behavioral score — Tier A checks plus tool-utilization — telling the author whether a run stayed in its tool lane, respected file/path boundaries, avoided thrash and errors, and completed. It is reproducible and fully explainable, with no LLM-judge and nothing leaving the machine, turning "did this run do its job?" into a defensible, inspectable answer.

## Goals

- Every completed run carries a reproducible behavioral assessment derived only from local data.
- The author can see, per run, which specific checks passed or failed and why.
- Identically-behaving runs always produce identical results for a given rubric version.
- Granted-but-unused tools are surfaced so the author can tighten an agent's scope.
- Re-scoring after a rubric change never rewrites prior runs' history.

## Non-goals

- No LLM-judge / interpretive "judged quality" (Tier C, deferred v1).
- No reference-relative scoring vs. the agent's own history (Tier B, deferred v1).
- No remediation, agent-editing, or suggestions — scoring only.
- No network calls of any kind.

## User stories

- As an agent author, I want a deterministic behavioral score per run, so I can tell whether a run stayed in lane, used its tools, and completed.

## Functional requirements

1. The system MUST compute a per-run score from Tier A checks plus tool-utilization, using no LLM-judge and transmitting no definitions, code, or transcripts off the machine. [12][13][14]
2. The score MUST derive from the run's per-run sub-transcript (turn-level tool calls and denials) and the snapshotted definition.
3. The result MUST include three layers: a per-check breakdown (each check's pass/fail and detail), an overall `pass`/`warn`/`fail` band, and a 0–100 composite computed from fixed, documented weights (so the number is deterministic and reproducible, not tuned per run).
4. **Tool-scope adherence:** the system MUST flag any tool the run invoked that the agent's declared `tools` scope does not grant. [12]
5. **Permission denials:** the system MUST count permission-denial events in the run. [12]
6. **Terminal status:** the system MUST record whether the run reached a successful terminal status. [12]
7. **Tool errors & thrash:** the system MUST count tool-error events and thrash events — ≥3 occurrences of the same `(tool, normalized-args)` in one run (args JSON-canonicalized key-sorted/whitespace-stripped; `Bash` by trimmed command) — reporting distinct thrash events. [12]
8. **Boundary checks:** the system MUST flag any write/edit or destructive `Bash` whose resolved target falls outside the run's `cwd` subtree; reads are not checked. [12]
9. **Tool-utilization:** the system MUST report granted-but-unused tools. [13]
10. **Undeclared scope:** when no `tools` scope is declared, the system MUST mark tool-scope adherence and utilization not-applicable, fall back to boundary checks, and surface "undeclared scope". [15]
11. Feature 2's stored run MUST record a sub-transcript locator (`sessionId` and/or sidechain path); scoring reads the per-run sub-transcript on demand from that locator.
12. Scores MUST be computed lazily during `show`/ingest and persisted as versioned annotations keyed by `(runId, rubric-version)`, recomputed only when the rubric version changes — a rubric change adds rather than overwrites.
13. The system MUST surface the score (band, composite, and breakdown) in `handler show`.

## Open questions

None identified. Resolved during specification:

- **Score representation** → per-check breakdown + `pass`/`warn`/`fail` band + 0–100 composite from fixed documented weights (Req 3).
- **Sub-transcript access** → Feature 2 records a locator; Feature 3 re-discovers and reads the sidechain on demand (Req 11).
- **Trigger** → lazy during `show`/ingest, cached as versioned annotations (Req 12).

## Out of scope (deferred)

- Tier B (reference-relative) and Tier C (LLM-judged) scoring.
- Roster-level cross-agent score insights and trends.
- Any score-driven remediation or definition edits.
- Rubric-weight tuning tooling — weights are fixed and documented for the MVP.
