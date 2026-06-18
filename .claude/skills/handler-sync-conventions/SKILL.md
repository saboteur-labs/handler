---
name: handler-sync-conventions
description: >-
  Fetch Anthropic's current Claude Code subagent documentation, distill it into
  handler's conventions-artifact schema, and write ~/.handler/conventions.json
  (with sourceHash + lastSynced) so handler's `conventions` checks run against an
  up-to-date standard. Use this whenever handler reports its conventions as stale,
  missing, expired, or hash-mismatched, or when the user asks to "sync handler
  conventions", "refresh the subagent rules", "update handler's standard", or run
  the handler conventions sync. This is the only part of handler that touches the
  network — handler itself stays offline and only reads the artifact this writes.
---

# Sync handler conventions

handler evaluates user-authored Claude Code subagents against a distilled set of
Anthropic's subagent conventions. handler never fetches anything itself — it only
reads a local artifact at `~/.handler/conventions.json`. This skill is the one
network path: it fetches the current docs, distills them into that artifact, and
writes it atomically. Keeping the fetch here (not in handler) is a hard design
invariant — handler's checks must stay local-only.

## When the artifact is stale

handler prints a staleness header like `conventions: stale (expired) — run the
sync skill to refresh`. The four states all mean "run this skill":

- `missing` — no artifact yet (fresh install).
- `expired` — older than handler's 30-day TTL.
- `hash-mismatch` — the artifact was hand-edited or corrupted.

A `fresh` artifact needs no action.

## Workflow

### 1. Fetch the current subagent docs (required — do not skip)

Use **WebFetch** on Anthropic's Claude Code subagents page:

- Primary: `https://docs.claude.com/en/docs/claude-code/sub-agents`
- Fallback: `https://docs.anthropic.com/en/docs/claude-code/sub-agents`

Ask WebFetch to extract: the required and optional YAML frontmatter fields of a
subagent definition, the rules for the `name` and `description` fields, and any
guidance on how a good `description` signals *when* the agent should be used.

**If the fetch fails (network error, 404 on both URLs, empty body): stop here.**
Do not write anything. handler keeps using its prior artifact — a failed sync
must never replace a good artifact with a partial or empty one. Tell the user the
fetch failed and that the existing conventions are untouched.

### 2. Distill the docs into the rule set

Produce a JSON object with exactly these four fields (see
`references/artifact-schema.md` for the full contract and what each rule drives):

- `requiredKeys` — frontmatter keys every definition must declare. From the docs
  this is `["name", "description"]`. Must be a subset of `allowedKeys`.
- `allowedKeys` — every recognized frontmatter key (required + optional). Today
  the docs define `name`, `description`, `tools`, and `model`. Add a key only if
  the fetched docs actually document it, so handler doesn't flag a legitimate
  field as unrecognized.
- `descriptionMinLength` — minimum `description` length in characters. Default
  `40` unless the docs clearly imply a different floor.
- `cuePatterns` — lowercase substrings that signal a description states *when* to
  use the agent (e.g. the docs' "use proactively", "use when", "when the user").
  Draw these from the phrasing the docs recommend for descriptions.

Keep the distillation conservative and docs-driven: only encode what the docs
actually say. Re-running over unchanged docs should yield the same rules, which
keeps `sourceHash` stable so handler doesn't thrash between `fresh` and
`hash-mismatch`.

### 3. Write the artifact with the bundled script

Pass the distilled rules to the bundled writer — **do not hand-write the JSON or
the hash.** The script computes `sourceHash` with the exact canonicalization
handler uses (`scripts/write-conventions.mjs` mirrors handler's `hashRules`); a
hand-computed hash will read back as `hash-mismatch`. It also writes atomically
(temp file + rename) and validates the rules first, so a malformed rule set exits
non-zero *before* replacing the existing artifact.

```bash
# Save the distilled rules to a temp file, then run the bundled writer.
# Resolve the script from this skill's base directory (printed when the skill loads):
node <skill-base-dir>/scripts/write-conventions.mjs /tmp/handler-rules.json
# (writes ~/.handler/conventions.json by default; pass --out <path> to override)
```

The script prints the destination path and the computed `sourceHash`.

### 4. Confirm and report

Tell the user the artifact was written, where, and a one-line summary of the rule
set (required keys, allowed keys, min description length, number of cue patterns).
They can verify with `handler conventions`, which should now print
`conventions: fresh`.

## Dry run

To produce an artifact without overwriting the real one, pass `--out` to a temp
path, e.g. `--out /tmp/conventions.json`. The result is a complete, schema-valid
artifact that handler's loader accepts (it loads without the "malformed" or
"version-mismatch" degrade paths) — useful for checking distillation before
committing it to `~/.handler/`.
