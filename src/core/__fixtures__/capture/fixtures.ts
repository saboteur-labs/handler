/**
 * Real-shape synthetic fixtures for the subagent-run-capture feature (FR-33).
 *
 * The tree beside this file mirrors Claude Code's on-disk layout with entirely
 * synthetic content (no real prompts):
 *
 *   projects/-synthetic-workspace-app/sess-0001.jsonl          parent transcript
 *   projects/.../sess-0001/subagents/agent-<id>.jsonl + .meta.json
 *   projects/.../sess-0001/subagents/workflows/subagents/...   nested run
 *   runlogs/repos/synthetic-app/sess-0001.jsonl                runlog envelopes
 *   runlogs/sessions/sess-0001.jsonl                           pointer file
 *
 * `projects/` is usable as a `projects` root and `runlogs/` as a runlogs root.
 * Runlog payloads hold `__FIXTURE_ROOT__` in transcript paths; use
 * `copyCaptureFixtures` to get a temp copy with real, existing paths.
 *
 * Every agentId in the parent transcript lines up with an on-disk file except
 * `unmatched`, which is deliberately absent. Agent names are user-level except
 * `Explore`, a built-in (see `src/core/denylist.ts`).
 *
 * Unverified shape guesses (not pinned by the spec): the value of meta
 * `requestShape`, the nested-run directory name, and the contents of the
 * runlog pointer file.
 *
 * Builders below are small and documented so later tests can make variants;
 * the committed files were produced from them. Imports are limited to node
 * builtins so the module is loadable by `node --experimental-strip-types`.
 */
import { cpSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = Record<string, unknown>;

const HERE = dirname(fileURLToPath(import.meta.url));

/** Synthetic working directory every fixture run reports. */
export const CAPTURE_CWD = '/synthetic/workspace/app';
export const CAPTURE_SESSION_ID = 'sess-0001';
export const FIXTURE_ROOT_TOKEN = '__FIXTURE_ROOT__';

export const CAPTURE_ROOT = HERE;
export const CAPTURE_PROJECTS_ROOT = join(HERE, 'projects');
export const CAPTURE_RUNLOGS_ROOT = join(HERE, 'runlogs');

const PROJECT_DIR = '-synthetic-workspace-app';
const SUBAGENTS_DIR = join(CAPTURE_PROJECTS_ROOT, PROJECT_DIR, CAPTURE_SESSION_ID, 'subagents');

/** agentIds shared by the parent transcript, sub-transcripts, metas, runlogs. */
export const CAPTURE_AGENT_IDS = {
  /** user agent `code-reviewer`, complete, meta finished:true, one notification */
  reviewer: 'a1111aaaa1111aaaa',
  /** user agent `test-writer`, complete, meta finished absent, resumed (2 notifications) */
  writer: 'a2222bbbb2222bbbb',
  /** built-in `Explore`, complete */
  explore: 'a3333cccc3333cccc',
  /** user agent `doc-writer`, empty sub-transcript */
  empty: 'a4444dddd4444dddd',
  /** user agent `code-reviewer`, malformed sub-transcript, no notification */
  malformed: 'a5555eeee5555eeee',
  /** user agent `planner`, spawnDepth 2, parentAgentId = reviewer */
  nested: 'a7777gggg7777gggg',
  /** task-id in a notification with no on-disk run */
  unmatched: 'a9999iiii9999iiii',
  /** runlog stop with an empty agent_type */
  emptyTypeStop: 'a6666ffff6666ffff',
  /** runlog-only stop whose transcript path does not exist */
  runlogOnly: 'a8888hhhh8888hhhh',
} as const;

const NESTED_DIR = join(SUBAGENTS_DIR, 'workflows', 'subagents');

/** Absolute paths into the committed fixture tree. */
export const capturePaths = {
  parentTranscript: join(CAPTURE_PROJECTS_ROOT, PROJECT_DIR, `${CAPTURE_SESSION_ID}.jsonl`),
  subTranscript: (id: string): string =>
    join(id === CAPTURE_AGENT_IDS.nested ? NESTED_DIR : SUBAGENTS_DIR, `agent-${id}.jsonl`),
  meta: (id: string): string =>
    join(id === CAPTURE_AGENT_IDS.nested ? NESTED_DIR : SUBAGENTS_DIR, `agent-${id}.meta.json`),
  runlog: join(CAPTURE_RUNLOGS_ROOT, 'repos', 'synthetic-app', `${CAPTURE_SESSION_ID}.jsonl`),
  runlogPointer: join(CAPTURE_RUNLOGS_ROOT, 'sessions', `${CAPTURE_SESSION_ID}.jsonl`),
} as const;

// ---- Pinned key sets -------------------------------------------------------

export const META_KEYS = [
  'agentType',
  'launchedWithDefaults',
  'description',
  'toolUseId',
  'spawnDepth',
  'requestShape',
  'requestNonInteractive',
  'finished',
] as const;

export const ASYNC_LAUNCHED_KEYS = [
  'agentId',
  'canReadOutputFile',
  'canContinueAgent',
  'description',
  'isAsync',
  'outputFile',
  'prompt',
  'resolvedModel',
  'status',
] as const;

export const NOTIFICATION_TAGS = ['task-id', 'output-file', 'status', 'summary', 'usage'] as const;

export const SUBAGENT_STOP_KEYS = [
  'session_id',
  'transcript_path',
  'cwd',
  'agent_id',
  'agent_type',
  'agent_transcript_path',
  'last_assistant_message',
  'permission_mode',
  'effort',
  'stop_hook_active',
  'background_tasks',
  'hook_event_name',
] as const;

export const ENVELOPE_KEYS = [
  'v',
  'ts',
  'ts_ms',
  'repo',
  'event',
  'session_id',
  'agent_id',
  'tool_use_id',
  'payload',
] as const;

// ---- Builders --------------------------------------------------------------

/** A meta.json body. Pass `finished: undefined` to omit the key; add `parentAgentId` for nested runs. */
export function buildMeta(o: {
  agentType: string;
  toolUseId: string;
  description?: string;
  spawnDepth?: number;
  parentAgentId?: string;
  finished?: true;
}): Json {
  const meta: Json = {
    agentType: o.agentType,
    launchedWithDefaults: false,
    description: o.description ?? `Synthetic ${o.agentType} task`,
    toolUseId: o.toolUseId,
    spawnDepth: o.spawnDepth ?? 1,
    requestShape: 'agent_tool',
    requestNonInteractive: false,
  };
  if (o.parentAgentId !== undefined) meta.parentAgentId = o.parentAgentId;
  if (o.finished !== undefined) meta.finished = o.finished;
  return meta;
}

/** A parent-entry `toolUseResult` for an async launch. Omit `canContinueAgent` to model the real variant. */
export function buildAsyncLaunchedResult(o: {
  agentId: string;
  description: string;
  canContinueAgent?: boolean;
}): Json {
  const result: Json = {
    agentId: o.agentId,
    canReadOutputFile: true,
    description: o.description,
    isAsync: true,
    outputFile: `/synthetic/tmp/tasks/${o.agentId}.output`,
    prompt: `Synthetic prompt for ${o.description}.`,
    resolvedModel: 'synthetic-model',
    status: 'async_launched',
  };
  if (o.canContinueAgent !== undefined) result.canContinueAgent = o.canContinueAgent;
  return result;
}

/** `<task-notification>` text carrying the pinned tags and a `<usage>` block. */
export function buildTaskNotificationText(o: {
  taskId: string;
  status: string;
  toolUses: number;
  durationMs: number;
  subagentTokens: number;
}): string {
  return [
    '<task-notification>',
    `<task-id>${o.taskId}</task-id>`,
    `<output-file>/synthetic/tmp/tasks/${o.taskId}.output</output-file>`,
    `<status>${o.status}</status>`,
    `<summary>Synthetic agent run ${o.status}</summary>`,
    '<usage>',
    `<subagent_tokens>${o.subagentTokens}</subagent_tokens>`,
    `<tool_uses>${o.toolUses}</tool_uses>`,
    `<duration_ms>${o.durationMs}</duration_ms>`,
    '</usage>',
    '</task-notification>',
  ].join('\n');
}

/** A snake_case SubagentStop payload as Claude Code sends it. Use `agentType: ''` for the empty case. */
export function buildSubagentStopPayload(o: {
  agentId: string;
  agentType: string;
  agentTranscriptPath: string;
  sessionId?: string;
  cwd?: string;
}): Json {
  const sessionId = o.sessionId ?? CAPTURE_SESSION_ID;
  return {
    session_id: sessionId,
    transcript_path: `${FIXTURE_ROOT_TOKEN}/projects/${PROJECT_DIR}/${sessionId}.jsonl`,
    cwd: o.cwd ?? CAPTURE_CWD,
    agent_id: o.agentId,
    agent_type: o.agentType,
    agent_transcript_path: o.agentTranscriptPath,
    last_assistant_message: 'Synthetic final message.',
    permission_mode: 'default',
    effort: 'medium',
    stop_hook_active: false,
    background_tasks: [],
    hook_event_name: 'SubagentStop',
  };
}

/** A runlog recorder envelope wrapping a payload. */
export function buildRunlogEnvelope(o: {
  tsMs: number;
  event: string;
  agentId: string;
  payload: Json;
  repo?: string;
  sessionId?: string;
}): Json {
  return {
    v: 1,
    ts: new Date(o.tsMs).toISOString(),
    ts_ms: o.tsMs,
    repo: o.repo ?? 'synthetic-app',
    event: o.event,
    session_id: o.sessionId ?? CAPTURE_SESSION_ID,
    agent_id: o.agentId,
    tool_use_id: null,
    payload: o.payload,
  };
}

/** Token usage on one assistant turn. */
export interface TurnUsage {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

/**
 * Sub-transcript lines: one user prompt, then per turn an assistant entry (one
 * tool_use block per name in `tools`, plus a user tool_result entry when tools
 * ran). Timestamps are spread evenly so the last minus the first is exactly
 * `durationMs`.
 */
export function buildSubTranscript(o: {
  agentId: string;
  startMs: number;
  durationMs: number;
  turns: { tools: string[]; usage: TurnUsage }[];
}): string {
  const bodies: Json[] = [{ role: 'user', content: 'Synthetic task prompt.' }];
  let n = 0;
  const kinds: ('user' | 'assistant')[] = ['user'];
  for (const turn of o.turns) {
    const content: Json[] = [{ type: 'text', text: 'Synthetic assistant text.' }];
    for (const tool of turn.tools) {
      content.push({ type: 'tool_use', id: `toolu_${o.agentId}_${n++}`, name: tool, input: {} });
    }
    bodies.push({
      role: 'assistant',
      content,
      usage: {
        input_tokens: turn.usage.input,
        cache_read_input_tokens: turn.usage.cacheRead,
        cache_creation_input_tokens: turn.usage.cacheCreation,
        output_tokens: turn.usage.output,
      },
    });
    kinds.push('assistant');
    if (turn.tools.length > 0) {
      bodies.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: `toolu_${o.agentId}_${n - 1}`, content: 'ok' },
        ],
      });
      kinds.push('user');
    }
  }
  const last = bodies.length - 1;
  return (
    bodies
      .map((message, i) =>
        JSON.stringify({
          parentUuid: i === 0 ? null : `${o.agentId}-u${i - 1}`,
          isSidechain: true,
          userType: 'external',
          cwd: CAPTURE_CWD,
          sessionId: CAPTURE_SESSION_ID,
          version: '0.0.0-synthetic',
          agentId: o.agentId,
          type: kinds[i],
          message,
          uuid: `${o.agentId}-u${i}`,
          timestamp: new Date(
            o.startMs + (last === 0 ? 0 : Math.round((o.durationMs * i) / last)),
          ).toISOString(),
        }),
      )
      .join('\n') + '\n'
  );
}

