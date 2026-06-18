# Task List: Feature 1 — Agent sources & identity foundation

**Feature source:** `docs/features.md` (Feature 1)
**Requirements covered:** spec Reqs 3, 4, 5, 8 (`docs/spec.md`)
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor.

Since this is the repo's first feature, it includes the one-time project scaffolding.

---

### Task 1: Scaffold JS/TS core-library + thin-CLI project

**What:** A working JS/TS project skeleton (build, lint, test runner, `src/core` + `src/cli` split, CLI entrypoint) with quality gates green on a placeholder test.
**Files:** `package.json`, `tsconfig.json`, ESLint config, test-runner config (e.g. Vitest), `src/core/index.ts`, `src/cli/index.ts`, `bin/handler`, one placeholder test, and the CLAUDE.md "Project status" section replaced with real build/lint/test commands (incl. how to run a single test).
**Done when:** `npm test`, `npm run lint`, and `npm run build` all succeed; a single named test can be run; CLAUDE.md status section reflects the real commands.
**Depends on:** none
**Estimate:** 3
**Notes:** Establishes the core-library-behind-thin-CLI structure mandated by the concept. Don't pull in the run store (Feature 2) yet. The CLI bin is `src/cli/index.ts` (built to `dist/cli/index.js`, shebang preserved, registered via `package.json` `bin`) rather than a hand-written `bin/handler` wrapper.
**Done:** [x]

### Task 2: Builtin/plugin agent denylist (Req 3)

**What:** A module that decides whether an agent name belongs to a built-in/plugin agent and must be excluded.
**Files:** `src/core/denylist.ts`, test.
**Done when:** `isBuiltinAgent(name)` returns true for every seeded built-in/plugin name and false for user-authored names, all covered by tests; the denylist set is centralized and extensible.
**Depends on:** 1
**Estimate:** 2
**Notes:** Seed from the known built-in agent names (e.g. `general-purpose`, `Explore`, `Plan`, etc.). Keep it data-driven so it can grow.
**Done:** [x]

### Task 3: Source model + conventional-folder derivation (Req 4)

**What:** A source abstraction for the two source types (user-level, per-repo) with path normalization and derivation of the conventional `.claude/agents` folder.
**Files:** `src/core/sources/source.ts`, test.
**Done when:** user-level resolves to `~/.claude/agents`; given a repo path, derives `<repo>/.claude/agents`; source paths are normalized (absolute, symlink/`..`-resolved, trailing-slash-stable); tests cover both source types and normalization edge cases.
**Depends on:** 1
**Estimate:** 2
**Notes:** Normalization here is load-bearing for identity (Task 4) and nearest-ancestor matching (Task 6) — get it right once. The shared `normalizePath` primitive lives in `src/core/paths.ts` (not inside `source.ts`) since Tasks 4 and 6 also depend on it.
**Done:** [x]

### Task 4: Agent identity tuple (Req 8)

**What:** The identity value `(source-type, normalized-source-path, name)` with construction, equality, and a stable serialized key.
**Files:** `src/core/identity.ts`, test.
**Done when:** two agents with the same name in different sources produce distinct identities; same name+source produces equal identities and an identical serialized key; tests cover equality, inequality, and key stability.
**Depends on:** 3
**Estimate:** 2
**Notes:** The serialized key is the join key reused by Features 3 (scores) and 5 (notes) — keep it deterministic and migration-safe. `identityKey` is a fixed-order JSON array (`["<type>","<path>","<name>"]`); its format is pinned by a test and should be treated as a persisted contract.
**Done:** [x]

### Task 5: Source registry — register & list (core) (Req 5)

**What:** A persisted registry that registers a source and lists registered sources across process restarts.
**Files:** `src/core/sources/registry.ts`, a small persistence module, test.
**Done when:** registering a source then listing returns it; the registry reloads persisted sources in a fresh instance; registering an already-registered normalized path does not duplicate it; tests cover add, list, reload, and dedupe.
**Depends on:** 3
**Estimate:** 3
**Notes:** Append-only/SQLite is the architectural direction, but a minimal persisted store is acceptable for the source registry — keep the persistence boundary clean so Feature 2's run store can adopt the same store. Implemented as a JSON file store (`src/core/store/json-store.ts`) behind `SourceRegistry`; default location `~/.handler/sources.json`. Stored shape is versioned (`{version:1, sources:[{type, root}]}`) and load tolerates a malformed file.
**Done:** [x]

### Task 6: cwd-nearest-ancestor resolution (Req 8 + Reqs 3, 4)

**What:** `resolve(name, cwd)` that maps a run's name and `cwd` to a single agent identity using the disambiguation rule.
**Files:** `src/core/resolve.ts`, test.
**Done when:** among registered repo sources whose path is an ancestor of `cwd`, the nearest wins; with no matching repo source it falls back to the user-level source; built-in/plugin names are excluded (Task 2); tests cover nested repo sources, no-match fallback, and a denylisted name.
**Depends on:** 2, 4, 5
**Estimate:** 3
**Notes:** This is Feature 1's integration heart and is consumed by Feature 2 at ingest time; it is library-only (no CLI surface in this feature). Highest-uncertainty task — exercise tie/nesting cases explicitly. `resolveAgent(name, cwd, sources)` returns `AgentIdentity | null` (null for a builtin name or no match); ancestor check is segment-aware via `path.relative`; "nearest" = deepest ancestor (longest root, valid because ancestors of one cwd form a chain). Fallback uses the registered user source; no user source registered → null.
**Done:** [x]

### Task 7: CLI `source register` / `source list` (Req 5)

**What:** Thin CLI commands wiring the source registry to the terminal.
**Files:** `src/cli/commands/source.ts`, CLI wiring in `src/cli/index.ts`, test.
**Done when:** `handler source register <path>` registers a source and `handler source list` prints registered sources; an integration test drives the CLI and asserts output; the CLI contains no logic beyond argument parsing and calling core.
**Depends on:** 5
**Estimate:** 2
**Notes:** Keeps the GUI-ready boundary — all behavior lives in core (Task 5).
**Done:** [ ]

---

## Summary

- **Total tasks:** 7
- **Total estimated effort:** 17 story points
- **Critical path:** Tasks 1 → 3 → 4 → 6 (with 6 also gated by 2 and 5). The CLI deliverable runs 1 → 3 → 5 → 7 in parallel with the identity/resolution chain.
- **Risks:** Task 6 (resolution) carries the most logic risk — nearest-ancestor disambiguation with fallback and denylist is the spec's trickiest rule and the place Req 8 can go wrong (two sources reusing a name). Task 1 (scaffold) is low-uncertainty but blocks everything; lock the test-runner/lint choices early. Path normalization in Task 3 silently underpins Tasks 4 and 6 — a bug there surfaces far away.
