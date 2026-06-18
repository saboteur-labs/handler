# Task List: Feature 5 — Per-agent notes

**Feature source:** `docs/specs/feature-5-agent-notes.md`
**Requirements covered:** spec Reqs 20, 21 (`docs/spec.md`)
**Estimation unit:** story points (1/2/3/5/8)
**Approach:** TDD per CLAUDE.md — failing test first, minimum code to pass, then refactor.

Builds on Feature 1 (identity tuple + `identityKey`) and Feature 2 (`summarizeAgents`, the `ingest`/run model that lets a note resolve to a deleted-but-previously-run agent). A note keys on `identityKey` — not a path — which is exactly why it survives rename/edit/delete (Req 21). The store mirrors `ScoreStore`: a versioned `{version, notes[]}` envelope through `json-store`, default `~/.handler/notes.json`, path injectable via a new `HANDLER_NOTES` env var. Single editable note per agent; input via `--body`/stdin or `$EDITOR`; readable via a dedicated command and inline in `show`.

---

### Task 1: Note store (identity-keyed, versioned)

**What:** A versioned store that persists one freeform note per agent identity, with get/set (set overwrites) keyed on `identityKey`.
**Files:** `src/core/store/note-store.ts` (+ test).
**Done when:** types define `{version, notes: {identityKey, body, updatedAt}[]}`; `NoteStore(filePath = defaultNotePath())` reads once, `get(identityKey)` returns the note or `undefined`, `set(identityKey, body)` upserts (re-setting overwrites the prior body and bumps `updatedAt`), and persists via `writeJsonFile`; a structurally-invalid file degrades to empty rather than throwing; **no network calls**; tests cover set-then-get, overwrite, missing-file empty read, and malformed-file degrade.
**Depends on:** none
**Estimate:** 2
**Notes:** Reqs 20, 21, local-first constraint. Mirror `ScoreStore` exactly — `NOTE_STORE_VERSION`, `defaultNotePath()` → `~/.handler/notes.json`, same versioned-envelope/degrade semantics. Store body as plain UTF-8 string; no per-run or timestamped history (non-goal).
**Done:** [x]

### Task 2: Name → identity resolver for note commands

**What:** A shared helper that resolves a CLI-supplied agent name (with optional source disambiguation) to a single `AgentIdentity`, reporting ambiguous and unknown cases.
**Files:** `src/core/resolve.ts` or `src/core/agents.ts` (+ test); export from `src/core/index.ts`.
**Done when:** given the ingested runs and a `name`, returns `{ kind: 'found', identity }`, `{ kind: 'ambiguous', matches }`, or `{ kind: 'unknown' }`; an agent whose definition was deleted but which has prior runs still resolves (Req 21); `identityKey(identity)` matches what the run store recorded; tests cover unique match, ambiguous across sources, deleted-but-has-runs, and unknown.
**Depends on:** none
**Estimate:** 2
**Notes:** Req 8, Req 6 (CLI must report ambiguous/unknown clearly), Req 21. Reuse `summarizeAgents(runs)` (carries `sourceType`/`sourcePath`/`name`) and build the identity from a matched summary so note resolution stays consistent with `show`/`list`. `show.ts` may later be refactored onto this helper, but that refactor is out of scope for this task.
**Done:** [x]

### Task 3: `note set` + `note show` commands

**What:** A `note` command group: `note set <agent>` writes a body supplied via `--body`/stdin, and `note show <agent>` prints the current note or an explicit empty state.
**Files:** `src/cli/commands/note.ts`, `src/cli/index.ts` (register) (+ test).
**Done when:** `handler note set <agent> --body "…"` (and piped stdin when `--body` is omitted) resolves the agent via Task 2 and upserts via Task 1; `handler note show <agent>` prints the stored body, or "no note" for an agent with none (not an error, Req 7); ambiguous/unknown agents print the same guidance `show` uses and exit non-zero; the command holds no logic beyond resolve + store calls; tests assert set-then-show round-trips, the empty-note message, and the ambiguous/unknown paths.
**Depends on:** 1, 2
**Estimate:** 3
**Notes:** Reqs 20 (add/read), 7. Thin-CLI pattern per Features 2–4. Note-store path injected through `CliContext` (see Task 6). Setting on an agent that already has a note overwrites it (single-note model).

### Task 4: `note edit` via `$EDITOR`

**What:** `note edit <agent>` launches the user's `$EDITOR` pre-loaded with the current note text and saves the edited result.
**Files:** `src/cli/commands/note.ts` (extend), editor-launch helper (+ test).
**Done when:** `handler note edit <agent>` writes the current note (or empty) to a temp file, spawns `$EDITOR` (fallback documented, e.g. `vi`) on it, and on clean exit upserts the file's contents via Task 1; a non-zero editor exit or unchanged content leaves the prior note intact; the spawn is isolated behind an injectable seam so a test can stub it (no real editor in CI); tests cover save-on-edit, no-op on abort, and the empty-starting-note case.
**Depends on:** 1, 2, 3
**Estimate:** 2
**Notes:** Req 20 (edit). Highest-uncertainty task — spawning an interactive process and reading it back is the one place this feature touches the OS/TTY. Inject the spawn function (default `child_process.spawnSync` with `stdio: 'inherit'`) so the command stays testable and the CLI stays thin.

### Task 5: Surface the note inline in `show <agent>`

**What:** Render the agent's note inside `handler show <agent>` output alongside its metrics/history.
**Files:** `src/cli/commands/show.ts` (+ test).
**Done when:** `handler show <agent>` prints the note (or omits/says "no note") for the resolved agent, reading via the Task 1 store; behavior is unchanged when no note exists; existing `show` tests still pass and a new test asserts the note line renders.
**Depends on:** 1, 2
**Estimate:** 1
**Notes:** Req 20 (read surface = both dedicated command and inline in `show`). Smallest slice; keep formatting consistent with the rest of `show`.

### Task 6: Env wiring, barrel exports, and green build

**What:** Wire the note-store path through the CLI context/env and export the note API from the core barrel, leaving the full quality gate clean.
**Files:** `src/cli/main.ts`, `src/cli/commands/source.ts` (`CliContext`), `src/core/index.ts`.
**Done when:** `HANDLER_NOTES` env var injects the note-store path (mirroring `HANDLER_SCORES`); `NoteStore`, `defaultNotePath`, the note types, and the Task 2 resolver are exported from the core barrel; `npm test`/`typecheck`/`lint`/`build` are all clean.
**Depends on:** 3, 4, 5
**Estimate:** 1
**Notes:** Mirrors the `HANDLER_SCORES`/`HANDLER_CONVENTIONS` wiring added in Features 3–4. Pure plumbing; no new behavior.

---

## Summary

- **Total tasks:** 6
- **Total estimated effort:** 11 story points
- **Critical path:** Tasks 1 → 3 → 4 → 6 (8 points); Task 2 feeds Tasks 3/4/5, and Task 5 branches off 1+2 and rejoins at 6.
- **Risks:** **Task 4 (`note edit` via `$EDITOR`)** is the only real uncertainty — it spawns an interactive process, so the editor seam must be injectable or it can't be tested in CI, and the abort/unchanged path must never clobber a good note. Everything else is well-trodden: the store (Task 1) is a direct `ScoreStore` clone, and resolution (Task 2) reuses `summarizeAgents`. Watch the Task 2 boundary — the deleted-but-has-runs case (Req 21) is the requirement most likely to be missed if resolution is built off live definition files instead of recorded runs.
