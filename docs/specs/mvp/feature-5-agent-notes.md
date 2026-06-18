# Feature 5 — Per-agent notes

**Milestone:** MVP. **Requirements covered:** spec Reqs 20, 21 (`docs/spec.md`). **User stories:** US-9.
**Depends on:** Feature 1 (notes key on the agent identity from Req 8). **Branch:** `feat/agent-notes`.

## Overview

An agent author accumulates context about their agents — why one exists, what to watch for, what to try next — that has nowhere to live alongside the agent's run history. Feature 5 lets the user attach a single freeform note to each agent, edit it, and read it both on its own and inline with the agent's history. The note is keyed on the agent identity tuple `(source-type, normalized-source-path, name)`, not a file path, so it survives a renamed, edited, or deleted definition exactly as run snapshots do. This keeps the author's own intent next to the evidence of what the agent actually did, fully offline.

## Goals

- Every agent can carry one freeform text note that the user can set, replace, and read from the CLI.
- A note is bound to the agent's identity, so it persists across runs and survives rename, edit, and deletion of the definition.
- The note is visible both inline in `show <agent>` and via a dedicated note command.
- Notes are stored and read fully offline, with no network calls.

## Non-goals

- No multiple, timestamped, or threaded notes per agent — one editable note only.
- No notes on individual runs, sources, or convention violations — agent-identity scope only.
- No rich text, attachments, or formatting guarantees beyond plain UTF-8 text.
- No syncing, sharing, or export of notes beyond the local store.

## User stories

- As an agent author, I want to attach and read freeform notes on an agent, so my own context and intent live alongside its history. (US-9)

## Functional requirements

1. handler MUST let the user set or replace an agent's note from the CLI; setting a note on an agent that already has one overwrites the prior text. (Req 20)
2. handler MUST accept the note body two ways: supplied directly via a CLI flag/argument (e.g. `--body`/stdin), and edited interactively by launching `$EDITOR` pre-loaded with the current note text. (Req 20)
3. handler MUST provide a dedicated CLI command to read an agent's note, and MUST also surface the note inline in `show <agent>`. (Req 20)
4. handler MUST key each note on the agent identity tuple from Req 8, never on a filename or definition path. (Reqs 20, 21)
5. A note MUST persist across runs and remain attached after its agent's definition is renamed, edited, or deleted, consistent with the identity and snapshot model. (Req 21)
6. handler MUST resolve the note's target agent using the same identity resolution as the rest of the CLI, and MUST report clearly when the named agent is ambiguous or unknown. (Req 8)
7. handler MUST treat an agent with no note as a valid, empty state (read returns "no note"), not an error. (Req 20)
8. handler MUST store and read notes fully offline, making no network calls. (Constraints: local-first)

## Open questions

None identified — note model (single editable note), input methods (`--body`/stdin plus `$EDITOR`), and read surfaces (dedicated command plus inline in `show`) were resolved during specification.

## Out of scope (deferred)

- Multiple or timestamped note entries / a per-agent note history.
- Notes attached to individual runs or to convention findings.
- Deleting agents or pruning notes for agents whose definition is gone.
- Searching or filtering agents by note content.
- Markdown rendering or templated note structure.
