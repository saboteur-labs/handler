/**
 * `handler hook` commands (V1 Feature 5, Task 5, Req 8).
 *
 * Thin formatters that print the Claude Code hooks configuration fragment a
 * developer must copy-paste to enable or disable the `handler-hook` binary as
 * a `SubagentStop` handler. These commands hold NO business logic — they only
 * format and print static text. Neither command reads from nor writes to any
 * store.
 *
 * The configuration fragment is for `~/.claude/settings.json` (user-level) or
 * `<repo>/.claude/settings.json` (project-level). Schema verified empirically
 * from Claude Code's on-disk plugin hook files (hooks-codex.json format).
 */
import type { Command } from 'commander';

import type { CliContext } from './source';

/** The JSON fragment to add to the Claude Code hooks configuration. */
const ENABLE_FRAGMENT = JSON.stringify(
  {
    hooks: {
      SubagentStop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'handler-hook',
            },
          ],
        },
      ],
    },
  },
  null,
  2,
);

export function registerHookCommand(program: Command, ctx: CliContext): void {
  const hook = program
    .command('hook')
    .description('Print Claude Code hook configuration fragments');

  hook
    .command('enable')
    .description('Print the SubagentStop hook configuration to add to your Claude Code settings')
    .action(() => {
      ctx.out('Add the following to your Claude Code hooks configuration.');
      ctx.out('');
      ctx.out(
        'File location: ~/.claude/settings.json (user-level) or <repo>/.claude/settings.json (project-level)',
      );
      ctx.out('');
      ctx.out('Merge the "hooks" key into your existing settings.json:');
      ctx.out('');
      ctx.out(ENABLE_FRAGMENT);
      ctx.out('');
      ctx.out(
        'This registers handler-hook as the SubagentStop handler so runs are captured in real time.',
      );
      ctx.out(
        'If a "hooks" key already exists in your settings.json, merge the SubagentStop entry into it.',
      );
    });

  hook
    .command('disable')
    .description(
      'Print instructions for removing the SubagentStop hook from your Claude Code settings',
    )
    .action(() => {
      ctx.out(
        'To disable real-time capture, remove the SubagentStop entry from your settings.json.',
      );
      ctx.out('');
      ctx.out(
        'File location: ~/.claude/settings.json (user-level) or <repo>/.claude/settings.json (project-level)',
      );
      ctx.out('');
      ctx.out('Delete the following from your settings.json hooks configuration:');
      ctx.out('');
      ctx.out(
        JSON.stringify(
          {
            SubagentStop: [
              {
                matcher: '',
                hooks: [{ type: 'command', command: 'handler-hook' }],
              },
            ],
          },
          null,
          2,
        ),
      );
      ctx.out('');
      ctx.out(
        'After removing this entry, handler-hook will no longer be invoked on SubagentStop events.',
      );
      ctx.out('Transcript-based ingestion via `handler` commands continues to work unchanged.');
    });
}
