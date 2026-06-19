import { basename } from 'node:path';

/**
 * Extract the `<parentAgentId>` from a sidechain transcript file path.
 *
 * Claude Code names per-run sidechain files as `agent-<parentAgentId>.jsonl`.
 * This function parses that id from the last segment of the given path using
 * pure string manipulation — no filesystem calls are made.
 *
 * @returns The parentAgentId string, or `undefined` if the filename does not
 *   match the `agent-<id>.jsonl` pattern.
 */
export function parseSidechainParentAgentId(filePath: string): string | undefined {
  const name = basename(filePath);
  const match = /^agent-(.+)\.jsonl$/.exec(name);
  return match?.[1];
}
