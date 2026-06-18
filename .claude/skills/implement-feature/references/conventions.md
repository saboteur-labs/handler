# Conventions reference

Project-specific conventions for `handler`. These override general defaults.
The stack (TypeScript + ESM, tsdown, Vitest, ESLint, Prettier, Commander + chalk)
and the broader invariants live in the repo's `CLAUDE.md` — read that too.

---

## Naming

- **Files:** `kebab-case.ts` for all modules (e.g. `source-registry.ts`, `agent-identity.ts`).
- **Test files:** colocated next to the unit, `<name>.test.ts` (e.g. `denylist.test.ts`).
- **Variables and functions:** `camelCase`.
- **Types, interfaces, classes:** `PascalCase`. Do not prefix interfaces with `I`.
- **Module-level constants:** `SCREAMING_SNAKE_CASE` (e.g. `BUILTIN_DENYLIST`, `VERSION`).
- **CLI commands:** lowercase, space-separated nouns/verbs (e.g. `source register`, `source list`).

---

## File and directory structure

Core library behind a thin CLI — the CLI holds **no logic**, so a future GUI can consume
the same core (a hard architectural rule from the concept).

```
src/
  core/        All behavior: parsing, identity, resolution, scoring, persistence.
               This is the public API surface. Feature modules live here
               (e.g. core/sources/, core/identity.ts, core/denylist.ts).
  cli/         Thin Commander wrappers. Parse args, call core, format output.
               cli/commands/<group>.ts per command group.
  core/index.ts  Barrel re-exporting the public core API the CLI/GUI consume.
```

- Tests are colocated (`src/**/*.test.ts`), not in a separate `tests/` tree.
- Build output goes to `dist/` (gitignored). Never import from `dist/` in source.
- Persistence/store code lives under `src/core/` (e.g. `core/store/`); the CLI never
  touches the store directly — it goes through core.

---

## Code style

- **Named exports only in `src/`.** No default exports. (Tool config files —
  `tsdown.config.ts`, `vitest.config.ts`, `eslint.config.js` — are exempt because
  their APIs require a default export.)
- **Explicit return types on every exported function.** Catches accidental type
  widening and keeps the core API self-documenting. Inference is fine for locals.
- **No `any`.** Use precise types, `unknown` + narrowing, or generics. This matters
  especially when parsing Claude Code transcripts — guard on schema presence
  (`unknown` → validated shape) rather than asserting.
- Prefer `const`; use `let` only when reassigned; never `var`.
- ESM only: `import`/`export`, no `require`. Relative imports within `src/`
  (no path alias configured) — e.g. `../core/index`, not `@/core/index`.
- Keep functions focused (~40 lines max); split when larger.
- Comments explain **why**, not **what**. No `TODO` comments left in committed code —
  track deferred work in the feature's task list or `follow-up-work.md`.
- Parse defensively at trust boundaries (on-disk transcripts, agent definition
  frontmatter): tolerate missing/changed shapes, keep-and-tag rather than throw/drop.

---

## Import order and aliasing

No path alias — use relative imports. Group imports with a blank line between groups,
in this order (matches the existing scaffold):

1. Node built-ins (`node:fs`, `node:path`) — use the `node:` protocol prefix.
2. External packages (`commander`, `chalk`).
3. Internal modules (relative paths, e.g. `../core/index`).

```ts
import { join } from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

import { VERSION } from '../core/index';
```

---

## Git and commit conventions

- **Commits: Conventional Commits.** `feat:`, `fix:`, `chore:`, `docs:`, `test:`,
  `refactor:`. Imperative summary, ≤72 chars. Body explains the why when non-obvious.
  End every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Branches:** one per feature, `feat/<short-description>` (e.g. `feat/agent-sources-identity`),
  matching the branch suggestions in `docs/features.md`.
- **Scope:** one feature per branch/PR. Work the per-feature task list in `docs/tasks/`;
  prefer a commit per completed task (TDD: test + implementation together).
- **Quality gate:** the husky pre-commit hook runs `lint-staged` (ESLint + Prettier on
  staged files). Don't bypass it. Before marking a task done, all of `npm run typecheck`,
  `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` must pass.
