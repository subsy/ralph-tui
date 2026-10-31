/**
 * ABOUTME: Builds Factory Droid CLI arguments for task execution.
 * Uses 'droid exec' subcommand for non-interactive execution.
 */

import { DROID_EXEC_SUBCOMMAND, DROID_NON_INTERACTIVE_FLAGS } from './config.js';
import type { DroidOutputFormat } from './schema.js';

export interface DroidCommandArgs {
  prompt: string;
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  skipPermissions?: boolean;
  outputFormat?: DroidOutputFormat;
  flags?: readonly string[];
}

// Value-taking exec flags: their values must never be read as output-format options.
const VALUE_FLAGS = new Set([
  '-f', '--file', '-m', '--model', '-s', '--session-id', '--auto',
  '--only-tools', '--add-tools', '--remove-tools', '--input-format',
  '--restrict-tools', '--additional-tools', '--disabled-tools',
  '-r', '--reasoning-effort', '--spec-model', '--spec-reasoning-effort', '--cwd',
  '-w', '--worktree', '--tag', '--log-group-id', '--fork',
  '--worker-model', '--worker-reasoning-effort', '--validator-model', '--validator-reasoning-effort',
  '--append-system-prompt', '--append-system-prompt-file', '--settings',
]);

export function getDroidOutputFormat(flags: readonly string[]): string | undefined {
  let format: string | undefined;
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--') {
      break;
    }
    if (flag === '--output-format' || flag === '-o') {
      const value = flags[++index];
      if (!value || value.startsWith('-')) {
        return '';
      }
      format = value;
    } else if (flag.startsWith('--output-format=')) {
      format = flag.slice('--output-format='.length);
    } else if (flag.startsWith('-o=')) {
      format = flag.slice(3);
    } else if (VALUE_FLAGS.has(flag)) {
      if (flags[index + 1] === '--') {
        break;
      }
      if (!['-w', '--worktree'].includes(flag) || !flags[index + 1]?.startsWith('-')) {
        index++;
      }
    }
    if (format === '') {
      return '';
    }
  }
  return format;
}

export function buildDroidCommandArgs({
  prompt,
  cwd,
  model,
  reasoningEffort,
  skipPermissions,
  outputFormat = 'stream-json',
  flags = [],
}: DroidCommandArgs): string[] {
  // Start with 'exec' subcommand for non-interactive mode
  // Format: droid exec [flags] "prompt"
  const args: string[] = [
    DROID_EXEC_SUBCOMMAND, '--output-format', outputFormat,
    ...flags, ...DROID_NON_INTERACTIVE_FLAGS,
  ];

  if (model) {
    args.push('--model', model);
  }

  if (reasoningEffort) {
    args.push('--reasoning-effort', reasoningEffort);
  }

  if (skipPermissions) {
    args.push('--skip-permissions-unsafe');
  }

  args.push('--cwd', cwd);

  // Prompt is passed as positional argument to exec subcommand
  args.push(prompt);

  return args;
}
