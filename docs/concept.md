## Concept: handler — observability and evaluation for the agents you build

### Problem & Value

People who build custom Claude Code subagents are flying blind. Once a definition is written there's no feedback loop: you can't see how often it's invoked, whether it stays in its role, whether it uses the tools you scoped to it, or whether its outputs were any good. You learn an agent is weak only when a task goes wrong, and even then can't tell whether the prompt, the tool scope, or a bad invocation was at fault. As you accumulate a dozen hand-made agents the gap compounds — definitions drift from best practice, dead agents linger, "improvement" is guesswork. `handler` closes the loop by logging every run of a user-created agent and evaluating both the _definition_ (valid and conventional?) and the _behavior_ (did it do its job?), turning an invisible process into something you can inspect and improve.

### Target Audience

**Primary:** individual developers who actively author their own Claude Code subagents (`.claude/agents/*.md`) and maintain more than two or three of them — power users who treat their agent roster as tooling worth tuning, not a one-off.

**Secondary:** (1) small teams sharing a project-level set of agents who want a common standard and visibility into which agents earn their keep; (2) skill/agent authors who want evidence their published agents behave as advertised.

### Core Concept

`handler` is a local-first observability layer for _user-authored_ agents specifically — never built-in or plugin agents. It reads Claude Code's existing on-disk transcripts: each subagent run is already isolated to its own file (`<project>/<session>/subagents/agent-<id>.jsonl`), and the parent session's `Task` result records a complete run summary — `agentType` (the agent name), `agentId` (the join key), status, duration, tokens, tool count, and tool stats. That gives deterministic attribution from data already on disk, no instrumentation required; a `SubagentStop` hook is a later add for real-time capture, not a dependency. From these `handler` builds a per-agent history — invocations, duration, tool usage, token/cost, outcome. Because agents can live at the user level (`~/.claude/agents`) or be scoped to a specific repo (`<repo>/.claude/agents`), `handler` resolves run names against a set of configurable sources, deriving the conventional agent folder for any repo it's pointed at.

On top of that history it runs two assessments. **Definition assessment** is static: it checks an agent's markdown against Anthropic's published subagent conventions (frontmatter correctness, a description that triggers well, sensible tool scoping, naming). These conventions aren't hardcoded — a dedicated skill reads Anthropic's current docs and distills repo-level guidance, so when the docs change, `handler`'s standard updates with them. **Behavioral evaluation** is run-based and partly an LLM-judge: against a baseline it scores whether the agent stayed in its lane, used its available tools, and produced the outcome its role implies. The rubric is worked out interactively rather than fixed up front.

The product deliberately starts as observe-and-evaluate only; the first job is to prove the logs and scores are _useful_ to the person reading them. Acting on that signal — editing agents — comes later, through skills "registered" to `handler` (mixing repo-local, user-level, and web skills) rather than one baked-in improver.

### Evaluation Baseline (starter rubric)

Trust depends on the "objective" score being genuinely objective, so the baseline is split into three tiers by how much interpretation each requires, keeping the interpretive tier _separate and labeled_ rather than folded into the deterministic score. All of it is computable from the transcript, the hook, and the agent's definition file.

**Tier A — fully deterministic (zero wiggle room), the MVP score.** Pass/fail set-membership and state checks on a single run, no reference history needed.

