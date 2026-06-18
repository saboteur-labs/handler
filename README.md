# handler

A local-first CLI that logs and evaluates the Claude Code subagents **you author** —
the agent definitions under `~/.claude/agents` and `<repo>/.claude/agents`. handler
observes and evaluates; it never edits your agents, and it only ever looks at your
own agents (never built-in or plugin agents).

It does this in two complementary ways:

- **Behavioral history & scoring** — reads Claude Code's transcripts, attributes each
  subagent run to the agent that produced it, and computes a deterministic per-run
  score (a band, a 0–100 composite, and the failing Tier A + tool-utilization checks).
- **Conventions assessment** — checks each agent _definition_ against a distilled set
  of Anthropic's subagent conventions and reports violations citing the specific rule.

Everything runs locally. The only network call handler can make is the opt-in
conventions sync (see [Keeping conventions current](#keeping-conventions-current)).

## Requirements

- Node.js ≥ 20

## Install

handler isn't published to a registry yet — build it from the repo:

```bash
git clone <repo-url> handler
cd handler
npm install
npm run build
```

The build emits the CLI to `dist/cli/index.js`. Run it with `node dist/cli/index.js …`.

To type `handler …` instead, link it once:

```bash
npm link        # makes the `handler` bin available on your PATH
handler --help
```

The rest of this README uses `handler` as shorthand for `node dist/cli/index.js`.

## Quick start

```bash
# 1. Tell handler where your agent definitions live
handler source register --user           # ~/.claude/agents
handler source register /path/to/repo    # <repo>/.claude/agents

# 2. Assess the definitions against Anthropic's subagent conventions
handler conventions

# 3. See behavioral history once your agents have run
handler list
handler show code-reviewer
```

## Commands

### `handler source register [path]`

Register an agent source so handler knows where to resolve agents from.

- `handler source register --user` — the user-level source (`~/.claude/agents`).
- `handler source register /path/to/repo` — a per-repo source
  (`<repo>/.claude/agents`).

### `handler source list`

List the sources you've registered.

### `handler conventions`

Check every registered source's agent definitions against the distilled
conventions, and print per agent either `no violations` or each failing rule.
The first line is a staleness header for the conventions standard itself.

```
conventions: fresh
repo  bad-agent
  16a  frontmatter is missing required key(s): description
  16b  name "Bad_Name" is not kebab-case
  16d  tools field is absent or empty
  smell: undeclared-scope
repo  code-reviewer
  no violations
```

The rules:

| Rule | Checks                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 16a  | Frontmatter parses and declares the required `name` and `description`.                                                |
| 16b  | `name` is kebab-case and matches the definition's filename.                                                           |
| 16c  | `description` is non-empty, ≥ the minimum length, and contains a triggering cue (e.g. "use when", "use proactively"). |
| 16d  | A non-empty `tools` field is declared. A failure also raises the `undeclared-scope` smell.                            |
| 16e  | No unrecognized frontmatter keys.                                                                                     |

A skill-generated default standard ships with the build, so `handler conventions`
produces real results out of the box — no setup required.

### `handler list`

List your agents and how many runs each has (built from ingested transcripts).

### `handler show <agent>`

Show an agent's run history and metrics, including the per-run deterministic score.

## Keeping conventions current

The conventions standard is distilled from Anthropic's current subagent documentation
and cached at `~/.handler/conventions.json`. handler reads that file; it never fetches.

When `handler conventions` prints a stale header — `stale (missing)`,
`stale (expired)` (older than 30 days), or `stale (hash-mismatch)` (the file was
hand-edited or corrupted) — refresh it by running the **`handler-sync-conventions`**
skill (under `.claude/skills/`). That skill is the only part of handler that touches
the network: it fetches the docs, distills them, and writes the artifact atomically
(a failed fetch leaves your existing standard untouched).

## Configuration

handler stores its data under `~/.handler/` and resolves Claude Code's transcripts
from `~/.claude/projects/`. Each location can be overridden with an environment
variable — handy for testing or non-standard setups:

| Variable              | Overrides                                                     |
| --------------------- | ------------------------------------------------------------- |
| `HANDLER_REGISTRY`    | Source registry file (default `~/.handler/sources.json`).     |
| `HANDLER_STORE`       | Run store (default `~/.handler/runs.json`).                   |
| `HANDLER_SCORES`      | Score store (default `~/.handler/scores.json`).               |
| `HANDLER_CONVENTIONS` | Conventions artifact (default `~/.handler/conventions.json`). |
| `HANDLER_PROJECTS`    | Claude Code transcripts root (default `~/.claude/projects`).  |

## How it works

handler is built as a core library (`src/core/`) behind a thin CLI (`src/cli/`), so a
future GUI can consume the same API. It relies only on Claude Code's on-disk data:
transcripts under `~/.claude/projects/`, with each subagent run isolated to its own
`subagents/agent-<id>.jsonl` and attributed deterministically via the parent session's
`Task` result. Agent identity is the tuple `(source-type, normalized-source-path, name)`,
and each run snapshots the definition's _content_ so history survives renames and edits.

## Development

```bash
npm test            # run the Vitest suite
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run format      # Prettier write
npm run build       # bundle core + CLI to dist/
```

See `CLAUDE.md` for the architecture and invariants, and `docs/spec.md` for the
authoritative MVP requirements.
