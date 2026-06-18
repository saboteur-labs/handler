/**
 * handler core library.
 *
 * All behavior lives here so the CLI (and a future GUI) stay thin clients
 * over the same API. Feature modules are added under `src/core/` as the
 * MVP is built out (see `docs/tasks/`).
 */

/** Current handler version. Kept in sync with `package.json`. */
export const VERSION = '0.0.0';

export { BUILTIN_AGENT_NAMES, isBuiltinAgent } from './denylist';
export { normalizePath } from './paths';
export type { AgentSource, SourceType } from './sources/source';
export { repoSource, userSource } from './sources/source';
