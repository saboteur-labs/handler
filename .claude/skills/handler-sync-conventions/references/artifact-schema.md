# Conventions artifact schema (the handler contract)

handler reads exactly this shape from `~/.handler/conventions.json`. The skill
owns *conforming* to it; handler's `loadConventions`
(`src/core/conventions/conventions-store.ts`) owns *validating* it. Anything that
fails validation degrades to a `missing` sentinel on handler's side, so the
artifact must match precisely.

## Shape

```json
{
  "version": 1,
  "sourceHash": "<sha256 hex over the rule set>",
  "lastSynced": "<ISO-8601 timestamp>",
  "rules": {
    "requiredKeys": ["name", "description"],
    "allowedKeys": ["name", "description", "tools", "model"],
    "descriptionMinLength": 40,
    "cuePatterns": ["use when", "when the user", "use proactively"]
  }
}
```

- `version` — must equal handler's `CONVENTIONS_STORE_VERSION` (currently `1`).
  A different value degrades to `version-mismatch`. The bundled script sets this.
- `sourceHash` — integrity hash over the rule set; see below. The script computes
  it. handler recomputes it and reports `hash-mismatch` if it differs, which is
  how a hand-edited artifact is caught.
- `lastSynced` — ISO-8601 timestamp of this sync. handler's 30-day TTL is measured
  from here; an unparseable value reads as `expired`. The script stamps it.
- `rules` — the distilled standard. All four fields are required; each must be the
  right type or the whole artifact degrades to `missing`.

## What each rule drives (handler's checks 16a–e)

| Rule field | handler check | Meaning |
|---|---|---|
| `requiredKeys` | 16a | Frontmatter must declare these keys. |
| (filename vs `name`) | 16b | `name` is kebab-case and equals the file stem. |
| `descriptionMinLength`, `cuePatterns` | 16c | `description` is non-empty, ≥ the min length, and contains ≥1 cue. |
| (`tools` present) | 16d | A non-empty `tools` scope is declared (also the "undeclared-scope" smell). |
| `allowedKeys` | 16e | No frontmatter key outside this set. |

So `requiredKeys` should be a subset of `allowedKeys` (the script enforces this),
and `tools` should normally be in `allowedKeys` even though 16d checks presence
separately — otherwise a definition that correctly declares `tools` would trip
16e.

## The hash contract (must match byte-for-byte)

handler's `hashRules` (`src/core/conventions/staleness.ts`) canonicalizes the rule
set with keys in this exact order and array order preserved, then sha256-hex:

```js
sha256(JSON.stringify({
  allowedKeys,        // arrays preserved in given order
  cuePatterns,
  descriptionMinLength,
  requiredKeys,
}))
```

The bundled `scripts/write-conventions.mjs` reproduces this exactly using Node's
`JSON.stringify` (no spaces) and `node:crypto`. This is why you must use the
script rather than hand-computing: any difference in key order, whitespace, or
array order changes the digest and handler will read the artifact as
`hash-mismatch` even moments after a successful sync.

Because the hash is a pure function of the rule set, re-running the sync over
unchanged docs yields an identical `sourceHash` — only `lastSynced` changes.
