# Feature Breakdown: handler (MVP)

**Milestone scope:** MVP only (spec Requirements 1–21). v1/v2 items from the spec's "Out of Scope (Deferred)" are excluded.
**Source:** `docs/spec.md` (authoritative requirements), `docs/concept.md`.

Each feature below is a vertical slice — data, logic, and interface — that can be built, reviewed, and shipped on its own branch.

---

### Feature 1: Agent sources & identity foundation

**Value:** A developer can register and list their user-level and per-repo agent sources from the CLI, and the system can resolve any run name + `cwd` to a single, distinct agent identity while excluding built-in/plugin agents.
**Vertical slice:** data (persisted source registry) / logic (builtin denylist, conventional-folder derivation, identity tuple, `cwd`-nearest-ancestor disambiguation) / interface (CLI `source register` + `source list`).
**Requirements covered:** 3, 4, 5, 8
**User stories:** US-3; contributes to US-2 (exclusion) and US-4 (identity model).
**Depends on:** none
**Branch suggestion:** `feat/agent-sources-identity`
**Notes:** This is the enabling slice — attribution, scoring, conventions, and notes all key off the identity tuple `(source-type, normalized-source-path, name)` and the registered source set defined here. Ships standalone value ("register and see my sources"); the resolution/denylist logic is exercised the moment Feature 2 lands. Identity disambiguation (Req 8) lives here because the nearest-ancestor rule operates over registered source paths; Feature 2 consumes it.

### Feature 2: Run ingestion & attributed history

**Value:** A developer can see a complete, automatically-collected history and metrics for every run of each agent they authored, with zero manual logging.
**Vertical slice:** data (append-only run store with per-run definition snapshots) / logic (transcript JSONL parsing, deterministic attribution via `agentType`/`agentId`, schema-presence guarding, keep-and-tag for interrupted/orphan runs, metric aggregation) / interface (CLI `list` agents + `show <agent>` history & metrics).
**Requirements covered:** 1, 2, 6, 7, 9, 10, 11
**User stories:** US-1, US-5; completes US-2 (attributed results exclude builtins) and US-4 (snapshots survive rename/edit/delete).
**Depends on:** Feature 1 (needs the source registry + identity to attribute runs and exclude builtins).
**Branch suggestion:** `feat/run-ingestion-history`
**Notes:** The core-value slice — the irreplaceable foundation everything else reads from. Parse defensively (Req 7) and never drop runs (Req 6). Snapshot definition _content_, not a path (Req 9). Per-run sub-transcript detail captured here is what Feature 3 scores against.

### Feature 3: Deterministic behavioral scoring

**Value:** A developer gets a reproducible, defensible per-run behavioral score (Tier A checks + tool-utilization) telling them whether a run stayed in lane, used its tools, and completed — with no LLM-judge and nothing leaving the machine.
**Vertical slice:** data (versioned score annotations on runs) / logic (tool-scope adherence, denial count, terminal status, tool-error/thrash detection, write- and path/scope-boundary checks, granted-but-unused tool-utilization, undeclared-scope fallback) / interface (CLI surfaces the score in run history).
**Requirements covered:** 12, 13, 14, 15
**User stories:** US-6
**Depends on:** Feature 2 (scores per-run transcript detail + snapshotted definitions).
**Branch suggestion:** `feat/deterministic-scoring`
**Notes:** MVP is Tier A + tool-utilization only — no Tier B reference-relative or Tier C judged quality (deferred). Store scores as versioned annotations so rubric changes don't rewrite history. Req 15's _fallback_ (scope N/A → lean on write/path boundaries) lives here; the matching "undeclared scope" _definition smell_ is Req 17 in Feature 4.

### Feature 4: Static definition assessment & conventions sync

**Value:** A developer sees which of their agent definitions violate current Anthropic subagent conventions, with the specific offending rule cited — and the convention standard stays current with Anthropic's docs rather than going stale.
**Vertical slice:** data (cached distilled conventions keyed by source hash, with staleness flag) / logic (deterministic starter-set checks 16a–e, undeclared-scope smell, opt-in docs fetch + distillation + hash-cache + staleness detection) / interface (CLI reports violations per agent; opt-in sync command).
**Requirements covered:** 16, 17, 18, 19
**User stories:** US-7, US-8
**Depends on:** Feature 1 (locates definition files via the source registry).
**Branch suggestion:** `feat/conventions-assessment`
**Notes:** All checks deterministic — no LLM grading. The conventions fetch is the _only_ network call the MVP makes and must be opt-in (Req 19). Internally this can phase as bundled-starter-conventions first, then the sync step, but they ship as one slice because Req 18 mandates sourcing checks from the sync step. Independent of ingestion/scoring — assesses the definition file, not runs.

### Feature 5: Per-agent notes

**Value:** A developer can attach, edit, and read freeform notes on each agent, so their own context and intent live alongside the agent's history and survive renames, edits, and deletions.
**Vertical slice:** data (notes store keyed on agent identity) / logic (add/edit/read, identity-keyed persistence) / interface (CLI note commands).
**Requirements covered:** 20, 21
**User stories:** US-9
**Depends on:** Feature 1 (notes key on the agent identity from Req 8).
**Branch suggestion:** `feat/agent-notes`
**Notes:** Near-zero build cost. Keying on identity (not a path/filename) is what makes notes survive rename/edit/delete, consistent with the snapshot model.

---

## Coverage check

- **Requirements covered:**
  - Req 1 → Feature 2
  - Req 2 → Feature 2
  - Req 3 → Feature 1
  - Req 4 → Feature 1
  - Req 5 → Feature 1
  - Req 6 → Feature 2
  - Req 7 → Feature 2
  - Req 8 → Feature 1
  - Req 9 → Feature 2
  - Req 10 → Feature 2
  - Req 11 → Feature 2
  - Req 12 → Feature 3
  - Req 13 → Feature 3
  - Req 14 → Feature 3
  - Req 15 → Feature 3
  - Req 16 → Feature 4
  - Req 17 → Feature 4
  - Req 18 → Feature 4
  - Req 19 → Feature 4
  - Req 20 → Feature 5
  - Req 21 → Feature 5
- **Unassigned requirements:** none

## Summary

- **Total features:** 5
- **Suggested build order:** 1 → 2, then 3, 4, and 5 in parallel (3 needs 2; 4 and 5 need only 1).
- **Independently shippable:** Feature 1 (no dependencies). Features 4 and 5 become shippable as soon as Feature 1 lands; they do not require ingestion or scoring.
- **Risks:** Feature 2 is the load-bearing slice and carries the most parsing/schema-drift risk (mitigated by Reqs 6 & 7). The Feature 1 ↔ Feature 2 boundary around Req 8 (identity model defined in F1, applied at ingest in F2) is the most likely place for confusion — keep the resolution logic owned by Feature 1 and consumed by Feature 2. Feature 4 bundles two concerns (static checks + docs-sync) and holds the only network path in the MVP; treat the opt-in/offline boundary carefully.
