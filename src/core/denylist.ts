/**
 * Built-in / plugin agent denylist (spec Req 3).
 *
 * handler reports only on user-authored agents. Runs whose `agentType` names a
 * built-in Claude Code agent are excluded from attribution. The set is
 * centralized here so it can grow as Claude Code adds built-ins.
 */

/** Known built-in Claude Code agent names, excluded from attribution. */
export const BUILTIN_AGENT_NAMES: ReadonlySet<string> = new Set([
  'general-purpose',
  'statusline-setup',
  'output-style-setup',
  'Explore',
  'Plan',
]);

/**
 * True when `name` is a built-in (or otherwise denylisted) agent that must be
 * excluded from attributed results. Matches exactly: built-in names are recorded
 * verbatim in transcripts, and user agents must not reuse a reserved name.
 */
export function isBuiltinAgent(name: string): boolean {
  return BUILTIN_AGENT_NAMES.has(name);
}