// ---- Test-only oracle helpers ---------------------------------------------

/** Values derived from a sub-transcript, comparable to a notification `<usage>`. */
export interface ExpectedRunValues {
  toolUseCount: number;
  durationMs: number;
  /** Final assistant turn: input + cache_read + cache_creation + output. */
  totalTokens: number;
}

/**
 * Test-only: compute expected tool-use count, duration and final-turn tokens
 * from a sub-transcript, so tests can use notification `<usage>` as an oracle
 * (FR-3 allows this in tests, never in production code). Returns `undefined`
 * for a missing, empty or malformed file. Production code must use the shared
 * metrics computation, not this helper.
 */
export function expectedFromSubTranscript(path: string): ExpectedRunValues | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const entries: Json[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as Json);
    } catch {
      // skip malformed lines
    }
  }
  const stamps = entries
    .map((e) => Date.parse(String(e.timestamp)))
    .filter((t) => !Number.isNaN(t));
  if (entries.length === 0 || stamps.length === 0) return undefined;
  let toolUseCount = 0;
  let totalTokens = 0;
  for (const e of entries) {
    if (e.type !== 'assistant') continue;
    const message = e.message as Json | undefined;
    const content = Array.isArray(message?.content) ? (message.content as Json[]) : [];
    toolUseCount += content.filter((b) => b.type === 'tool_use').length;
    const u = message?.usage as Record<string, number> | undefined;
    if (u) {
      totalTokens =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.output_tokens ?? 0);
    }
  }
  return { toolUseCount, durationMs: stamps[stamps.length - 1]! - stamps[0]!, totalTokens };
}

