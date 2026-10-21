import { describe, expect, it } from 'vitest';

import {
  CAPTURE_AGENT_IDS,
  buildTaskNotificationText,
  capturePaths,
} from '../__fixtures__/capture/fixtures';
import { readJsonl } from './jsonl';
import { extractNotifications, latestStatusByAgentId } from './notifications';

const note = (taskId: string, status: string): string =>
  buildTaskNotificationText({ taskId, status, toolUses: 1, durationMs: 1, subagentTokens: 1 });

const userEntry = (text: string): unknown => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
});
const queueEntry = (text: string): unknown => ({ type: 'queue-operation', content: text });

describe('extractNotifications', () => {
  it('finds notifications in user and queue-operation entries, in entry order', () => {
    const found = extractNotifications([
      userEntry(note('a', 'completed')),
      queueEntry(note('b', 'failed')),
    ]);
    expect(found).toEqual([
      { taskId: 'a', status: 'completed' },
      { taskId: 'b', status: 'failed' },
    ]);
  });

  it('reads user entries whose content is a plain string', () => {
    const entry = { type: 'user', message: { content: note('a', 'killed') } };
    expect(extractNotifications([entry])).toEqual([{ taskId: 'a', status: 'killed' }]);
  });

  it('skips malformed, truncated, and oddly shaped input without throwing', () => {
    const entries: unknown[] = [
      null,
      42,
      'text',
      [],
      { type: 'user' },
      { type: 'user', message: null },
      { type: 'user', message: { content: [null, 1, { text: 5 }] } },
      { type: 'queue-operation', content: 7 },
      queueEntry('<task-notification><task-id>x</task-id><status>completed</status>'),
      queueEntry('<task-notification><status>completed</status></task-notification>'),
      queueEntry('<task-notification><task-id>y</task-id></task-notification>'),
      queueEntry(
        '<task-notification><task-id> </task-id><status>done</status></task-notification>',
      ),
      { type: 'assistant', message: { content: [{ type: 'text', text: note('z', 'completed') }] } },
      queueEntry(note('ok', 'completed')),
    ];
    expect(extractNotifications(entries)).toEqual([{ taskId: 'ok', status: 'completed' }]);
  });

  it('finds several notifications in one text block', () => {
    const found = extractNotifications([
      queueEntry(`${note('a', 'completed')}\n${note('b', 'failed')}`),
    ]);
    expect(found.map((n) => n.taskId)).toEqual(['a', 'b']);
  });
});

describe('latestStatusByAgentId', () => {
  it('keeps the latest status per task-id in entry order', () => {
    const map = latestStatusByAgentId([
      queueEntry(note('a', 'completed')),
      userEntry(note('b', 'killed')),
      queueEntry(note('a', 'failed')),
    ]);
    expect(map.size).toBe(2);
    expect(map.get('a')).toBe('failed');
    expect(map.get('b')).toBe('killed');
  });

  it('omits an agentId with no notification', () => {
    const map = latestStatusByAgentId([]);
    expect(map.has('nope')).toBe(false);
    expect(map.get('nope')).toBeUndefined();
  });

  it('does not throw on non-array input', () => {
    expect(latestStatusByAgentId(undefined as unknown as unknown[]).size).toBe(0);
  });

  describe('against the capture fixture parent transcript', () => {
    const entries = readJsonl(capturePaths.parentTranscript);
    const map = latestStatusByAgentId(entries);

    it('ends the resumed writer on its changed status, not the first completed', () => {
      const writerStatuses = extractNotifications(entries)
        .filter((n) => n.taskId === CAPTURE_AGENT_IDS.writer)
        .map((n) => n.status);
      expect(writerStatuses.length).toBe(2);
      expect(writerStatuses[0]).toBe('completed');
      expect(writerStatuses[1]).not.toBe('completed');
      expect(map.get(CAPTURE_AGENT_IDS.writer)).toBe(writerStatuses[1]);
    });

    it('yields one entry per task-id and reports the unmatched id too', () => {
      const ids = extractNotifications(entries).map((n) => n.taskId);
      expect(map.size).toBe(new Set(ids).size);
      expect(map.has(CAPTURE_AGENT_IDS.unmatched)).toBe(true);
    });

    it('leaves agents without a notification absent', () => {
      expect(map.has(CAPTURE_AGENT_IDS.malformed)).toBe(false);
    });
  });
});
