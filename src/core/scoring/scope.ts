/**
 * Definition tools-scope parser (spec Req 15).
 *
 * Reads the `tools` frontmatter of an agent definition into the set of tools
 * the agent is granted. A run's tool-scope adherence and utilization checks
 * compare against this set; when no usable `tools` scope is declared the score
 * treats those checks as not-applicable and falls back to boundary checks
 * (Req 15). Supports the three forms a definition may use — inline comma list,
 * inline bracket array, and YAML block sequence — and never throws on
 * malformed input.
 *
 * `extractFrontmatter` is exported for reuse by the static convention checks
 * (Feature 4), which need fuller frontmatter parsing.
 */

export interface ToolScope {
  /** True when the definition declares a usable (non-empty) `tools` scope. */
  readonly declared: boolean;
  /** The granted tool names; empty when undeclared. */
  readonly granted: ReadonlySet<string>;
  /**
   * Spawn-target agent names parsed from `Agent(...)` grants in the same
   * `tools:` list (`Agent(a)`, `Agent(a, b)`, `Agent(*)`). The literal `*` is
   * included for a wildcard grant so callers can distinguish "wildcard spawn"
   * from "no spawn grants". Empty when no `Agent(...)` grant is present.
   */
  readonly spawnTargets: ReadonlySet<string>;
}

const UNDECLARED: ToolScope = { declared: false, granted: new Set(), spawnTargets: new Set() };

/** Parse the `tools` scope from a definition snapshot (or `null` orphan). */
export function parseToolScope(snapshot: string | null): ToolScope {
  if (snapshot === null) {
    return UNDECLARED;
  }
  const frontmatter = extractFrontmatter(snapshot);
  if (frontmatter === null) {
    return UNDECLARED;
  }

  const lines = frontmatter.split(/\r?\n/);
  const keyIndex = lines.findIndex((line) => /^tools:/.test(line));
  if (keyIndex === -1) {
    return UNDECLARED;
  }

  const value = (lines[keyIndex] ?? '').replace(/^tools:/, '').trim();
  const names = value === '' ? blockSequence(lines, keyIndex + 1) : inlineList(value);
  const granted = new Set(names.map(cleanName).filter((name) => name.length > 0));
  const spawnTargets = parseSpawnTargets(names);
  return granted.size > 0 ? { declared: true, granted, spawnTargets } : UNDECLARED;
}

/** The text between the leading `---` fences, or `null` when absent/unterminated. */
export function extractFrontmatter(content: string): string | null {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const match = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(withoutBom);
  return match?.[1] ?? null;
}

/**
 * Split an inline list, tolerating a surrounding `[...]`. Commas nested inside
 * `Agent(...)` parens are not split points, so `Agent(a, b)` stays one token
 * (matching a plain comma-split for any input that has no parens).
 */
function inlineList(value: string): string[] {
  const trimmed = value.replace(/^\[/, '').replace(/\]$/, '');
  const names: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of trimmed) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ',' && depth === 0) {
      names.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  names.push(current);
  return names;
}

/** Match a single `Agent(...)` grant token, capturing its inner content. */
const AGENT_GRANT = /^Agent\(\s*(.*?)\s*\)$/;

/** Parse `Agent(...)` grant tokens (from either list form) into spawn targets. */
function parseSpawnTargets(names: readonly string[]): Set<string> {
  const targets = new Set<string>();
  for (const raw of names) {
    const match = AGENT_GRANT.exec(cleanName(raw));
    if (match === null) {
      continue;
    }
    const inner = match[1] ?? '';
    if (inner === '*') {
      targets.add('*');
      continue;
    }
    for (const part of inner.split(',')) {
      const target = cleanName(part);
      if (target.length > 0) {
        targets.add(target);
      }
    }
  }
  return targets;
}

/** Collect the `- item` entries of a YAML block sequence from `start`. */
function blockSequence(lines: readonly string[], start: number): string[] {
  const names: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const match = /^\s*-\s*(.+)$/.exec(lines[i] ?? '');
    if (match?.[1] === undefined) {
      break;
    }
    names.push(match[1]);
  }
  return names;
}

/** Trim whitespace and strip surrounding single or double quotes. */
function cleanName(name: string): string {
  return name.trim().replace(/^['"]|['"]$/g, '');
}
