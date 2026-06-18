/**
 * Source registry (spec Req 5).
 *
 * Persists the set of agent sources the user has registered (user-level and
 * per-repo) so repo-scoped agents are tracked without hand-configuring paths.
 * Sources are stored as `{type, root}` and rebuilt into `AgentSource` on load;
 * registration dedupes on the normalized `(type, root)`. The store is read once
 * per instance, so a fresh `SourceRegistry` reflects what is on disk.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { readJsonFile, writeJsonFile } from '../store/json-store';
import type { AgentSource, SourceType } from './source';
import { repoSource, userSource } from './source';

interface StoredSource {
  readonly type: SourceType;
  readonly root: string;
}

interface RegistryFile {
  readonly version: 1;
  readonly sources: StoredSource[];
}

const STORE_VERSION = 1;

/** Default registry location: `~/.handler/sources.json`. */
export function defaultRegistryPath(): string {
  return join(homedir(), '.handler', 'sources.json');
}

export class SourceRegistry {
  private readonly filePath: string;
  private readonly sources: AgentSource[];

  constructor(filePath: string = defaultRegistryPath()) {
    this.filePath = filePath;
    this.sources = extractSources(readJsonFile<unknown>(filePath, null)).map(rebuild);
  }

  /** Register a source. Re-registering an equivalent source is a no-op. */
  register(source: AgentSource): void {
    if (this.sources.some((existing) => sameSource(existing, source))) {
      return;
    }
    this.sources.push(source);
    this.persist();
  }

  /** All registered sources, in registration order. */
  list(): AgentSource[] {
    return [...this.sources];
  }

  private persist(): void {
    const file: RegistryFile = {
      version: STORE_VERSION,
      sources: this.sources.map((source) => ({ type: source.type, root: source.root })),
    };
    writeJsonFile(this.filePath, file);
  }
}

function sameSource(a: AgentSource, b: AgentSource): boolean {
  return a.type === b.type && a.root === b.root;
}

function rebuild(stored: StoredSource): AgentSource {
  return stored.type === 'user' ? userSource(stored.root) : repoSource(stored.root);
}

function extractSources(raw: unknown): StoredSource[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const sources = (raw as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources.filter(isStoredSource);
}

function isStoredSource(value: unknown): value is StoredSource {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.type === 'user' || candidate.type === 'repo') && typeof candidate.root === 'string'
  );
}
