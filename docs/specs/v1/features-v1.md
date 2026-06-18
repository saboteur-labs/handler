# handler V1 — Feature Breakdown

**Milestone scope:** v1 only. Source spec: `docs/spec-v1.md` (Reqs 22–38, US-10–US-16). MVP features are in `docs/features.md`.

### Feature 1: Queryable history & per-agent trend

**Value:** A developer with accumulated history can see how one agent's metrics and scores move over time — turning one-off scores into an improvement signal.
**Vertical slice:** data (queryable store keyed by agent identity + run id, evaluations as versioned annotations, behind the existing store boundary) / logic (time-bucketed per-agent aggregation) / interface (`trend` CLI command).
**Requirements covered:** 31, 32
**User stories:** US-12
**Depends on:** none — reads the MVP run/score stores (already keyed by identity + run id).
**Branch suggestion:** `feature/trend-over-time`
**Notes:** The enabling slice — its query layer is reused by Feature 4 (insights) and Feature 5 (hook reconciliation). Keep it a real `trend` command, not a bare "add SQLite" horizontal layer. Versioned annotations must mean a rubric change adds rows, never rewrites history.

### Feature 2: Tier B reference-relative scoring

**Value:** A developer gets richer, still-deterministic per-run signal — cost outliers and output-contract adherence measured against the agent's own rolling median, with no hand-picked thresholds.
**Vertical slice:** logic (rolling-median reference; tokens/cost/wall-clock/turn outlier flags at default 2×; output-contract parse checks when a contract is declared; graceful degrade under min-runs) / data (Tier B annotations versioned alongside Tier A) / interface (Tier B section in score output).
**Requirements covered:** 22, 23, 24, 25
**User stories:** US-10
**Depends on:** none hard — needs multi-run history, which the MVP store already provides. Independently shippable.
**Branch suggestion:** `feature/tier-b-reference-scoring`
**Notes:** MVP already ships tool-utilization (granted-but-unused) — do **not** re-implement it here; this feature adds only the cost and output-contract parts of Tier B. Stays deterministic; presented alongside the MVP composite, never interpretive.

### Feature 3: Tier C judged-quality signal

**Value:** A developer can optionally see an interpretive "judged quality" score per run — did the output fulfill the agent's own stated role — as a distinct, audit-able signal with reasoning attached, optionally calibrated by their own labeled runs.
**Vertical slice:** logic (LLM-judge against the per-run definition snapshot; optional few-shot anchors) / data (judged-quality + anchors as separate, labeled, versioned annotations keyed by identity + run id + rubric version) / interface (opt-in flag; segregated display; anchor-labeling command).
**Requirements covered:** 26, 27, 28, 29, 30
**User stories:** US-11, US-16
**Depends on:** none — uses the MVP per-run definition snapshot already stored.
**Branch suggestion:** `feature/tier-c-judged-quality`
**Notes:** **The only new network/LLM path in V1** — must be opt-in (Req 28) and never merged into the deterministic score (Req 27). Anchors (Req 30) are user-triggered only and never required for a signal; they ship within this feature as scope, not a separate feature.

### Feature 4: Roster-level insights

**Value:** A developer maintaining many agents can triage in one view which are unused, failing, or expensive.
**Vertical slice:** logic (roster-wide aggregation across recency, Tier A failures/score threshold, cost outliers; low-confidence degradation) / data (reuses Feature 1's query layer) / interface (`insights` CLI command).
**Requirements covered:** 33, 34
**User stories:** US-13
**Depends on:** Feature 1 (query layer). The "expensive" category consumes Tier B cost outliers (Req 33 → Req 23), so the full view needs **Feature 2**; an "unused/failing" first cut can ship on MVP scores + Feature 1 alone.
**Branch suggestion:** `feature/roster-insights`
**Notes:** Must degrade gracefully when history is thin (Req 34) rather than emit misleading flags.

### Feature 5: Real-time capture hook

**Value:** A developer can capture runs in real time via a `SubagentStop` hook instead of waiting for transcript parsing, with no duplicate records.
**Vertical slice:** logic (hook handler; reconciliation of hook event ↔ transcript span into one record) / data (store reconciliation keyed by run id) / interface (hook registration/config; enable-disable).
**Requirements covered:** 37, 38
**User stories:** US-15
**Depends on:** Feature 1 (the queryable store is where event and transcript span reconcile into one record).
**Branch suggestion:** `feature/subagentstop-hook`
**Notes:** Complementary, not required (Req 38) — transcript parsing stays source of truth; everything must work with the hook disabled. Reconciliation/dedup is the main risk.

### Feature 6: Lightweight GUI

**Value:** A developer can browse their roster, run history, and scores visually instead of through tabular CLI output.
**Vertical slice:** interface (GUI app) consuming the **same core library API** as the CLI — no logic of its own.
**Requirements covered:** 35, 36
**User stories:** US-14
**Depends on:** Features 1–3 for full content (Req 36 surfaces Tier A/B/C scores + history), but a thin first cut can browse MVP runs + Tier A scores and grow as the others land.
**Branch suggestion:** `feature/lightweight-gui`
**Notes:** Hard invariant: the GUI holds no logic (Req 35) — any behavior it needs lives in `src/core/`. Broadest cross-dependency surface; ship last.

## Coverage check

- **22, 23, 24, 25** → Feature 2 (Tier B)
- **26, 27, 28, 29, 30** → Feature 3 (Tier C, incl. anchors)
- **31, 32** → Feature 1 (store & trend)
- **33, 34** → Feature 4 (roster insights)
- **35, 36** → Feature 6 (GUI)
- **37, 38** → Feature 5 (hook)
- Unassigned requirements: none — all of Reqs 22–38 are assigned to exactly one feature.

## Summary

- **Total features:** 6
- **Suggested build order:** 1 → (2, 3 in parallel) → 4 → 5 → 6. Feature 1 is the enabling slice; 2 and 3 are independent and can run in parallel; 4 needs 1 (and 2 for the full "expensive" view); 5 needs 1; 6 consumes 1–3 and ships last.
- **Independently shippable:** Features 1, 2, and 3 (each reads existing MVP stores/snapshots; no V1 dependencies).
- **Risks:** Feature 3 (Tier C) — the only network/LLM path, carries the trust/opt-in/never-merge constraints. Feature 5 (hook) — reconciliation/dedup correctness. Feature 6 (GUI) — broadest dependency surface plus the "no logic in GUI" invariant.