/** A parsed `<task-notification>` found in a parent-session entry. */
export interface ParsedNotification {
  entryType: string;
  taskId: string;
  status: string;
  /** Raw tag name to text, for the five pinned tags. */
  fields: Record<string, string>;
  usage: { subagent_tokens: number; tool_uses: number; duration_ms: number };
}

/**
 * Test-only: extract notifications, in entry order, from `user` entries
 * (`message.content` text blocks) and `queue-operation` entries (`content`).
 * Not the production parser (that is built from these fixtures later).
 */
export function parseNotifications(entries: Json[]): ParsedNotification[] {
  const out: ParsedNotification[] = [];
  for (const e of entries) {
    const texts: string[] = [];
    if (e.type === 'queue-operation' && typeof e.content === 'string') texts.push(e.content);
    if (e.type === 'user') {
      const content = (e.message as Json | undefined)?.content;
      if (typeof content === 'string') texts.push(content);
      else if (Array.isArray(content)) {
        for (const b of content as Json[]) if (typeof b.text === 'string') texts.push(b.text);
      }
    }
    for (const text of texts) {
      for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
        const body = m[1] ?? '';
        const tag = (t: string): string =>
          new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(body)?.[1]?.trim() ?? '';
        const fields: Record<string, string> = {};
        for (const t of NOTIFICATION_TAGS) {
          if (new RegExp(`<${t}>`).test(body)) fields[t] = tag(t);
        }
        out.push({
          entryType: String(e.type),
          taskId: tag('task-id'),
          status: tag('status'),
          fields,
          usage: {
            subagent_tokens: Number(tag('subagent_tokens')),
            tool_uses: Number(tag('tool_uses')),
            duration_ms: Number(tag('duration_ms')),
          },
        });
      }
    }
  }
  return out;
}

// ---- Materialising a usable copy ------------------------------------------

/**
 * Copy the fixture tree into `dest` and replace `__FIXTURE_ROOT__` in text
 * files with the copy's root, so runlog `agent_transcript_path` values point
 * at real files. Returns the `projects` and `runlogs` roots of the copy.
 */
export function copyCaptureFixtures(dest: string): { projectsRoot: string; runlogsRoot: string } {
  const projectsRoot = join(dest, 'projects');
  const runlogsRoot = join(dest, 'runlogs');
  cpSync(CAPTURE_PROJECTS_ROOT, projectsRoot, { recursive: true });
  cpSync(CAPTURE_RUNLOGS_ROOT, runlogsRoot, { recursive: true });
  const rewrite = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) rewrite(p);
      else {
        const text = readFileSync(p, 'utf8');
        if (text.includes(FIXTURE_ROOT_TOKEN)) {
          writeFileSync(p, text.split(FIXTURE_ROOT_TOKEN).join(dest));
        }
      }
    }
  };
  rewrite(dest);
  return { projectsRoot, runlogsRoot };
}
