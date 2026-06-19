/**
 * Browser-side API client for the handler GUI server.
 *
 * Typed fetch wrappers over the `/api/agents` endpoints. No business logic —
 * no filtering, sorting, or aggregation. URL construction and error handling
 * only. Uses the browser's native `fetch`; no additional HTTP clients.
 *
 * The API base URL is relative so the SPA can be served from the same origin
 * as the API server without configuration.
 */
import type { AgentDetail, AgentSummary } from './types';

const API_BASE = '/api/agents';

/**
 * Fetch the full agent roster list.
 *
 * Calls `GET /api/agents` and returns a typed `AgentSummary[]`.
 * Propagates network errors and non-2xx responses as thrown errors.
 */
export async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await fetch(API_BASE);

  if (!response.ok) {
    throw new Error(`Failed to fetch agents: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<AgentSummary[]>;
}

/**
 * Fetch the full detail for a single agent identified by `identityKey`.
 *
 * Calls `GET /api/agents/:identityKey` where the key is URL-encoded.
 * Returns `null` on 404 (agent not found). Propagates network errors and
 * other non-2xx responses as thrown errors.
 */
export async function fetchAgentDetail(identityKey: string): Promise<AgentDetail | null> {
  const url = `${API_BASE}/${encodeURIComponent(identityKey)}`;
  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch agent detail: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<AgentDetail>;
}
