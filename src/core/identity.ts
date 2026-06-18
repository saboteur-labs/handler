/**
 * Agent identity (spec Req 8).
 *
 * An agent is identified by the tuple (source-type, normalized-source-path,
 * name), so identically-named agents in different sources stay distinct. The
 * serialized `identityKey` is the deterministic join key that per-run scores
 * (Feature 3) and notes (Feature 5) hang off of, so it must be stable across
 * runs and process restarts — keep its format pinned.
 */
import type { AgentSource, SourceType } from './sources/source';

export interface AgentIdentity {
  readonly sourceType: SourceType;
  /** Normalized source root (see `AgentSource.root`). */
  readonly sourcePath: string;
  readonly name: string;
}

/** Build an agent identity from the source it was resolved against and its name. */
export function agentIdentity(source: AgentSource, name: string): AgentIdentity {
  return { sourceType: source.type, sourcePath: source.root, name };
}

/**
 * Deterministic, collision-free serialization of an identity. Encodes the tuple
 * as a fixed-order JSON array so components containing delimiter-like characters
 * (e.g. a `:` or `"` in a path) cannot alias. Stable across Node versions and
 * runs; treat the format as a persisted contract.
 */
export function identityKey(identity: AgentIdentity): string {
  return JSON.stringify([identity.sourceType, identity.sourcePath, identity.name]);
}

/** Two identities are equal iff they serialize to the same key. */
export function identitiesEqual(a: AgentIdentity, b: AgentIdentity): boolean {
  return identityKey(a) === identityKey(b);
}