- _Tool-scope adherence:_ every tool call ∈ the agent's declared `tools` frontmatter.
- _Permission-denial count:_ tool calls the user/harness denied (>0 = reached for something it shouldn't).
- _Terminal status:_ normal completion vs. error-exit vs. denied vs. hit turn/token budget — a state, not a quality call.
- _Tool-error / thrash count:_ tool errors, and same-tool+same-args repeated ≥N times (loop detection).
- _Write-boundary respect:_ a read-only-scoped agent issued zero `Write`/`Edit`/destructive `Bash`.
- _Path/scope boundary:_ file operations stayed within the working dir / declared scope.

These map to the three criteria — **lane:** scope, write-boundary, path-boundary; **tools:** denial count, error/thrash; **outcome:** terminal status.

**Tier B — deterministic given a per-agent reference.** Reference = rolling median of that agent's own prior runs (self-relative), so no thresholds are hand-picked. Layers in once run history exists.

- _Tool utilization:_ of the tools granted, which were never used across runs (granted-but-unused = over-scoped definition).
- _Resource cost:_ tokens / cost / wall-clock / turn count vs. the agent's median; flag outliers (e.g. >2×).
- _Output-contract adherence:_ only when the prompt states an explicit contract ("return JSON", "sections X/Y/Z"), check parseability / literal markers. This is the closest deterministic proxy for "produced the expected outcome."

**Tier C — irreducibly interpretive, kept separate.** "Was the output actually good" cannot be made objective; if computed (LLM-judge), it is shown as a distinct, audit-able "judged quality" signal with the judge's reasoning attached, never merged into the deterministic score.

**MVP baseline = all of Tier A plus tool-utilization from Tier B** — no rubric design, no LLM-judge, defensible on a single run. One caveat: Tier A's scope checks are only meaningful when an agent declares its `tools`; agents that inherit all tools make scope-adherence vacuously true, so there `handler` leans on write/path boundaries and flags "undeclared scope" as a definition smell via the conventionality check.

### Key Capabilities

- Users can see a complete history of every run of each agent they authored, with no manual logging.
- Users can register agent sources — user-level and per-repo — so repo-scoped agents are tracked without manual path configuration.
- Users can view per-agent metrics: invocation count, duration, tool usage, token/cost, and last-used date.
- Users can attach freeform notes to an agent — observations, intent, things to fix — so context about an agent lives alongside its history.
- The system flags agents whose definitions violate current Anthropic subagent conventions, with the specific rule cited.
- The system keeps its conventions in sync with Anthropic's docs automatically rather than going stale.
- Users can get a behavioral score per run measuring lane-adherence, tool usage, and outcome against a baseline.
- Users can surface insights across their roster — which agents are unused, failing, or expensive.
- Users can drive all of this from a CLI and inspect it in a lightweight GUI built on the same core.
- Users can register skills to `handler` (later) so evaluation can feed remediation.

### Feature Milestones

**MVP** — proves the core value: visibility into your own agents.

- Run ingestion from transcripts (hook deferred), attributed to user-created agents only via `agentType`/`agentId` — _the irreplaceable foundation; everything reads from it, and attribution is already validated on real data._
- Configurable agent sources (user-level + per-repo `.claude/agents`) with a builtin denylist; an agent's identity is its name scoped to its source, and each run snapshots the definition so renames/edits/deletions are visible and runs whose definition can't be found are kept and tagged rather than dropped — _without this, repo-scoped agents are invisible, builtins pollute the data, and history breaks the moment a definition moves._
- CLI to list agents and show per-agent run history and basic metrics — _delivers "see what my agents did" with the least surface area._
- Deterministic behavioral scoring per run (Tier A + tool-utilization) — _the rubric's defined MVP eval: real "did it do its job" signal with no LLM-judge and nothing leaving the machine._
- Static definition assessment against a first set of conventions — _the cheapest high-signal evaluation; needs no rubric design._
- Conventions-sync skill that pulls guidance from Anthropic's subagent docs, caching the distilled result against the source's hash and flagging staleness if a refresh fails — _belongs in MVP because hardcoded conventions rot immediately._
- Per-agent notes the user can add, edit, and read from the CLI — _captures the author's own context and intent next to the data, with near-zero build cost._

**v1** — makes it useful day-to-day, not just demonstrable.

- Reference-relative and judged evaluation (Tier B cost/contract vs. the agent's own history, plus the interpretive Tier C "judged quality" signal) — _extends the MVP's deterministic scoring; needs accumulated history and an interactively-designed rubric to calibrate against._
- Lightweight GUI over the CLI core for browsing runs and scores — _day-to-day inspection is far better visual than tabular._
- Roster-level insights (unused / failing / costly agents) — _requires enough accumulated history to be meaningful._
- Persistent, queryable run store with trend-over-time per agent — _turns one-off scores into an improvement signal._

**v2** — expands toward power users and the act-on-signal vision.

- Skill registry so evaluation can route into remediation (repo / user / web skills) — _deferred until observation is proven useful, per the explicit phasing._
- Agent-editing workflows driven by registered skills — _the first step beyond observation; high risk, so it waits._
- Shareable/exportable evaluation reports for team or published agents — _serves the secondary audiences once the single-user case holds._

### What This Is Not

- Not a tool for built-in or plugin agents — only agents the user authored.
- Not an agent _editor_ in early phases — observation and evaluation come first.
- Not a hosted/cloud SaaS — it is local-first over your own Claude Code data. In MVP it makes no network calls except the opt-in conventions-doc fetch, and its deterministic checks send no agent definitions, code, or transcripts anywhere.
- Not a replacement for `improve-agent`; it is a separate, broader observability product.
- Not a general LLM-app eval framework — it is specific to Claude Code subagents.

### Competitive Landscape

**`improve-agent` (this environment's skill)**

- A skill that reviews one user-agent run and applies at most one small edit, logging observations per agent.
- Overlaps on the core loop: observe a user agent, judge it, improve it.
- `handler` differs by being a persistent, multi-run, queryable system with a CLI+GUI, focused first on _visibility_ across the whole roster rather than per-run edits.
- Could adopt its restraint: one small, net-positive change at a time, and its per-agent accumulating log.

**LangSmith / Langfuse**

- Hosted LLM observability + eval platforms for tracing and scoring LLM apps. (Treat specifics as approximate — verify current features.)
- Overlap on run logging, tracing, and LLM-judge scoring.
- `handler` differs by being local-first, zero-instrumentation (reads existing Claude Code logs), and scoped to Claude Code subagent definitions specifically.
- Could learn from their trace UX and dataset-based eval discipline.

**Promptfoo / Braintrust**

- Open eval frameworks for prompts/LLM outputs against test cases. (Verify current capabilities.)
- Overlap on rubric-based and LLM-judge evaluation.
- `handler` differs by evaluating _deployed_ agents from real runs, not pre-deployment test suites.
- Could adopt their structured, versioned rubric format for the v1 baseline.

**Claude Code OpenTelemetry / built-in logs**

- Claude Code can emit metrics and writes session transcripts locally.
- Overlap on raw data — it is `handler`'s input.
- `handler` differs by interpreting that data _per user-authored agent_ and adding convention + behavior evaluation on top.
- Could learn from its event schema to stay forward-compatible.

The clearest differentiator: `handler` is the only thing aimed squarely at _the agents you personally wrote in Claude Code_, combining zero-setup run capture with a self-updating conventionality check and behavioral scoring — local, private, CLI-first. The self-syncing conventions layer plus the eventual skill registry are what make it noticeably better: the standard never goes stale and remediation isn't locked to one strategy.

### Caveats & Pitfalls

- **Adoption risk:** the population that hand-authors multiple subagents _and_ wants to analyze them is small; if value isn't obvious within the first session, it won't be adopted — hence the explicit "prove usefulness first" framing.
- **Execution risk:** run→run attribution is validated (deterministic via `agentType`/`agentId`), but resolving a run _name to a definition_ is not guaranteed — observed runs include names with no current definition (renamed, deleted, or repo-scoped agents not currently checked out). Mitigated by keying identity on name+source and snapshotting the definition per run, but the snapshot logic is where this can still go wrong (e.g. two sources reusing a name).
- **Schema-drift risk (low):** validated across the 20 Claude Code versions in the user's history — the `toolUseResult` summary shape is identical throughout. Residual risk is a _future_ version changing it; the parser should guard on schema presence and tolerate runs without a completed summary (interrupted runs) rather than assume the shape.
- **Assumption risk:** assumes a meaningful "outcome / lane-adherence" score can be computed automatically. In practice an LLM-judge may produce scores the user doesn't trust; the rubric must be co-designed and the score auditable, or it becomes noise.
- **Convention drift risk:** the docs-sync skill could silently break (page moves, format changes) and freeze the standard while appearing live — needs a freshness signal.
- **Scope-creep risk:** the "register skills and edit agents" vision is gravitational; pulling it forward before observation is proven would sink the project.

### Technical Considerations

- **Transcript parsing vs. hook capture — worth exploring as complementary, not either/or:** treat the on-disk JSONL as the source of truth for content and the hook as the trigger/attribution signal; design the run store so a hook event and a transcript span reconcile into one record.
- **Run-store shape:** worth exploring an append-only local store (e.g. SQLite) keyed by agent identity + run id, with evaluations stored as versioned annotations so rubric changes don't rewrite history.
- **CLI/GUI separation:** since the stack is JS/TS, worth structuring as a core library with a thin CLI and a GUI that consumes the same API, so the GUI never becomes the source of logic.

### Open Questions

No MVP-blocking questions remain open — attribution, schema stability, agent identity, user-created detection, MVP evaluation depth, and privacy posture are all resolved (see Core Concept, Evaluation Baseline, and Feature Milestones). Three of the previously-open **v1 / post-MVP** design questions are now decided (below); one outcome-signal question remains genuinely open pending real-data validation. None block the MVP spec.

**Resolved (v1 design decisions, recorded for when v1 is specced):**

- **(v1) Tier C "judged quality" reference → the agent's own stated role.** The judge evaluates a run's output against the agent's _own definition_ — the per-run definition snapshot (description + system prompt) that handler already stores. This is the only reference that is free, local, per-run, and survives renames/edits/deletions, and it reuses data the MVP already captures: the definition is the contract, so "did it fulfill its stated role" is the natural outcome question. Golden-example references (curated ideal outputs per agent) are rejected as too high-friction and a poor fit for diverse, open-ended agents; a small human-labeled _anchor_ set may be layered in later as optional few-shot calibration for the judge, but is never required to get a signal. The judged-quality output stays a distinct, audit-able signal with the judge's reasoning attached, never merged into the deterministic score (per the Evaluation Baseline's Tier C rule).
- **(v1) Conventions cache change-detection → two-tier hashing.** The docs-sync skill hashes at two layers: (1) the _normalized source_ (after boilerplate/nav extraction) — a change here triggers re-distillation; and (2) the _distilled conventions artifact_ — handler only bumps the conventions version and re-runs definition checks when this hash changes. Page-noise (timestamps, nav, reordering, ads) moves the source hash but not the distilled hash, so re-distillation runs without churning the standard or producing a false "conventions changed." The freshness signal still fires if a refresh _fails_, distinguishing "checked, unchanged" from "couldn't check."
- **(post-MVP) Retention/pruning → no automatic pruning; manual `prune` with optional cap.** Append-only JSON stays cheap; raw transcript detail is the only bulky part. handler keeps everything by default and offers a manual `prune` command with an optional configurable cap (max age and/or max runs per agent) that reclaims raw run _detail_ while retaining the per-run scores and aggregate metrics (already keyed by identity + run id), so the history-as-signal survives even when raw detail is reclaimed.

**Still open:**

- **(v1+)** Could outcome/consequence signal — did the agent's work survive in git (not get reverted/overwritten) and did tests pass afterward — become a metric source alongside the transcript-derived process signal? Two unknowns gate this and must be resolved on real data before any spec text: (a) can a run be linked to its downstream commits and test runs _without_ heuristic attribution, given handler's deterministic-attribution invariant and the confound of human edits after the run; and (b) does "survival" actually correlate with agent quality rather than with downstream human carefulness? Note the tension: under the deterministic-attribution invariant, any run→commit linkage looks irreducibly heuristic, which would force this into a separate, clearly-labeled interpretive tier rather than the deterministic score — but that placement is deliberately _not_ committed until the unknowns are tested. Sequenced after the v1 persistent run store and `SubagentStop` hook, which any outcome tracking would build on.

### Next Steps

The MVP is ready to spec now. Attribution and schema stability are validated against real `~/.claude` data, and the previously-open design choices (agent identity, user-created detection, MVP evaluation depth, privacy posture) are decided. The only deferred work is the v1 judged-quality rubric, which should wait until the MVP proves the deterministic signal is useful and you can hand-label a handful of real runs.
