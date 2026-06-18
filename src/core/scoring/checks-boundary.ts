/**
 * Write- and path/scope-boundary checks (spec Reqs 8, 12).
 *
 * The implicit scope of a run is its `cwd` and subtree. A boundary violation is
 * any write/edit or destructive `Bash` whose resolved target falls outside that
 * subtree; reads are never checked. Bash destructiveness is recognised from a
 * fixed command set plus output redirections, with fd-dups (`2>&1`) and `/dev`
 * sinks excluded so ordinary `… 2>/dev/null` runs don't read as violations.
 *
 * Targets resolve lexically against `cwd` (no filesystem access — recorded
 * paths may no longer exist). Known limitation: a `cd` inside a Bash command is
 * not tracked, so targets are judged against the run's `cwd`, not a shell-local
 * directory.
 */
import { basename, isAbsolute, relative, resolve } from 'node:path';

import type { RunActivity, ToolCall } from './activity';

export interface BoundaryViolation {
  readonly tool: string;
  /** The resolved out-of-bounds target path. */
  readonly path: string;
}

export interface BoundaryChecks {
  readonly violations: readonly BoundaryViolation[];
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const DESTRUCTIVE_CMDS = new Set([
  'rm',
  'rmdir',
  'unlink',
  'mv',
  'cp',
  'dd',
  'truncate',
  'shred',
  'mkdir',
  'touch',
]);
const REDIRECT_OP = /^\d*>>?$/;
const REDIRECT_ATTACHED = /^\d*>>?(.+)$/;

/** Flag write/edit/destructive-Bash targets that escape the run's cwd subtree. */
export function boundaryChecks(activity: RunActivity, cwd: string | undefined): BoundaryChecks {
  if (cwd === undefined) {
    return { violations: [] };
  }
  const root = resolve(cwd);
  const violations: BoundaryViolation[] = [];
  for (const call of activity.toolCalls) {
    for (const target of targetsOf(call)) {
      const resolved = resolve(root, target);
      if (!isWithin(root, resolved)) {
        violations.push({ tool: call.name, path: resolved });
      }
    }
  }
  return { violations };
}

/** Candidate write targets of a tool call; `[]` for reads and unknown tools. */
function targetsOf(call: ToolCall): string[] {
  if (WRITE_TOOLS.has(call.name)) {
    return typeof call.input.file_path === 'string' ? [call.input.file_path] : [];
  }
  if (call.name === 'NotebookEdit') {
    return typeof call.input.notebook_path === 'string' ? [call.input.notebook_path] : [];
  }
  if (call.name === 'Bash' && typeof call.input.command === 'string') {
    return bashTargets(call.input.command);
  }
  return [];
}

/** Resolve destructive + redirection write targets across a command's segments. */
function bashTargets(command: string): string[] {
  const targets: string[] = [];
  for (const segment of command.split(/\s*(?:&&|\|\||[;\n|&])\s*/)) {
    const tokens = tokenize(segment);
    targets.push(...redirectionTargets(tokens), ...commandTargets(tokens));
  }
  return targets.filter(isRealPathTarget);
}

/** Split a command segment into tokens, stripping surrounding quotes. */
function tokenize(segment: string): string[] {
  const matches = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^["']|["']$/g, ''));
}

/** Files written via `>`/`>>` redirection (detached or attached to the operator). */
function redirectionTargets(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    if (REDIRECT_OP.test(token)) {
      const next = tokens[i + 1];
      if (next !== undefined) {
        out.push(next);
        i += 1;
      }
      continue;
    }
    const attached = REDIRECT_ATTACHED.exec(token);
    if (attached?.[1] !== undefined) {
      out.push(attached[1]);
    }
  }
  return out;
}

/** Path arguments of a destructive command (`of=` for `dd`, non-flags otherwise). */
function commandTargets(tokens: readonly string[]): string[] {
  const command = basename(tokens[0] ?? '');
  if (!DESTRUCTIVE_CMDS.has(command)) {
    return [];
  }
  const out: string[] = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    if (token.startsWith('-') || REDIRECT_OP.test(token) || REDIRECT_ATTACHED.test(token)) {
      continue;
    }
    if (command === 'dd') {
      const of = /^of=(.+)$/.exec(token);
      if (of?.[1] !== undefined) {
        out.push(of[1]);
      }
      continue;
    }
    out.push(token);
  }
  return out;
}

/** Drop fd-dups (`&1`), `/dev` sinks, and empties — not real file targets. */
function isRealPathTarget(target: string): boolean {
  return target.length > 0 && !target.startsWith('&') && !target.startsWith('/dev/');
}

/** True when `descendant` is `ancestor` or lies within its subtree. */
function isWithin(ancestor: string, descendant: string): boolean {
  const rel = relative(ancestor, descendant);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
