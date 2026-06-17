#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';

import { VERSION } from '../core/index';

const program = new Command();

program
  .name('handler')
  .description('Observability and evaluation for the Claude Code subagents you author')
  .version(VERSION);

program.action(() => {
  console.log(`${chalk.bold('handler')} — run \`handler --help\` to see available commands.`);
});

program.parse();
