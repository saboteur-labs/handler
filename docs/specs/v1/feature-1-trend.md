# Feature Spec: Queryable history & per-agent trend (V1 Feature 1)

**Source:** `docs/specs/v1/features-v1.md` Feature 1 · `docs/spec-v1.md` Reqs 31–32 · US-12
**Status:** Draft

## Overview

handler shows point-in-time per-agent metrics (`show`) and a per-run deterministic score, but nothing reveals how an agent's behavior moves across its runs. This feature adds chronological querying over the existing run and score history and a `trend` CLI command, so a developer can see whether an agent is improving, regressing, or getting costlier over time — turning one-off scores into an improvement signal. It is the enabling slice the other V1 features (roster insights, hook reconciliation) build their queries on.

## Goals

- A developer can view one agent's runs ordered over time with score, band, duration, tokens, and tool-use count.
- A developer can optionally collapse that series into day or week buckets.
- Trend reads through the existing store boundary, so the backing store can change without touching callers.
- Thin or empty history degrades gracefully — no error, a clear "not enough history" signal.

## Non-goals

- No new persisted data — reuses the existing run and score stores; trend is read-only.
- No Tier B / Tier C signals in the series (those features add their own columns later).
- No charts or GUI rendering (CLI table only; visualization is V1 Feature 6).
- No cross-agent / roster comparison (V1 Feature 4).
- No derived dollar cost — token totals only, per the MVP convention.

## User stories

- **US-12** As an agent author, I want to see how an agent's metrics and scores trend over time, so one-off scores become an improvement signal.

## Functional requirements

1. The system MUST provide a `handler trend <agent>` command, selecting an agent by the same identity selector `show` uses. [US-12]
2. By default the system MUST output, per completed run, a row ordered oldest→newest containing: run timestamp, composite score, band, total duration, total tokens, and total tool-use count. [US-12]
3. The system MUST include incomplete runs as dated rows with their summary numbers omitted (consistent with `aggregateMetrics`) and MUST count them distinctly.
4. The system MUST support `--bucket day|week`, aggregating each bucket into: run count, median composite score, and median tokens and duration. Absent the flag, output is per-run.
5. The system SHOULD support `--since <ISO date>` and `--last <N>` filters that window the series before rendering or bucketing.
6. The system MUST retrieve runs and scores through the existing `json-store` boundary, exposing chronological per-agent access by run timestamp — not direct file reads.
7. The system MUST NOT alter, reorder, or rewrite stored runs or score annotations; trend is read-only over the versioned history.
8. The system MUST degrade gracefully: an agent with no runs reports "no runs"; a single run renders without implying a trend; an unknown agent errors consistently with `show`.
9. Runs missing a timestamp MUST sort last and be labeled, never dropped.

## Open questions

None identified. Granularity (per-run default + `--bucket`) and the metric set (full headline) are resolved; bucket aggregates use the **median** (robust, and consistent with Tier B's self-relative median direction).

## Out of scope (deferred)

- Tier B / Tier C series columns (V1 Features 2 and 3).
- GUI visualization of trends (V1 Feature 6) and roster-wide trends (V1 Feature 4).
- CSV / JSON export of the series.
- Bucket sizes beyond day/week and configurable aggregation functions.
