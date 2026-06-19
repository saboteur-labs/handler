/**
 * Roster enumeration for insights (V1 Feature 4, Task 6).
 *
 * `classifyRoster` buckets zero-run agents into `noHistory`, but it can only
 * see agents it is given. Run-derived rosters (`summarizeAgents`) omit agents
 * that have a definition but no stored runs, so those never reach the bucket.
 *
 * This helper enumerates user-authored agent definitions across the registered
 * sources and returns them as `AgentDescriptor`s, so the CLI can merge them
 * with the run-derived roster (deduped on identity) and surface defined-but-
 * unrun agents under "No History". Builtin/plugin agents are excluded per the
 * user-authored-only invariant; the same agent appearing in multiple sources
 * is collapsed to a single descriptor by identity key.
 */
import { isBuiltinAgent } from '../denylist';
import { agentIdentity, identityKey } from '../identity';
import type { AgentSource } from '../sources/source';
import { enumerateDefinitionNames } from '../sources/source';
import type { AgentDescriptor } from './classify';

/** One descriptor per distinct user-authored definition across `sources`. */
export function enumerateAgentDescriptors(sources: readonly AgentSource[]): AgentDescriptor[] {
  const byKey = new Map<string, AgentDescriptor>();
  for (const source of sources) {
    for (const name of enumerateDefinitionNames(source)) {
      if (isBuiltinAgent(name)) {
        continue;
      }
      const key = identityKey(agentIdentity(source, name));
      if (!byKey.has(key)) {
        byKey.set(key, { identityKey: key, name });
      }
    }
  }
  return [...byKey.values()];
}
