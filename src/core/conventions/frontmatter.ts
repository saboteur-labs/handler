/**
 * Frontmatter key/value parser for static convention checks (spec Req 16).
 *
 * Parses a definition snapshot's frontmatter into an ordered map of declared
 * top-level keys → raw scalar values. It distinguishes "no frontmatter" from
 * "empty frontmatter" via {@link Frontmatter.present}, supporting 16a
 * (name/description present), 16b (name value), 16c (description value) and
 * 16e (key enumeration for unrecognized-key detection). `tools` presence (16d)
 * is handled separately by `parseToolScope`.
 *
 * Minimal YAML only: top-level `key: value` scalars, with surrounding quotes
 * stripped. Nested/block values are captured as raw text, not deep-parsed.
 * Reuses `extractFrontmatter` and never throws on malformed input.
 */

import { extractFrontmatter } from '../scoring/scope';

export interface Frontmatter {
  /** True when a frontmatter block was present between fences, even if empty. */
  readonly present: boolean;
  /** Declared top-level keys in first-seen order. */
  readonly keys: readonly string[];
  /** Map of top-level key → raw scalar value (raw text for block/nested values). */
  readonly values: ReadonlyMap<string, string>;
}

const ABSENT: Frontmatter = { present: false, keys: [], values: new Map() };

/** Matches a top-level `key: value` line (no leading whitespace). */
const KEY_LINE = /^([A-Za-z0-9_-]+):(.*)$/;

/** Parse the frontmatter of a definition snapshot (or `null` orphan). */
export function parseFrontmatter(snapshot: string | null): Frontmatter {
  if (snapshot === null) {
    return ABSENT;
  }
  const frontmatter = extractFrontmatter(snapshot);
  if (frontmatter === null) {
    return ABSENT;
  }

  const lines = frontmatter.split(/\r?\n/);
  const keys: string[] = [];
  const values = new Map<string, string>();

  for (let i = 0; i < lines.length; i += 1) {
    const match = KEY_LINE.exec(lines[i] ?? '');
    if (match === null) {
      continue;
    }
    const key = match[1] ?? '';
    const inline = (match[2] ?? '').trim();
    const value = inline === '' ? blockValue(lines, i + 1) : unquote(inline);
    if (!values.has(key)) {
      keys.push(key);
    }
    values.set(key, value);
  }

  return { present: true, keys, values };
}

/** Collect indented continuation lines from `start` as a raw (verbatim) block value. */
function blockValue(lines: readonly string[], start: number): string {
  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/^\s+\S/.test(line)) {
      break;
    }
    collected.push(line);
  }
  return collected.join('\n');
}

/** Strip a single pair of surrounding single or double quotes. */
function unquote(value: string): string {
  const match = /^(['"])(.*)\1$/.exec(value);
  return match?.[2] ?? value;
}
