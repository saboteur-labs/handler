# Feature Spec: Tier B reference-relative scoring (V1 Feature 2)

**Source:** `docs/specs/v1/features-v1.md` Feature 2 · `docs/spec-v1.md` Reqs 22–25 · US-10
**Status:** Draft

## Overview

handler's MVP scores each run with Tier A checks plus tool-utilization, but every signal is absolute — it can't tell whether a run was costly or off-pattern _for that agent_. This feature adds Tier B: a deterministic, self-relative layer that compares a run against the rolling median of the same agent's prior runs and flags resource outliers, plus an output-contract check that fires only when the agent's definition declares a contract. No thresholds are hand-picked; the reference is the agent's own history. Tier B is shown alongside the MVP composite as its own labeled section, never blended into it.

## Goals

- A developer sees, per run, which resource metrics are outliers relative to that agent's own median — without picking thresholds.
- A developer sees output-contract adherence flagged only for agents whose definition declares a contract.
- Tier B reads existing run/score history and stays fully deterministic and local.
- Thin history degrades to a clear "insufficient history" signal rather than a misleading reference.

## Non-goals

- No derived dollar cost — "cost" is token totals, per the MVP tokens-only convention.
- Tier B does not change the MVP 0–100 composite or band; it is a separate, non-blended section.
- No re-implementation of tool-utilization (granted-but-unused) — that shipped in the MVP and stays in Tier A.
- No interpretive/LLM judgment — that is Tier C (V1 Feature 3).
- No trailing-window reference or roster-wide comparison (V1 Feature 4).

## User stories

- **US-10** As an agent author, I want each run scored against my agent's own history (cost, contract adherence), so outliers are flagged without me picking thresholds.

## Functional requirements

1. The system MUST compute a per-agent reference as the median of that agent's runs strictly prior to the run being scored (self-relative), with no hand-picked thresholds. (Req 22) [US-10]
2. The system MUST flag resource-cost outliers for tokens, wall-clock duration, and turn count when a metric exceeds the reference median by a default factor of 2×; the factor MUST be configurable. (Req 23) [US-10]
3. "Cost" MUST be measured as token totals; the system MUST NOT derive a dollar cost. (Req 23)
4. The system MUST check output-contract adherence only when the agent's definition snapshot declares an explicit contract, detected deterministically via markers (e.g. "return JSON", a fenced code-block language, named `## section` headers); the check verifies parseability or the literal markers. (Req 24) [US-10]
5. Where no contract is declared, the output-contract check MUST be reported as not-applicable, never as a failure. (Req 24) [US-10]
6. Tier B results MUST be deterministic and presented as a distinct, labeled section of the behavioral score, alongside — and never merged into — the MVP Tier A + tool-utilization composite. (Req 25) [US-10]
7. When an agent has fewer than a configurable minimum of strictly-prior runs (default 5), Tier B MUST report "insufficient history" rather than emit a reference. (Req 25) [US-10]
8. Tier B annotations MUST be stored as versioned annotations keyed by agent identity + run id + rubric version, alongside Tier A, so a rubric change adds rows rather than rewriting history. (Req 29, 31)
9. Tier B MUST read runs and scores only through the existing store boundary and MUST NOT alter stored history. (Req 31)

## Open questions

None identified. Resolved during speccing: cost = tokens-only (no dollar derivation); Tier B is a separate, non-blended section (does not change the MVP composite/band); the reference is the median of all strictly-prior runs (earliest runs below min-runs report "insufficient history"); contract detection uses deterministic markers in the definition snapshot.

## Out of scope (deferred)

- Dollar-cost dimension (needs per-token pricing; deferred with the MVP tokens-only convention).
- Trailing-window or decayed references (this feature uses all strictly-prior runs).
- Contract detection from a structured frontmatter field, or from prose-only descriptions.
- Tier C judged-quality signal and anchors (V1 Feature 3).
- Surfacing Tier B outliers in roster insights (V1 Feature 4) or the GUI (V1 Feature 6).
