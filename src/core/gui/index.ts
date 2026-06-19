/**
 * GUI core API.
 *
 * Exports the typed data-access functions the HTTP server calls — one function
 * per API endpoint shape. All data-access logic lives here; the server holds
 * no logic and only serializes the return values to JSON.
 */
export type { AgentListEntry } from './agents';
export { listAgents } from './agents';
export type {
  AgentDetail,
  ConventionsCheckResult,
  RunDetail,
  TierADetail,
  TierBDetail,
  TierCDetail,
} from './agent-detail';
export { getAgentDetail } from './agent-detail';
export type { GuiServerHandle } from './server';
export { startGuiServer } from './server';
