#!/usr/bin/env node
/**
 * CLI bin entry. Kept separate from `index.ts` so importing the CLI module in
 * tests has no side effects.
 */
import { run } from './index';

run(process.argv.slice(2), {
  registryPath: process.env.HANDLER_REGISTRY,
  projectsRoot: process.env.HANDLER_PROJECTS,
  storePath: process.env.HANDLER_STORE,
  scoreStorePath: process.env.HANDLER_SCORES,
  conventionsPath: process.env.HANDLER_CONVENTIONS,
  noteStorePath: process.env.HANDLER_NOTES,
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
