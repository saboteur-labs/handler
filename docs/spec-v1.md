# Product Spec: handler — observability and evaluation for the agents you build (v1)

**Milestone scope:** v1 only. MVP requirements (Reqs 1–21) live in `docs/spec.md` and are assumed shipped; v2 and post-MVP items are listed under Out of Scope (Deferred).
**Status:** Draft
**Source concept:** handler — observability and evaluation for the agents you build (`docs/concept.md`)
**Requirement numbering:** continues the global sequence from `docs/spec.md`; v1 requirements begin at Req 22.

## Overview

The MVP proved the core loop: it ingests user-authored Claude Code subagent runs from on-disk transcripts, attributes them deterministically, and produces a static conventions check plus a deterministic per-run behavioral score (Tier A + tool-utilization). v1 makes `handler` useful day-to-day rather than just demonstrable. It layers reference-relative scoring (Tier B) and an interpretive, separately-labeled judged-quality signal (Tier C) onto the existing per-run score; turns the run store into a persistent, queryable history with per-agent trend-over-time; surfaces roster-level insights (which agents are unused, failing, or expensive); adds a lightweight GUI over the same core; and adds an optional `SubagentStop` hook for real-time capture. It remains local-first and observe-and-evaluate only.

## Goals

- A developer can get a reference-relative behavioral signal (Tier B) per run, measured against the agent's own history with no hand-picked thresholds.
- A developer can optionally see an interpretive "judged quality" signal (Tier C) per run, kept distinct from the deterministic score and shown with the judge's reasoning.
- A developer can inspect how an agent's metrics and scores trend over time from a persistent, queryable store.
- A developer can surface roster-level insights across all their agents — which are unused, failing, or expensive — in one view.
- A developer can browse their roster, run history, and scores in a lightweight GUI built on the same core as the CLI.
- A developer can optionally capture runs in real time via a `SubagentStop` hook without producing duplicate records.

## Non-goals

- Not an agent editor — v1 remains observe-and-evaluate only; remediation/skill-registry work stays in v2.
- Not a hosted/cloud SaaS — local-first over the user's own Claude Code data.
- The Tier C judged-quality score MUST NOT be merged into the deterministic behavioral score.
- **v1 boundary:** no skill registry, no agent-editing, no shareable/exportable reports (all v2); no automatic data pruning (post-MVP); no git-survival/test-outcome metric (open question, deferred).

## Users

**Solo agent author (primary)**
An individual developer who actively authors their own Claude Code subagents and maintains more than two or three of them.
**Key need:** to act on accumulated signal — spot weak, idle, or costly agents over time, not just inspect a single run.
**Success looks like:** they open the GUI or run one CLI command and immediately see which agents need attention and how each has trended since they last looked.

_Secondary audiences (small teams; published-agent authors) are acknowledged in the concept but first served by v2 reporting._

## User Stories

**Solo agent author**

- **US-10** [v1] As an agent author, I want each run scored against my agent's own history (cost, contract adherence), so outliers are flagged without me picking thresholds.
- **US-11** [v1] As an agent author, I want an optional, clearly-labeled "judged quality" score with reasoning, so I can gauge output quality without it polluting the objective score.
- **US-12** [v1] As an agent author, I want to see how an agent's metrics and scores trend over time, so one-off scores become an improvement signal.
- **US-13** [v1] As an agent author, I want a roster-level view of unused, failing, and expensive agents, so I can triage a large collection.
- **US-14** [v1] As an agent author, I want to browse runs and scores in a GUI, so inspection is visual rather than tabular.
- **US-15** [v1] As an agent author, I want optional real-time run capture via a hook, so I don't have to wait for transcript parsing.
- **US-16** [v1] As an agent author, I want to optionally label a few of my own runs with a score and reasoning, when I choose to, so I can calibrate the judge to match my judgment.

## Functional Requirements

### v1 Requirements

**Reference-relative scoring (Tier B, deterministic)**

22. The system MUST compute a per-agent reference as the rolling median of that agent's own prior runs (self-relative), with no hand-picked thresholds. [US-10]
23. The system MUST flag resource-cost outliers — tokens, cost, wall-clock duration, and turn count — relative to the agent's median, using a default outlier factor of 2× that is configurable. [US-10]
24. The system MUST check output-contract adherence only when the agent's definition states an explicit contract (e.g. "return JSON", named sections), verifying parseability or literal markers deterministically. Where no contract is declared, the check MUST be reported as not-applicable. [US-10]
25. Tier B results MUST be deterministic and presented as part of the behavioral score, distinct from but alongside the MVP Tier A + tool-utilization composite. When an agent has fewer than a configurable minimum of prior runs (default 5), Tier B MUST degrade gracefully and report "insufficient history" rather than emit a misleading reference. [US-10]

**Judged-quality signal (Tier C, interpretive)**

