/**
 * `handler gui` command (V1 Feature 6, Task 9).
 *
 * Starts the HTTP server with the built SPA static assets, prints the local
 * URL, and keeps the process alive until the user interrupts (SIGINT/SIGTERM).
 *
 * The command holds no business logic — it only calls `startGuiServer` from
 * core and manages the process lifecycle.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';

import { startGuiServer } from '../../core/index';
import type { CliContext } from './source';

const DEFAULT_PORT = 4242;

export function registerGuiCommand(program: Command, ctx: CliContext): void {
  program
    .command('gui')
    .description('Launch the handler browser GUI')
    .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
    .action(async (options: { port: string }) => {
      const port = parseInt(options.port, 10);

      // Resolve the GUI assets directory relative to this file's location.
      // In the built bundle: dist/cli/commands/gui.js → ../../gui = dist/gui/
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const assetsDir = resolve(currentDir, '../../gui');

      if (!existsSync(assetsDir)) {
        ctx.out('GUI assets not built — run `npm run build:gui` first');
        process.exit(1);
        return;
      }

      const server = await startGuiServer(port, assetsDir, ctx);
      ctx.out(`handler GUI: ${server.url}`);

      // Keep the process alive until SIGINT or SIGTERM.
      await new Promise<void>((resolveSignal) => {
        process.once('SIGINT', resolveSignal);
        process.once('SIGTERM', resolveSignal);
      });

      await server.close();
      process.exit(0);
    });
}
