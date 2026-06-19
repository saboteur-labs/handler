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
- **Judged quality (Tier C)** — an _optional_, opt-in LLM-judge signal that asks whether
  a run actually fulfilled the agent's own stated role, with the judge's reasoning
  attached. It is segregated from the deterministic score and never blended into it
  (see [Judged quality (Tier C)](#judged-quality-tier-c)).
- **Run inspection** — read the full turn-by-turn transcript of any run (its task
  prompt, outputs, and every tool call and result), triage your whole roster at a
  glance with `handler insights`, and browse it all visually with `handler gui`.

handler also captures **nested** runs — subagents spawned by other subagents — attributing
each to its own agent and annotating it `spawned by <agent>`.

Everything runs locally by default. The only network calls handler can make are both
opt-in: the conventions sync (see [Keeping conventions current](#keeping-conventions-current))
and the Tier C judge, which runs only when you explicitly invoke `handler judge`.

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
handler trend code-reviewer        # how that agent's scores move over time
handler transcript code-reviewer --latest   # what the last run actually did

# 4. Triage the whole roster, or browse everything in a GUI
handler insights
handler gui
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

Show an agent's run history and metrics, including the per-run deterministic
score, the Tier B reference-relative section, any Tier C judged-quality
annotation, the conventions result, and the agent's note. Runs that were spawned
by another subagent are annotated `spawned by <agent>`.

### `handler trend <agent>`

Trend an agent's metrics and scores over time. By default it prints one row per
run, oldest→newest, with the composite score, band, duration, tokens, and
tool-use count. Incomplete runs and runs missing a timestamp are kept and
tagged rather than dropped.

```
timestamp                  score  band  duration    tokens  tools  status
2026-06-01T09:12:00.000Z   72     warn  18243ms     4821    7      completed
2026-06-04T14:30:00.000Z   —      —     —           —       —      incomplete  [incomplete]
2026-06-09T11:05:00.000Z   88     pass  9120ms      3140    5      completed
```

Flags:

- `--bucket day|week` — aggregate into calendar-day or ISO-week (Monday-start)
  buckets, one row per non-empty bucket with the run count and median composite
  score, tokens, and duration. Incomplete runs count toward the bucket but are
  excluded from the medians.
- `--since <date>` — keep runs on or after the given ISO date (inclusive).
- `--last <n>` — keep only the N most-recent runs. Composes with `--since`
  (the date filter applies first).

A single-run agent renders its one row without implying a trend; an agent with
no runs prints a "no runs" message. Per-run rows for nested runs carry the same
`spawned by <agent>` annotation as `handler show`.

### `handler transcript <agent> <runId>`

Render the full turn-by-turn transcript of a single run: the task prompt it
received, each assistant turn, and every tool call with its input and result.
It reads straight from the run's locally stored sub-transcript — no network. A
run with no recorded sub-transcript (e.g. an interrupted run) can't be shown and
the command exits non-zero with an explanation.

Flags:

- `--latest` — use the agent's most-recent run, so you needn't copy a run id
  from `handler show` first (`handler transcript code-reviewer --latest`).
- `--full` — disable the default truncation of large tool outputs (each tool
  result is otherwise capped at ~2 KB).

The same per-run transcript is browsable in the GUI (`handler gui`).

### `handler note set|show|edit <agent>`

Attach a freeform note to an agent, keyed on the agent's identity so the note
survives renames, edits, and deletions.

- `handler note set <agent>` — set the note from `--body` or piped stdin.
- `handler note show <agent>` — print the note.
- `handler note edit <agent>` — edit the note in `$EDITOR`.

The note also renders inline in `handler show`.

### `handler diff <agent>`

Show the metric impact of each change to an agent's definition — how the agent's
scores and metrics moved across successive definition snapshots.

### `handler insights`

Print a categorized summary across all known agents so you can triage your
roster at a glance — which agents are **unused**, **failing**, or **expensive**.
When an agent's history is too thin to judge, it's labeled low-confidence rather
than flagged misleadingly.

### `handler gui`

Launch a local browser GUI to browse your roster, run history, per-run scores,
conventions results, notes, and per-run transcripts visually instead of through
the CLI. It starts a local server — all logic stays in handler's core; the
browser only renders — and prints the URL to open.

Flags:

- `-p, --port <port>` — port to listen on (default `4242`).

### `handler judge <agent> <runId>`

Invoke the Tier C LLM judge on a single run (opt-in). It prints a pre-flight
warning that the run's output and definition content will be sent to an external
model, and waits for confirmation before making any network call — declining
aborts with nothing sent and no state changed. On confirmation it asks the judge
whether the run fulfilled the agent's stated role and stores the verdict and the
judge's reasoning as a segregated Tier C annotation.

Flags:

- `--yes` / `--confirm` — skip the interactive confirmation (for non-interactive
  use). The judge still only runs because you asked it to.

The judge needs an Anthropic API key in `ANTHROPIC_API_KEY` (see
[Judged quality (Tier C)](#judged-quality-tier-c)). A failed call leaves existing
scores and annotations untouched.

### `handler anchor <agent> <runId> --score <pass|fail> --reasoning <text>`

Mark a past run as a ground-truth calibration anchor for the Tier C judge —
your own verdict and reasoning for that run. Anchors are user-created only and,
when present for an agent, are supplied to the judge as few-shot examples so its
verdicts track your judgment. The judge still produces a signal with no anchors.

## Judged quality (Tier C)

Tier C is an interpretive signal, distinct from handler's deterministic scoring.
Where Tier A/B measure behavioral conformance and resource outliers, Tier C asks
an LLM judge a single question: _did this run fulfill the agent's own stated role?_
The verdict (`pass`/`fail`) and the judge's reasoning are stored as a versioned
annotation keyed by agent identity + run id + rubric version, and rendered in
`handler show` as a clearly labeled section of its own.

Three properties are guaranteed:

- **Opt-in.** Tier C never runs during ingestion, scoring, or any other command.
  It runs only when you invoke `handler judge`, and only after you confirm the
  pre-flight warning. Everything else in handler works with Tier C never invoked.
- **Never blended.** The Tier C verdict is never merged into the 0–100 composite,
  the band, or any Tier A/B annotation. It lives in its own store and its own
  display section.
- **Auditable.** Each annotation records the verdict, the judge's reasoning, the
  rubric version, and a timestamp. A rubric change adds a new annotation rather
  than rewriting history.

You supply your own model access — handler structures the call and stores the
result, but does not manage or host a model. Set `ANTHROPIC_API_KEY` in your
environment; the judge defaults to `claude-sonnet-4-6`.

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

| Variable              | Overrides                                                                       |
| --------------------- | ------------------------------------------------------------------------------- |
| `HANDLER_REGISTRY`    | Source registry file (default `~/.handler/sources.json`).                       |
| `HANDLER_STORE`       | Run store (default `~/.handler/runs.json`).                                     |
| `HANDLER_SCORES`      | Score store (default `~/.handler/scores.json`).                                 |
| `HANDLER_TIERB`       | Tier B reference-relative store (default `~/.handler/tier-b.json`).             |
| `HANDLER_TIERC`       | Tier C annotation store (default `~/.handler/tier-c.json`).                     |
| `HANDLER_NOTES`       | Per-agent note store (default `~/.handler/notes.json`).                         |
| `HANDLER_CONVENTIONS` | Conventions artifact (default `~/.handler/conventions.json`).                   |
| `HANDLER_PROJECTS`    | Claude Code transcripts root (default `~/.claude/projects`).                    |
| `ANTHROPIC_API_KEY`   | API key for the opt-in Tier C judge (no default; required for `handler judge`). |

## How it works

handler is built as a core library (`src/core/`) behind a thin CLI (`src/cli/`), so a
future GUI can consume the same API. It relies only on Claude Code's on-disk data:
transcripts under `~/.claude/projects/`, with each subagent run isolated to its own
`subagents/agent-<id>.jsonl` and attributed deterministically via the parent session's
`Task` result. Agent identity is the tuple `(source-type, normalized-source-path, name)`,
and each run snapshots the definition's _content_ so history survives renames and edits.
Nested runs — subagents a subagent spawns — are discovered by walking those sidechain
files recursively; each nested run attributes to its own agent (no roll-ups) and records
a pointer to its parent so `show`/`trend` can annotate it `spawned by <agent>`. The
`handler transcript` view reads the same per-run sidechain file directly.

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
