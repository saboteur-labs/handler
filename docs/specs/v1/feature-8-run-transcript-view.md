# Feature Spec: Run Transcript View (V1 Feature 8)

**Source:** `docs/spec-v1.md` (new scope beyond Reqs 22–44) · US-18
**Status:** Draft
**Requirement numbering:** continues from `docs/spec-v1.md`; requirements for this feature begin at Req 45.
**Dependencies:** Feature 6 (GUI shell / SPA) — the GUI transcript surface (Req 53) requires the Feature 6 per-agent detail and run-detail area to be in place.

## Overview

handler captures rich per-run data but surfaces only derived metrics — scores, token counts, latency, files-edited count, retry count. A developer debugging an agent's behavior or investigating a low-scoring run has no way to see what the agent actually did: what task it received, what it said, or what tools it called and got back. This feature adds a `handler transcript <agent> <runId>` CLI command and a transcript panel in the Feature 6 GUI (per-agent detail / run-detail area), both backed by the same core `readTranscript` function. The command and panel render a run's full conversation: the task prompt, the agent's assistant text turns, and its tool calls with inputs and results — all from the locally-stored sidechain JSONL already resolved at `run.sidechainPath`.

## Goals

- A developer can view the full conversation of any stored run — task prompt, assistant turns, tool calls and results — from both the CLI and the GUI per-agent / run-detail view.
- The transcript data is returned as a structured, renderable model from `src/core/`, consumed by a thin CLI renderer and the GUI (Feature 6); neither surface holds logic of its own.
- Large tool outputs are truncated by default with an explicit opt-in to view the full payload, so routine inspection stays readable.
- A developer can identify a run to inspect using the `runId` already surfaced by `handler show` and `handler trend`, or a `--latest` shorthand.
- The feature stays fully local, read-only, and requires no new ingestion or network calls.

## Non-goals

- Not a new ingestion path — the sidechain file is already resolved at ingest time (`run.sidechainPath`).
- No redaction, masking, or content-policy filtering — this is local data the developer already owns; trust is implicit.
- No editing or annotation of transcript content from this command (observe-only).
- No search or filtering within a transcript in the initial cut (deferred).
- No export to file formats (JSON, HTML, Markdown) in the initial cut (deferred).

## User stories

- **US-18** [v1] As an agent author, I want to view the actual conversation of a specific run — the task prompt, assistant turns, and tool activity — so I can understand what my agent did and why it scored the way it did.

## Functional requirements

### Core transcript model (Req 45)

45. The system MUST provide a core library function — `readTranscript(sidechainPath)` or equivalent — that parses a run's sidechain JSONL and returns a structured `RunTranscript` model containing, in order: the task prompt (from the first `user` entry's non-`tool_result` text content), an ordered sequence of turns, and each turn's components: assistant `text` blocks (the agent's prose output), `tool_use` blocks (`name`, `input`), and the corresponding `tool_result` blocks (`tool_use_id`, `is_error`, `content`) from the following `user` entry. [US-18]

46. The function MUST be implemented in `src/core/` and MUST hold no CLI rendering logic. It MUST return empty/partial results rather than throwing when the sidechain is missing or malformed, consistent with the parse-defensively invariant. [US-18]

47. Each tool-result content string in the returned model MUST be truncated to a configurable byte limit (default 2 048 bytes) in the standard model, with a flag on the model indicating truncation occurred. The caller MAY request the full payload via an options argument to disable truncation. [US-18] _(OQ-TR-1 resolved)_

### CLI command (Req 46)

48. The system MUST provide a `handler transcript <agent> <runId>` CLI command that locates the stored run by agent name and run id, resolves its `sidechainPath`, calls the core transcript function, and renders the result to stdout. [US-18]

49. The CLI command MUST support a `--latest` flag as a shorthand for the most-recent run of the named agent, so a developer can inspect the last run without first running `handler show` to retrieve a run id. [US-18] _(OQ-TR-2 resolved)_

50. The CLI command MUST support a `--full` flag (or equivalent) that disables tool-output truncation, rendering the complete payload for all tool results. [US-18] _(OQ-TR-1 resolved)_

51. The CLI command MUST render clearly distinguished sections for: (a) a header with run metadata (agent name, run id, timestamp, status); (b) the task prompt; (c) each assistant turn in order, with tool calls and their results interleaved; and (d) a footer with the run's stop reason. When the sidechain is unavailable (the run is tagged `incomplete` or `orphan`), the command MUST emit an informative message and exit non-zero rather than rendering a blank or partial transcript. [US-18]

52. The CLI command MUST be read-only: it MUST NOT alter stored runs, scores, annotations, or agent definitions. [US-18]

### GUI surface (Req 47)

53. The per-agent detail / run-detail area in the Feature 6 GUI MUST surface a transcript panel for each run entry, consuming the same `readTranscript` core function and holding no parsing or logic of its own. This panel is a required deliverable of this feature and depends on the Feature 6 GUI shell being in place. [US-18] _(OQ-TR-3 resolved)_

## Open questions

- **OQ-TR-1: Tool-output truncation.** RESOLVED. Truncate tool-result content to 2 048 bytes by default; surface a truncation indicator; `--full` disables truncation. The limit is configurable via options, not hard-coded. _(Resolved in Reqs 47, 50.)_
- **OQ-TR-2: Run selection shorthand.** RESOLVED. `runId` from `show`/`trend` is the primary selector; `--latest` is a supported shorthand for the most-recent run of the named agent. _(Resolved in Req 49.)_
- **OQ-TR-3: GUI surface.** RESOLVED — CHANGED from proposal. The GUI transcript panel is a MUST (required deliverable), not a deferred SHOULD. Both the CLI renderer and the GUI panel consume the shared `readTranscript` core function; neither holds logic. Feature 6 (GUI shell) is an explicit dependency of this feature. _(Resolved in Req 53; dependency noted in document header.)_
- **OQ-TR-4: Default verbosity — full turn-by-turn vs. summarized.** RESOLVED. Full turn-by-turn is the default; the only compression is tool-output truncation (OQ-TR-1). A summary or collapsible mode is deferred.

## Out of scope (deferred)

- Search or filtering within a single transcript (v2).
- Export to file formats — JSON, HTML, Markdown (v2).
- Summary or collapsible view of long transcripts (v2).
- Redaction or content-policy filtering of tool payloads (explicitly not a requirement; local data the developer owns).
- Diff view between two runs of the same agent (v2).
