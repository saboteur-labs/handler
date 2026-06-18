/**
 * Tool-scope checks (spec Reqs 12, 13, 15).
 *
 * Compares the tools a run actually used against the agent's declared `tools`
 * scope: tool-scope adherence (used but not granted) and tool-utilization
 * (granted but never used). When the definition declares no usable scope, both
 * checks are not-applicable and the run is flagged "undeclared scope" — the
 * score then leans on the boundary checks instead (Req 15).
 */
import type { RunActivity } from './activity';
import type { ToolScope } from './scope';

export interface ScopeChecks {
  /** False when scope is undeclared — adherence/utilization don't apply. */
  readonly applicable: boolean;
  readonly undeclaredScope: boolean;
  /** Tools the run used that the scope does not grant (adherence). */
  readonly unauthorizedTools: readonly string[];
  /** Granted tools the run never used (utilization). */
  readonly unusedTools: readonly string[];
}

/** Compute the scope checks for one run against its definition's tool scope. */
export function scopeChecks(activity: RunActivity, scope: ToolScope): ScopeChecks {
  if (!scope.declared) {
    return { applicable: false, undeclaredScope: true, unauthorizedTools: [], unusedTools: [] };
  }

  const used = new Set(activity.toolCalls.map((call) => call.name));
  const unauthorizedTools = [...used].filter((tool) => !scope.granted.has(tool)).sort();
  const unusedTools = [...scope.granted].filter((tool) => !used.has(tool)).sort();

  return { applicable: true, undeclaredScope: false, unauthorizedTools, unusedTools };
}
