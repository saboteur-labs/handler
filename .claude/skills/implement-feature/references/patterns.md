# Patterns reference

Project-specific implementation patterns for `handler`. Read alongside
`conventions.md` (naming, exports, commits) and the repo `CLAUDE.md`
(architecture + hard invariants).

`handler` is a **local-first CLI** over the user's own Claude Code data: it reads
on-disk JSONL transcripts and agent-definition markdown, attributes runs, scores
them deterministically, and persists results locally. That shape drives the
patterns below.

---

## API / route handlers

**Not applicable.** handler has no HTTP server and makes no network calls except
the single opt-in conventions-doc fetch (Feature 4). Do not introduce a web server,
router, or REST layer. The "public API" is the `src/core` library surface that the
CLI (and a future GUI) consume — see CLAUDE.md.

---

## State management

**Not applicable (no frontend in the MVP).** A lightweight GUI is a deferred v1 item
and, when built, will consume the same `src/core` API — it must hold no logic of its
own. Do not add a frontend state library.

---

## Background jobs / workers

**Not applicable.** Ingestion/scoring run synchronously on demand from a CLI command
(MVP relies on transcript parsing only; the `SubagentStop` hook is deferred). No queue,
cron, or worker threads.

---

## Database access / persistence

Not yet built — established at Feature 1, Task 5. Intended shape (direction from the
concept, not yet a mandate):

- An **append-only local store** keyed by agent identity + run id; evaluations stored
  as **versioned annotations** so rubric changes never rewrite history.
- All persistence lives under `src/core/` (e.g. `core/store/`). The CLI never touches
  the store directly — it goes through core functions.
- SQLite is the leaning, but the Feature 1 source registry may start as a minimal
  persisted file store. Keep the store interface small and behind a module boundary so
  the backing implementation can change without touching callers.
- Persist normalized data (e.g. normalized source paths, the serialized identity key)
  so equality/joins are stable across runs.

---

## Testing patterns

TDD is mandatory (CLAUDE.md): write a failing test first, minimum code to pass, refactor.

- **Framework:** Vitest. `import { describe, it, expect, vi } from 'vitest'`.
- **Location:** colocated, `src/<area>/<unit>.test.ts`. No separate `tests/` tree.
- **Run:** `npm test` (all); single file `npx vitest run src/core/foo.test.ts`;
  by name `npx vitest run -t "rejects a builtin name"`; `npm run test:watch` while coding.
- **Structure:** `describe('<unit>')` › `it('<behavior phrased as an expectation>')`.
  For every new behavior cover at least: **happy path, one edge case, one failure case.**
- **Map tests to requirements.** Spec requirements are numbered and testable — name the
  `describe`/`it` (or a comment) after the Req it covers, e.g. `it('excludes builtins (Req 3)')`.

**Filesystem — use a real temp dir, do not mock `node:fs`.** handler is filesystem-heavy
(source paths, normalization, symlinks, definition snapshots); mocked fs drifts from real
behavior. Create an isolated dir per test and clean it up:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'handler-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
```

**Fixtures — colocate real-shape samples under `__fixtures__/`** next to the code that
parses them (e.g. `src/core/ingest/__fixtures__/`). For transcript/definition parsing,
fixtures must mirror real Claude Code shapes: JSONL transcript lines with a
`toolUseResult` summary (`agentType`, `agentId`, `status`, `totalTokens`, …) and agent
markdown with frontmatter. Always include at least one **malformed / interrupted /
missing-definition** fixture to prove the defensive-parsing and keep-and-tag behavior
(see Error handling).

**Mocking — minimal and inline.** No global `__mocks__/` directory. Use `vi.fn()` /
`vi.spyOn()` inline and reset with `vi.restoreAllMocks()` in `afterEach`. The only thing
that should ever be mocked is the network boundary (Feature 4's conventions fetch) — tests
run **offline by default** and must never hit the network or read the user's real `~/.claude`.

---

## Error handling

Distinguish two failure classes — they are handled oppositely.

**1. Expected, data-driven anomalies at trust boundaries are NOT exceptions.** Reading
on-disk transcripts and definitions, expect: malformed/partial JSONL lines, runs without a
completed `toolUseResult` summary (interrupted), names with no current definition (renamed/
deleted/not-checked-out), unrecognized frontmatter. Per the hard invariants, **parse
defensively, never throw, never drop** — guard on schema presence, then **keep-and-tag** the
record and surface the condition as *data* (a tag / flag / "smell") for the caller to report.
Reserve heavy parsing behind `unknown` + explicit validation rather than type assertions.

**2. Programmer / environment errors throw.** A registered source path that can't be read, a
corrupt store, an invariant violated in our own code — throw an `Error` with a clear,
actionable message (never a bare string). Introduce a `HandlerError` base in
`src/core/errors.ts` when the first real need to distinguish error types arises; don't
pre-build a hierarchy.

**CLI boundary owns exit behavior.** Core functions throw or return — they do **not** call
`process.exit`. A single top-level handler in `src/cli` catches thrown errors, prints a
concise `chalk.red` message to **stderr**, and sets a non-zero exit code. Full stack traces
are shown only under a `--verbose` flag / `DEBUG` env — never by default. User-input
validation (e.g. `source register <path>` to a nonexistent dir) produces a clear message and
exit code 1, not a stack trace.

**Privacy invariant in errors too:** error messages, tags, and any logging stay local
(stderr / local store). Never put agent definitions, code, or transcript contents into
anything that could leave the machine.
