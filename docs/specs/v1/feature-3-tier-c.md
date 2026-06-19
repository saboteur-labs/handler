# Feature Spec: Tier C judged-quality signal (V1 Feature 3)

**Source:** `docs/specs/v1/features-v1.md` Feature 3 · `docs/spec-v1.md` Reqs 26–30 · US-11, US-16
**Status:** Draft

## Overview

handler's deterministic scores (Tier A, Tier B) measure behavioral conformance and resource outliers, but cannot answer "did the agent actually fulfill its stated role?" This feature adds Tier C: an optional, interpretive LLM-judge signal that evaluates a run's output against the agent's own per-run definition snapshot (description + system prompt). Because the signal sends run content to an external model it is strictly opt-in, stored as a segregated annotation with reasoning attached, and must never be merged into the deterministic score. Users can optionally calibrate the judge with their own labeled runs (few-shot anchors), created only when they choose to do so.

## Goals

- A developer can optionally request a judged-quality signal per run and see whether the output fulfilled the agent's stated role, with the judge's reasoning visible.
- The signal is always clearly segregated from the deterministic Tier A/B score — a separate labeled annotation, never blended.
- All deterministic functionality (ingestion, Tier A/B scoring, conventions checks) continues to work without Tier C ever being invoked.
- A developer can label a past run with their own score and reasoning, creating a few-shot anchor that calibrates the judge for that agent.
- The judge's outputs are auditable and reproducible per rubric version — a rubric change creates new annotations, never overwrites history.

## Non-goals

- Tier C MUST NOT contribute to the 0–100 composite score or the Tier A/B behavioral score in any way.
- Tier C is not run automatically — it fires only when the user explicitly requests it.
- Anchors are not required for Tier C to produce a signal; the judge operates on the definition snapshot alone without them.
- No managed or hosted LLM configuration — the user supplies their own API access; this feature only structures the call and stores the result.
- No roster-level or cross-agent Tier C aggregations (V1 Feature 4).
- No GUI rendering of Tier C signals (V1 Feature 6).

## User stories

- **US-11** As an agent author, I want an optional, clearly-labeled "judged quality" score with reasoning, so I can gauge output quality without it polluting the objective score.
- **US-16** As an agent author, I want to optionally label a few of my own runs with a score and reasoning, when I choose to, so I can calibrate the judge to match my judgment.

## Functional requirements

1. The system MUST be able to compute a judged-quality signal for a run by submitting the run's output and its stored per-run definition snapshot (description + system prompt) to an LLM judge. (Req 26) [US-11]
2. The judged-quality computation MUST be opt-in: it MUST NOT execute unless the user explicitly requests it (e.g., via a `--judge` flag or dedicated command). The system MUST remain fully operational — ingestion, Tier A/B scoring, conventions checks — with Tier C never invoked. (Req 28) [US-11]
3. Judged-quality results MUST be stored as versioned annotations keyed by agent identity + run id + rubric version, so a rubric change adds a new annotation rather than rewriting history. (Req 29) [US-11]
4. The judged-quality annotation MUST include: the signal label (pass/fail or a scored band), the judge's reasoning text, the rubric version used, and a timestamp. (Req 27) [US-11]
5. The judged-quality annotation MUST be displayed as a distinct, labeled section — segregated from the Tier A/B output — whenever the relevant `show` or score command renders it. The deterministic sections MUST render correctly without it. (Req 27) [US-11]
6. The judged-quality signal MUST NOT be merged into, blended with, or used to modify the deterministic composite score or any Tier A/B annotation. (Req 27) [US-11]
7. The system MUST provide a command for users to create a human-labeled anchor on a past run: the command MUST capture the run's stored definition snapshot, the run output, the user-supplied score, and the user-supplied reasoning as the anchor record. (Req 30) [US-16]
8. Anchor creation MUST be user-initiated only — the system MUST NOT create or modify anchors automatically. (Req 30) [US-16]
9. When anchors exist for an agent, the system MUST include them as few-shot examples in the Tier C judge prompt for that agent. When no anchors exist, the judge MUST still produce a signal using the definition snapshot alone. (Req 30) [US-11, US-16]
10. Anchors MUST be stored as versioned, labeled records distinct from Tier C annotations, keyed by agent identity + run id, so they are retrievable and auditable independently of judge invocations.
11. The system MUST surface a clear, labeled warning before invoking the judge that run output and definition content will be transmitted to an external model, and MUST provide a way to abort the invocation. (Req 28) [US-11]
12. When the judge call fails (network error, API error, timeout), the system MUST NOT alter existing annotations or deterministic scores; the failure MUST be reported without leaving partial state.

## Open questions

None identified. Key decisions resolved during v1 speccing: Tier C is opt-in and segregated (Reqs 27–28); anchors are user-triggered only and not required for a signal (Req 30); versioned annotations keyed by identity + run id + rubric version (Req 29); anchors ship within this feature, not separately.

## Out of scope (deferred)

- Automated or scheduled Tier C evaluation.
- Roster-level Tier C aggregations and "failed quality" insights (V1 Feature 4, which surfaces Tier C once available).
- GUI rendering of Tier C signals and anchors (V1 Feature 6).
- Multi-model judge configuration or model comparison.
- Anchor sharing or export across users or repos.
- Lineage-aware Tier C scoring (scoring a run in the context of its parent agent's call tree).