26. The system MUST be able to compute an optional judged-quality signal via an LLM-judge, evaluating a run's output against the agent's own per-run definition snapshot (description + system prompt) as the reference contract. [US-11]
27. The judged-quality signal MUST be stored and displayed as a distinct, labeled annotation with the judge's reasoning attached, and MUST NOT be merged into the deterministic score. [US-11]
28. The judged-quality computation MUST be opt-in, because it transmits run output and definition content to an LLM; it MUST NOT run by default, and the system MUST keep all deterministic checks (Tier A/B), ingestion, and conventions checks operable without it. [US-11]
29. Judged-quality results MUST be stored as versioned annotations keyed by agent identity + run id + rubric version, so a rubric change adds a new annotation rather than rewriting history. [US-11]
30. The system MUST support an optional, user-initiated set of human-labeled anchors — past runs the user has scored with reasoning — used as few-shot calibration examples in the Tier C judge prompt for that agent or role. Anchors MUST be created only when the user chooses to (never automatically), MUST NOT be required for Tier C to produce a signal (Req 26 operates against the definition snapshot without them), and each anchor MUST capture the run's definition-snapshot reference, the run output, the human score, and the human's reasoning. [US-16]

**Persistent queryable store & trend**

31. The system MUST persist runs and evaluations in a queryable store keyed by agent identity + run id, with evaluations held as versioned annotations, behind the existing store boundary so the backing implementation can change without affecting callers. [US-12]
32. The system MUST provide a CLI command to show, per agent, its metrics and scores trended over time. [US-12]

**Roster-level insights**

33. The system MUST provide a CLI command that surfaces roster-level insights, categorizing agents as unused (no runs within a configurable window, or granted-but-unused tools), failing (Tier A failures or composite score below a configurable threshold), and expensive (cost outliers per Req 23). [US-13]
34. Roster insights MUST degrade gracefully when history is thin, omitting or labeling low-confidence categorizations rather than emitting misleading flags. [US-13]

**Lightweight GUI**

35. The system MUST provide a lightweight GUI that consumes the same core library API as the CLI and contains no business logic of its own. [US-14]
36. The GUI MUST let the user browse their roster, per-agent run history, and per-run scores (Tier A, Tier B, and — when computed — Tier C). [US-14]

**Real-time capture (hook)**

37. The system MUST support an optional `SubagentStop` hook for real-time run capture, and MUST reconcile a hook event and the corresponding transcript span into a single run record without creating duplicates. [US-15]
38. The hook MUST be complementary, not required: transcript parsing MUST remain the source of truth for run content, and the system MUST function fully with the hook disabled. [US-15]

## Constraints

- **Local-first / privacy:** the only network/off-machine paths in v1 are the opt-in conventions-doc fetch (MVP) and the opt-in Tier C judged-quality call (Req 28); all Tier A/B checks and ingestion stay fully local.
- **Score separation:** the interpretive Tier C signal must never be folded into the deterministic score; it is shown separately with auditable reasoning. (Concept: Evaluation Baseline.)
- **No invented thresholds:** Tier B references are self-relative (rolling median); any factor or window (outlier 2×, min-runs 5, unused-window) is a tunable default, not a hard-coded judgment. (Concept: Evaluation Baseline.)
- **Trust / auditability:** because the judged-quality score risks producing signal the user doesn't trust, it must be auditable (reasoning attached) and opt-in. (Concept: Caveats — Assumption risk.)
- **Architecture:** GUI consumes the core API and holds no logic; the run store stays append-only with versioned-annotation evaluations behind the single store boundary (SQLite-swappable). (Concept: Technical Considerations.)
- **Reconciliation:** the run store must be designed so a hook event and a transcript span resolve into one record. (Concept: Technical Considerations.)

## Open Questions

**OQ-1: Outcome/consequence signal (deferred).** Could "did the agent's work survive in git and did tests pass afterward" become a metric source, given handler's deterministic-attribution invariant and the human-edit confound?
**Impact:** Would add requirements in a separate, clearly-labeled interpretive tier; gated on real-data validation of (a) non-heuristic run→commit linkage and (b) whether survival correlates with agent quality. Not in v1 scope until resolved.
**Owner:** Product + data validation.

_Resolved during speccing:_ Tier C rubric calibration — **decided** to include an optional, user-triggered human-labeled anchor set as few-shot judge calibration (Req 30); created only when the user chooses, never required for a signal. Default tuning values (Tier B outlier 2×, min-runs 5, unused-window, failing-score threshold) — **accepted** as starter defaults per Reqs 23, 25, 33, adjustable once real run history exists (MVP precedent).

## Out of Scope (Deferred)

- [v2] — Skill registry routing evaluation into remediation (repo/user/web skills).
- [v2] — Agent-editing workflows driven by registered skills.
- [v2] — Shareable/exportable evaluation reports for teams or published agents.
- [post-MVP] — Automatic data-retention/pruning; a manual `prune` command with an optional age/count cap that reclaims raw run detail while retaining per-run scores and aggregate metrics (concept: resolved post-MVP decision).
- [v1+] — Git-survival / test-outcome metric source (see OQ-1).
