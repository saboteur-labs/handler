# Feature Spec: Static definition assessment (`assess`) + check-suppression config

**Source:** proposed post-v1 feature (observe-only track) · relates to MVP Req 15 (tool scope) and Reqs 16–19 (conventions) · new user story US-19
**Status:** Draft
**Milestone:** Proposed (post-v1). Extends the observe-and-evaluate static axis; does **not** pull in the v2 agent-editing / skill-registry vision.

## Overview

handler already evaluates agents on two clocks: static conformance to Anthropic's documented conventions (the `conventions` command, checked against a synced artifact), and deterministic behavioral scoring after a run (Tier A/B/C in `show`). This feature deepens the **static** clock with handler's _own_ opinionated analysis of a definition — catching a class of problems _before an agent ever burns a token_, on the one evaluation axis that needs zero usage history to build or test.

It adds an `assess` command that runs a registry of deterministic static checks over each user-authored definition, grouped as **tools** (least-privilege and spawn-graph hygiene), **prompt** (structure and cost-proxy lints on the system-prompt body), and **fleet** (cross-agent duplication and routing-ambiguity smells). Because several of these checks are opinions rather than laws (examples aren't always warranted; prompt size is contextual), the feature also introduces a general **check-suppression config** — keyed by check id, degrade-to-default like every other store, and _visible_ (suppressed findings are summarized, never silently dropped).

`assess` is deliberately kept distinct from `conventions`: `conventions` answers "does this match the external, synced standard" (and goes stale when that standard changes); `assess` answers "what does handler think of this definition" (intrinsic, never stale). It stays fully local, deterministic, no-LLM, and observe-only.

## Goals

- A developer sees, per agent, deterministic static findings about tool-scope risk, prompt structure, and fleet-level duplication — before any run exists.
- A developer can suppress or re-level individual checks they disagree with, via an external config, without editing their agent definitions.
- Suppression is transparent: the developer can always see what was silenced and why a report is quiet.
- `assess` produces a CI-usable exit code driven by the highest unsuppressed finding severity.
- The suppression engine is general (keyed by check id) so it can later also govern `conventions`, but for now affects only `assess`.

## Non-goals

- **Not an editor.** `assess` reports findings and may emit suggested-fix _text_, but MUST NOT modify any agent definition, store, or annotation. (Observe-only invariant.)
- **No LLM / network.** Every check is deterministic and local; no definition, code, or transcript is transmitted anywhere. (Interpretive judgment already has a segregated home in Tier C; `assess` does not add a network path.)
- **Does not extend or replace `conventions`.** The synced Anthropic artifact, staleness/TTL, and checks 16a–e are untouched; `assess` neither reads the artifact nor depends on its freshness.
- **No inline (in-definition) suppression.** Suppression lives only in external config (see FR-16).
- **No per-agent config overrides in this feature** — global/user/repo precedence only; per-agent targeting is deferred.
- **No heuristic body-vs-tools semantic checks in the first check set** (e.g. "mutating tools granted but description reads read-only") — deferred to a future check pass to keep the initial set low-false-positive.

## User stories

- **US-19** As an agent author, I want handler to statically assess my agent definitions for tool-scope, prompt-structure, and fleet-duplication risks before they run, and to let me suppress checks I don't care about, so I can catch real problems early without living with noise.

## Functional requirements

### Command & check engine

1. The system MUST provide an `assess` command that enumerates each user-authored definition across the registered sources (user-level + per-repo, same enumeration `conventions` uses), excludes built-in/plugin agents via the builtin denylist, and reports static findings per agent. Bare `assess` MUST run every category; the command MUST be structured as a subcommand group exposing `assess tools`, `assess prompt`, and `assess fleet` to run a single category, matching the existing `source`/`note` subcommand-group convention. (relates Req 16) [US-19]
2. Static checks MUST be modeled as a registry of independent check descriptors — each with a stable string `id` (e.g. `tools/spawn-loop`), a `category` (`tools` | `prompt` | `fleet`), a default `severity` (`error` | `warn` | `info`), and a pure evaluation function — so checks are added without editing a closed union or a monolithic function. [US-19]
3. Each finding MUST carry its check `id`, effective `severity`, a human-readable `message`, and an optional report-only `suggestion` string. The `suggestion` MUST be advisory text only and MUST NOT be applied automatically. [US-19]
4. `assess` MUST be fully deterministic and local: it MUST make no network calls and invoke no LLM, and MUST NOT read the synced conventions artifact or depend on its staleness state. [US-19]
5. `assess` MUST NOT alter any stored run, score, annotation, config, or agent definition; it reads definitions only. [US-19]
6. A definition whose snapshot cannot be loaded (orphan) MUST be reported as such and MUST NOT crash the run, consistent with `conventions` orphan handling. (relates Req 16)

### Parsing prerequisites

7. The system MUST parse `Agent(...)` tool grants in a definition's `tools:` frontmatter into a structured set of spawn-target agent names (supporting `Agent(a)`, `Agent(a, b)`, and `Agent(*)`), exposed alongside the existing declared/granted tool scope. This MUST NOT change the MVP tool-utilization scoring behavior. (relates Req 15)
8. The system MUST expose the system-prompt **body** of a definition (the content after the frontmatter block) as a distinct string for body-level checks, parsed deterministically and never throwing on malformed input.

### First check set

9. `tools/spawn-loop` (default severity **error**) MUST fire when the fleet's `Agent(...)` spawn graph contains a cycle, or when an agent grants a spawn target of itself. The finding MUST name the participating agents / the cycle path. [US-19]
10. `tools/redundant-wildcard` (default severity **warn**) MUST fire when a definition grants a wildcard (`*`, or `Agent(*)`) alongside one or more explicitly named tools of the same family, since the named grants are redundant. [US-19]
11. `tools/over-broad` (default severity **info**) MUST fire when a definition grants a wildcard tool scope, or a granted-tool count exceeding a configurable `maxTools` threshold. [US-19]
12. `prompt/empty-body` (default severity **error**) MUST fire when a definition has frontmatter but no non-whitespace system-prompt body. [US-19]
13. `prompt/no-examples` (default severity **info**) MUST detect when a definition body contains no example block (e.g. no `<example>` marker). This check MUST ship **disabled by default** (default policy `off`) — example blocks are not universally warranted (they matter most for agents relying on automatic delegation) — and MUST be enable-able via config. Its default-off state, alongside the default-on `info` checks, MUST exercise the config path in both directions (opt-in enabling and opt-out suppression). [US-19]
14. `prompt/size` (default severity **info**) MUST fire when the estimated token size of the definition (frontmatter + body) exceeds a configurable `maxTokens` threshold, reported as a per-run cost proxy (a large fixed prompt is paid on every run). The estimate method MUST be deterministic. [US-19]
15. `fleet/duplicate-trigger` (default severity **warn**) MUST fire when two definitions' `description` fields exceed a configurable textual-similarity threshold (default 0.8), flagging routing ambiguity; and `fleet/duplicate-definition` (default severity **info**) MUST fire when two definitions share a `name` across different sources, or when their bodies exceed the same similarity threshold. Similarity MUST be computed deterministically as token-set Jaccard over each field, with light normalization (lowercase, split on non-alphanumerics, drop a small stopword set) so shared filler words do not inflate the score. The threshold is a tunable starter default. [US-19]

### Suppression config

16. The system MUST read check policy from external config files only — a user-level `~/.handler/config.json` and a per-repo `<repo>/.handler/config.json` — and MUST NOT read any suppression directive embedded in an agent definition (neither frontmatter, which would trip `conventions` check 16e, nor an in-body comment, which would pollute the prompt the agent reads). [US-19]
17. Each config file MUST carry a schema `version` and MUST degrade to defaults (as if absent) on a corrupt or wrong-version file rather than throwing or migrating, consistent with the existing store boundary. [US-19]
18. For each check id, config MUST accept either a shorthand string (`"off" | "error" | "warn" | "info"`) or an object `{ enabled?, severity?, options? }`, where `options` supplies that check's thresholds (e.g. `maxTools`, `maxTokens`, similarity cutoff). `"off"` MUST be equivalent to `{ enabled: false }`. [US-19]
19. Effective policy MUST be resolved by precedence, lowest to highest: built-in check defaults → user config → repo config. The repo config for the run's context MUST win over the user config, so a team can commit shared policy. (Per-agent overrides are out of scope for this feature.) [US-19]
20. The suppression engine MUST be general — keyed by check id independent of category or command — so it can later govern `conventions` findings, but in this feature it MUST affect only `assess` and MUST NOT alter `conventions` behavior. [US-19]
21. Suppressed findings MUST NOT be silently dropped: `assess` MUST print a summary of how many findings were suppressed and by which check ids, and MUST provide a `--all` flag that includes suppressed findings in the output (visually marked as suppressed). [US-19]

### Rendering & exit status

22. `assess` MUST render findings grouped per agent and ordered by severity (errors first), using the same thin-CLI/core split as `conventions` — all check logic lives in `src/core/`, and the CLI only formats. An agent with no unsuppressed findings MUST render a clear "no findings" line. [US-19]
23. `assess` MUST set a non-zero process exit code when any unsuppressed finding meets or exceeds a configurable fail-severity threshold, so the command is usable as a CI gate; otherwise it MUST exit zero. The threshold MUST be exposed as a single `--fail-on <severity>` flag defaulting to `error` (e.g. `--fail-on warn` for a stricter gate). [US-19]

## Open questions

None open.

_Resolved during speccing:_

- **Command surface — decided** a subcommand group: bare `assess` runs all categories, with `assess tools|prompt|fleet` for a single category, matching the `source`/`note` house convention so handler's own static checks read as one family distinct from `conventions` (FR-1). Hyphenated top-level commands (`assess-tools`) and a single `--category` filter were considered and rejected — the group form makes the family visible in `--help` with less surface.
- **`prompt/no-examples` default — decided** ship the check registered but **disabled by default** (`off`), enable-able via config (FR-13). Example blocks are not universally warranted; default-off avoids noise while still exercising the config's opt-in path (default-on `info` checks exercise the opt-out path).
- **Similarity metric — decided** token-set Jaccard with light normalization (lowercase, non-alphanumeric split, small stopword set), one implementation for both fleet checks, default threshold 0.8, tunable (FR-15). Normalized edit-distance and body n-gram shingles were considered; deferred as later refinements if long-body robustness demands them.
- **Fail-severity — decided** a single `--fail-on <severity>` flag defaulting to `error` (FR-23); a separate `--strict` flag was rejected in favor of the one configurable knob.

## Out of scope (deferred)

- **Per-agent config overrides** (keyed by identity tuple, like notes/scores) — deferred to a fast-follow; this feature is global/user/repo only.
- **Governing `conventions` via the same config** — the engine is built general (FR-20) but wiring it to `conventions` (making spec'd checks 16a–e suppressible) is a separate decision.
- **Heuristic semantic checks** — e.g. `tools/mutating-in-readonly` (grants Write/Edit/Bash but description reads read-only) and `tools/undeclared-but-instructed` (body instructs actions the granted tools can't perform); deferred until the deterministic set proves out, and would ship at `warn`/`info` given false-positive risk.
- **Surfacing `assess` findings in `show`, `insights`, or the GUI** — this feature ships the standalone command only.
- **Applied/auto-fix remediation** — belongs to the v2 agent-editing / skill-registry track; `assess` stays report-only.
- **Suggested-fix generation beyond simple static text** — no templated rewrites of definitions in this feature.
