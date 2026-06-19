# Feature Spec: Roster-level insights (V1 Feature 4)

**Source:** `docs/specs/v1/features-v1.md` Feature 4 · `docs/spec-v1.md` Reqs 33–34 · US-13
**Status:** Draft

## Overview

handler gives a developer rich detail about any single agent, but when a roster grows beyond a few agents there is no fast way to know which ones deserve attention. This feature adds an `insights` CLI command that scans all known agents and classifies each as unused, failing, or expensive, so a developer can triage a large collection in one view rather than running `show` on each agent in turn.

## Goals

- A developer can run one command to see all agents that are unused, failing, or resource-expensive.
- Classification is derived purely from the existing run/score history — no new ingestion or store schema.
- Thin or absent history degrades to a clear low-confidence label, never a misleading flag.
- The "expensive" category uses Tier B cost-outlier data when it is available, but the command remains useful on MVP scores and Feature 1 history alone.

## Non-goals

- `insights` does not change, remediate, or recommend edits to any agent definition.
- Tier B "expensive" flags are shown only when Tier B scores are present; their absence does not block the command.
- No GUI rendering of insights (V1 Feature 6).
- No export or shareable report format (v2).
- No cross-agent roll-ups for nested-agent call trees (deferred with lineage roll-ups).

## User stories

- **US-13** As an agent author, I want a roster-level view of unused, failing, and expensive agents, so I can triage a large collection.

## Functional requirements

1. The system MUST provide a `handler insights` command that enumerates every agent known to the run store and emits a categorized summary. [US-13]
2. The system MUST classify an agent as **unused** when it has no runs within a configurable recency window (default 30 days) OR when its Tier A tool-utilization check shows granted-but-unused tools across all of its stored runs. [US-13] (Req 33)
3. The system MUST classify an agent as **failing** when it has at least one run with a Tier A failure, or when its most-recent composite score falls below a configurable threshold (default 50). [US-13] (Req 33)
4. The system MUST classify an agent as **expensive** when Tier B cost-outlier flags (Req 23) are present and the agent's runs exceed the outlier factor for tokens, duration, or turn count; when Tier B data is absent for an agent, the expensive category MUST be omitted for that agent and MUST NOT be reported as not-expensive. [US-13] (Req 33)
5. An agent MAY appear in more than one category simultaneously (e.g. both unused and failing). [US-13]
6. The system MUST degrade gracefully when an agent's run history is thin: an agent with fewer runs than the configurable Tier B minimum (default 5) MUST have its unused and expensive assessments labeled as low-confidence rather than emitted as definitive flags. [US-13] (Req 34)
7. An agent with zero stored runs MUST be reported separately as **no history** rather than classified unused, failing, or expensive. [US-13] (Req 34)
8. All thresholds and windows — recency window, failing-score threshold, Tier B outlier factor, minimum-run count — MUST be configurable and MUST have documented defaults; the command MUST NOT embed hard-coded judgments. [US-13] (Req 33)
9. The system MUST retrieve all agent and run data through the existing store boundary; `insights` MUST NOT read transcript files or compute scores directly. [US-13]
10. The command MUST be read-only: it MUST NOT alter stored runs, scores, or annotations. [US-13]

## Open questions

None identified. Resolved during speccing: the "expensive" category depends on Tier B data being present and silently omits rather than defaults to not-expensive; thin-history agents are labeled low-confidence rather than excluded; agents with zero runs get a distinct "no history" bucket; all thresholds are configurable defaults.

## Out of scope (deferred)

- GUI rendering of roster insights (V1 Feature 6).
- Lineage-aware call-tree roll-ups of cost or score across parent/child agents (deferred with V1 Feature 7 / Tier B).
- CSV / JSON export of the insights report (v2).
- Automated alerts or scheduled runs of `insights` (v2).
- Dollar-cost dimension for the expensive category (blocked by MVP tokens-only convention).
