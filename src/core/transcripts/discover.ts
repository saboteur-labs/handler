/**
 * Transcript discovery (spec Req 1).
 *
 * Claude Code stores each session's parent transcript as
 * `<projectsRoot>/<encoded-project>/<sessionId>.jsonl`. A subagent run's
 * sidechain transcript lives one level deeper, under
 * `<encoded-project>/<sessionId>/subagents/agent-<agentId>.jsonl`. Ingestion
 * attributes runs from the *parent* sessions (the `Task` results), so this
 * walk lists only the `.jsonl` files sitting directly inside each project dir
 * — sidechains are a directory level deeper and are excluded structurally,
 * not by name-matching.
 */
import { type Dirent, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default projects root: `~/.claude/projects`. */
export function defaultProjectsRoot(home: string = homedir()): string {
  return join(home, '.claude', 'projects');
}

/**
 * Return the absolute paths of all parent-session transcripts under
 * `projectsRoot`, sorted for deterministic output. A missing or empty root
 * yields `[]`. Per-run subagent sidechain files and non-`.jsonl` entries are
 * excluded.
 */
export function discoverTranscripts(projectsRoot: string = defaultProjectsRoot()): string[] {
  const transcripts: string[] = [];
  for (const project of readDirEntries(projectsRoot)) {
    if (!project.isDirectory()) {
      continue;
    }
    const projectDir = join(projectsRoot, project.name);
    for (const entry of readDirEntries(projectDir)) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        transcripts.push(join(projectDir, entry.name));
      }
    }
  }
  return transcripts.sort();
}

/** List directory entries, treating a missing directory as empty. */
function readDirEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (isNotFound(err)) {
      return [];
    }
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
