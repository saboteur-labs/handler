/**
 * Canonical `(tool, args)` signature for grouping repeated tool calls.
 *
 * Shared by thrash detection (Feature 3) and error→retry-loop detection
 * (feature-6) so both group identical calls the same way: `Bash` by its trimmed
 * command, every other tool by key-sorted, whitespace-free JSON of its input.
 */
export function toolSignature(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && typeof input.command === 'string') {
    return `Bash ${input.command.trim()}`;
  }
  return `${name} ${canonicalize(input)}`;
}

/** Stable JSON with recursively key-sorted objects and no whitespace. */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])] as const);
    return Object.fromEntries(entries);
  }
  return value;
}
