# Product Spec: handler — observability and evaluation for the agents you build

**Milestone scope:** MVP only. v1 and v2 requirements are listed under Out of Scope (Deferred).
**Status:** Draft
**Source concept:** handler — observability and evaluation for the agents you build (`docs/concept.md`)

## Overview

`handler` is a local-first tool that logs and evaluates the user-authored Claude Code subagents a developer builds — never built-in or plugin agents. Once an agent definition is written there is no feedback loop: how often it runs, whether it stays in its role, whether it uses its scoped tools, and whether its outputs were good are all invisible. `handler` closes that loop by reading Claude Code's existing on-disk transcripts, attributing each subagent run to a specific user-created agent, and producing two assessments per agent: a static check of the definition against current Anthropic subagent conventions, and a deterministic behavioral score of each run. The MVP is observe-and-evaluate only, driven from a CLI, and turns an invisible process into something the author can inspect.

## Goals

- A developer can see a complete, automatically-collected history of every run of each agent they authored, without manual logging.
- A developer can view per-agent metrics (invocation count, duration, tool usage, token/cost, last-used date) from the CLI.
- A developer can get a deterministic, defensible behavioral score per run (Tier A + tool-utilization) with no LLM-judge involved.
- A developer can see which of their agent definitions violate current Anthropic subagent conventions, with the specific rule cited.
- The product attributes runs to user-created agents only, excluding built-in and plugin agents, across both user-level and per-repo sources.
- A developer can attach and read freeform notes on each of their agents.
- The product operates fully locally, making no network calls except an opt-in conventions-doc fetch.

## Non-goals

- Not a tool for built-in or plugin agents — only agents the user authored.
- Not an agent editor — the MVP observes and evaluates only; it does not modify definitions.
- Not a hosted/cloud SaaS — local-first over the user's own Claude Code data.
- Not a general LLM-app eval framework — specific to Claude Code subagents.
- Not a replacement for `improve-agent`.
- **MVP boundary:** no GUI, no LLM-judge / Tier C "judged quality", no Tier B reference-relative scoring (cost/contract vs. history), no roster-level cross-agent insights, no `SubagentStop` hook, and no skill registry — all deferred to v1/v2.

## Users

**Solo agent author (primary)**
An individual developer who actively authors their own Claude Code subagents and maintains more than two or three of them.
**Key need:** a feedback loop on agents they wrote — usage, conformance, and whether each run did its job.
**Success looks like:** within the first session they can point `handler` at their data and see, per agent, how it has run and where its definition or behavior is off.

_Secondary audiences (small teams sharing project agents; skill/agent authors) are acknowledged in the concept but not separately served by the MVP._

## User Stories

**Solo agent author**

- **US-1** [MVP] As an agent author, I want every run of my agents ingested automatically from existing logs, so I never have to instrument or manually record runs.
- **US-2** [MVP] As an agent author, I want runs attributed only to agents I created (not builtins/plugins), so my data isn't polluted.
- **US-3** [MVP] As an agent author, I want to register user-level and per-repo agent sources, so my repo-scoped agents are tracked without hand-configuring paths.
- **US-4** [MVP] As an agent author, I want history preserved when I rename, edit, or delete a definition, so my timeline survives changes.
- **US-5** [MVP] As an agent author, I want to list my agents and see per-agent run history and metrics from the CLI, so I can see what each agent did.
- **US-6** [MVP] As an agent author, I want a deterministic behavioral score per run, so I can tell whether a run stayed in lane, used its tools, and completed.
- **US-7** [MVP] As an agent author, I want my definitions checked against current Anthropic conventions with the offending rule named, so I can fix them.
- **US-8** [MVP] As an agent author, I want the convention standard to stay current with Anthropic's docs, so the checks don't go stale.
- **US-9** [MVP] As an agent author, I want to attach and read freeform notes on an agent, so my own context and intent live alongside its history.

## Functional Requirements

### MVP Requirements

**Ingestion & attribution**

1. The system MUST ingest subagent runs by reading Claude Code's on-disk transcripts without requiring instrumentation. [US-1]
2. The system MUST attribute each run to an agent using the parent `Task` result's `agentType` (name) and `agentId` (join key to the per-run sub-transcript). [US-1][US-2]
3. The system MUST exclude built-in and plugin agents from attributed results via a builtin denylist. [US-2]
4. The system MUST resolve run names against a configurable set of agent sources, supporting at least user-level (`~/.claude/agents`) and per-repo (`<repo>/.claude/agents`) locations, deriving the conventional agent folder for a given repo. [US-3]
5. The system MUST allow a user to register and list agent sources from the CLI. [US-3]
6. The system MUST tolerate runs without a completed summary (e.g. interrupted runs) and runs whose definition cannot be found, keeping them and tagging them rather than dropping them. [US-1][US-4]
7. The system SHOULD guard on the presence of the expected `toolUseResult` summary schema rather than assume it, so a future Claude Code schema change degrades gracefully. [US-1]

**Identity & history** 8. The system MUST treat an agent's identity as the tuple `(source-type, normalized-source-path, name)` so identically-named agents in different sources are distinct. When a run could match more than one source, the system MUST attribute it by the run's recorded `cwd`: the registered repo source whose path is the nearest ancestor of `cwd` wins; if none matches, it falls back to the user-level source. [US-3][US-4] 9. The system MUST snapshot the agent's definition content at the time of each run, so renames, edits, and deletions are visible and history survives them. A snapshot MUST be stored as content (not a path reference) so it remains valid after the source file changes or is deleted. [US-4]

