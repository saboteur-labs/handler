/**
 * Definition parsing prerequisites for static assessment (feature-static-assessment
 * FR-7, FR-8).
 *
 * `extractBody` exposes the system-prompt body — the content after the
 * frontmatter block's closing fence — as a distinct string for body-level
 * checks (prompt structure, size). `parseDefinition` aggregates a snapshot's
 * frontmatter (`name`/`description`/`model`), tool scope (including spawn
 * targets), and body into a single `ParsedDefinition` so the check registry
 * has one shape to evaluate against. Both are pure and never throw, per the
 * `string | null` orphan convention used throughout (`src/core/snapshot.ts`).
 */
import { parseFrontmatter } from '../conventions/frontmatter';
import type { ToolScope } from '../scoring/scope';
import { parseToolScope } from '../scoring/scope';

/** Matches the leading `---\n...\n---` frontmatter fence block. */
const FRONTMATTER_BLOCK = /^\s*---\r?\n[\s\S]*?\r?\n---/;

/**
 * The content of a definition snapshot after its frontmatter block. Returns
 * an empty string when the snapshot is `null` (orphan), frontmatter-only
 * (nothing after the closing fence), or malformed (no frontmatter block
 * found) — never throws.
 */
export function extractBody(snapshot: string | null): string {
  if (snapshot === null) {
    return '';
  }
  const withoutBom = snapshot.charCodeAt(0) === 0xfeff ? snapshot.slice(1) : snapshot;
  const match = FRONTMATTER_BLOCK.exec(withoutBom);
  if (match === null) {
    return '';
  }
  const after = withoutBom.slice(match.index + match[0].length).replace(/^\r?\n/, '');
  return after.trim() === '' ? '' : after;
}

/** Aggregated view of a definition snapshot for the static-check registry. */
export interface ParsedDefinition {
  /** The `name` frontmatter value, if present. */
  readonly name: string | undefined;
  /** The `description` frontmatter value, if present. */
  readonly description: string | undefined;
  /** The `model` frontmatter value, if present. */
  readonly model: string | undefined;
  /** The declared/granted/spawn-target tool scope. */
  readonly scope: ToolScope;
  /** The system-prompt body (content after the frontmatter block). */
  readonly body: string;
  /**
   * True when the snapshot had a frontmatter block between fences (even an
   * empty one) — sourced from `parseFrontmatter`'s authoritative `present`
   * flag, not proxied from whether any particular key parsed. `prompt/empty-body`
   * needs this to distinguish "frontmatter present, body missing" (its concern)
   * from "no frontmatter at all" (a `conventions` 16a concern).
   */
  readonly hasFrontmatter: boolean;
  /**
   * Opaque per-source discriminator, e.g. a normalized source root path or a
   * `${sourceType}:${sourcePath}` composite (feature-static-assessment FR-15).
   * `ParsedDefinition` is otherwise derived purely from snapshot text and has
   * no notion of which registered source (user-level vs. a specific repo) a
   * definition came from — `fleet/duplicate-definition` needs that to tell
   * "same name, different source" apart from "same name, same source" (a
   * plain re-parse of the same definition). The caller (the `assess`
   * orchestrator) is responsible for populating this from the real
   * `AgentSource`; `parseDefinition` itself has no notion of sources and
   * merely threads the value through. Left `undefined` when the caller
   * doesn't supply one (e.g. in unit tests), in which case checks that key
   * off it MUST treat that as "cannot prove different sources" rather than
   * guessing.
   */
  readonly sourceKey?: string;
}

/**
 * Parse a definition snapshot (or `null` orphan) into a `ParsedDefinition`.
 *
 * `sourceKey` is an optional opaque discriminator identifying which
 * registered source (user-level, or a specific repo) this snapshot came
 * from — see `ParsedDefinition.sourceKey`. `parseDefinition` does not
 * interpret it; it only threads it through into the returned object.
 */
export function parseDefinition(snapshot: string | null, sourceKey?: string): ParsedDefinition {
  const frontmatter = parseFrontmatter(snapshot);
  return {
    name: frontmatter.values.get('name'),
    description: frontmatter.values.get('description'),
    model: frontmatter.values.get('model'),
    scope: parseToolScope(snapshot),
    body: extractBody(snapshot),
    hasFrontmatter: frontmatter.present,
    sourceKey,
  };
}
