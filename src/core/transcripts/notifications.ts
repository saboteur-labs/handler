/**
 * Task-notification parser (subagent-run-capture FR-4).
 *
 * Completion of a background subagent is visible in the parent session as a
 * `<task-notification>` block, found either in a `user` entry (text blocks in
 * `message.content`, or a plain-string content) or in a `queue-operation`
 * entry (`content` string). A run's status is the `<status>` of the latest
 * notification whose `<task-id>` equals the agentId. Meta `finished` and the
 * sub-transcript `stop_reason` are deliberately never consulted, and the
 * notification `<usage>` block is not parsed (it is not a metric source).
 *
 * Parsing is defensive: entries of unexpected shape, and notification text
 * that is truncated or lacks a task-id or status, are skipped without
 * throwing. Ignoring task-ids that match no on-disk run is the ingest join's
 * job, not this module's.
 */

/** A notification status as written by Claude Code (e.g. `completed`, `failed`, `killed`). */
export type NotificationStatus = string;

/** One parsed `<task-notification>`: the agentId it names and its status. */
export interface TaskNotification {
  taskId: string;
  status: NotificationStatus;
}

const NOTIFICATION_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tagText(body: string, tag: string): string | undefined {
  const text = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1]?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/** Text candidates that may hold notifications for one entry; `[]` for unexpected shapes. */
function entryTexts(entry: unknown): string[] {
  if (!isRecord(entry)) return [];
  if (entry.type === 'queue-operation') {
    return typeof entry.content === 'string' ? [entry.content] : [];
  }
  if (entry.type !== 'user' || !isRecord(entry.message)) return [];
  const content = entry.message.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content as unknown[]) {
    if (isRecord(block) && typeof block.text === 'string') texts.push(block.text);
  }
  return texts;
}

/**
 * Every well-formed notification in the entries, in entry order. A
 * notification missing its task-id or status, or never closed, is skipped.
 */
export function extractNotifications(entries: readonly unknown[]): TaskNotification[] {
  const found: TaskNotification[] = [];
  if (!Array.isArray(entries)) return found;
  for (const entry of entries) {
    for (const text of entryTexts(entry)) {
      for (const match of text.matchAll(NOTIFICATION_RE)) {
        const body = match[1] ?? '';
        const taskId = tagText(body, 'task-id');
        const status = tagText(body, 'status');
        if (taskId !== undefined && status !== undefined) found.push({ taskId, status });
      }
    }
  }
  return found;
}

/**
 * The status of the latest notification per task-id (= agentId), by entry
 * order. An agentId with no notification is absent from the map.
 */
export function latestStatusByAgentId(
  entries: readonly unknown[],
): Map<string, NotificationStatus> {
  const latest = new Map<string, NotificationStatus>();
  for (const { taskId, status } of extractNotifications(entries)) latest.set(taskId, status);
  return latest;
}