**Metrics & CLI** 10. The system MUST provide a CLI command to list the user's agents. [US-5] 11. The system MUST provide a CLI command to show, per agent, its run history and metrics: invocation count, duration, tool usage, token/cost, and last-used date. [US-5]

**Behavioral scoring (deterministic)** 12. The system MUST compute a per-run deterministic behavioral score covering Tier A checks: tool-scope adherence, permission-denial count, terminal status, tool-error/thrash count, write-boundary respect, and path/scope boundary. [US-6] - **Thrash:** a thrash event is ≥3 occurrences within a single run of the same `(tool-name, normalized-args)`, where args are normalized by JSON canonicalization (key-sorted, whitespace-stripped) and, for `Bash`, by the trimmed command string. The check reports the count of distinct thrash events. [US-6] - **Path/scope boundary:** the implicit scope of a run is the run's recorded `cwd` and its subtree. A violation is any write/edit or destructive `Bash` whose resolved target path falls outside that subtree. Reads are not boundary-checked. [US-6] 13. The system MUST compute tool-utilization (granted-but-unused tools) as part of the score. [US-6] 14. The system MUST NOT use an LLM-judge for the MVP score, and MUST compute scoring without transmitting agent definitions, code, or transcripts off the machine. [US-6] 15. Where an agent does not declare a `tools` scope, the system MUST treat tool-scope adherence as not-applicable, fall back to write/path-boundary checks, and surface "undeclared scope" as a definition smell (see Req 17). [US-6][US-7]

**Static definition assessment** 16. The system MUST check each agent definition against a set of Anthropic subagent conventions and report violations citing the specific rule. The MVP MUST ship at least this concrete starter set, all deterministic (no LLM grading): (a) frontmatter parses and contains required `name` and `description`; (b) `name` is kebab-case and matches the definition's filename; (c) `description` is non-empty, is at least 40 characters, and contains at least one triggering cue (e.g. an explicit "use when"/"when the user" style phrase); (d) a `tools` field is present and non-empty; (e) no unrecognized frontmatter keys. [US-7] 17. The system MUST flag "undeclared scope" (rule 16d failing) as a definition smell during static assessment. [US-7] 18. The system MUST source its conventions from a conventions-sync step that distills Anthropic's current subagent docs, cache the distilled result against the source's hash, and flag staleness if a refresh fails. [US-8] 19. The conventions-doc fetch MUST be opt-in and MUST be the only network call the MVP makes. [US-8]

**Per-agent notes** 20. The system MUST let a user add, edit, and read freeform text notes attached to an agent (keyed on the agent identity from Req 8) from the CLI. [US-9] 21. Notes MUST persist across runs and MUST survive a renamed, edited, or deleted definition, consistent with the identity and snapshot model. [US-9]

## Constraints

- **Local-first / privacy:** MVP makes no network calls except the opt-in conventions-doc fetch; deterministic checks send no agent content anywhere. (Concept: What This Is Not.)
- **User-created only:** the product must never report on built-in or plugin agents. (Concept: What This Is Not.)
- **Deterministic MVP score:** the MVP behavioral score must be reproducible and explainable with no interpretive/LLM component; the interpretive tier is explicitly deferred. (Concept: Evaluation Baseline.)
- **Resilient attribution:** identity keyed on name+source with per-run definition snapshots; parser must tolerate missing/changed definitions and incomplete run summaries. (Concept: Caveats — Execution & Schema-drift.)
- **Prove-usefulness-first:** value should be evident within the first session; avoid scope beyond observation/evaluation. (Concept: Caveats — Adoption & Scope-creep.)
- **Architecture:** worth structuring as a JS/TS core library behind a thin CLI so a later GUI consumes the same API; an append-only local store (e.g. SQLite) keyed by agent identity + run id, with evaluations stored as versioned annotations. (Concept: Technical Considerations — treated as direction, not mandate.)

## Open Questions

No open questions block the MVP. The four prior implementation questions are now resolved in the requirements: identity disambiguation by `cwd`-nearest source (Req 8), the deterministic conventions starter set and description threshold (Reqs 16–17), the thrash definition of ≥3 identical normalized calls (Req 12), and the `cwd`-subtree path/scope boundary (Req 12). The starter values (description ≥40 chars, thrash threshold of 3) are deliberate defaults open to tuning once there is real run data, but neither blocks implementation.

## Out of Scope (Deferred)

- [v1] — Reference-relative and judged evaluation: Tier B cost/contract vs. the agent's own history, plus the Tier C interpretive "judged quality" LLM-judge signal.
- [v1] — Lightweight GUI over the CLI core for browsing runs and scores.
- [v1] — Roster-level insights (which agents are unused, failing, or expensive).
- [v1] — Persistent, queryable run store with trend-over-time per agent.
- [v1] — `SubagentStop` hook for real-time capture (MVP relies on transcript parsing only).
- [v2] — Skill registry routing evaluation into remediation (repo/user/web skills).
- [v2] — Agent-editing workflows driven by registered skills.
- [v2] — Shareable/exportable evaluation reports for teams or published agents.
- [post-MVP] — Data-retention/pruning policy as run history accumulates (concept OQ).
