/**
 * ABOUTME: Builds Factory Droid CLI arguments for task execution.
 * Uses 'droid exec' subcommand for non-interactive execution.
 */

import {
  DROID_EXEC_SUBCOMMAND,
  DROID_NON_INTERACTIVE_FLAGS,
} from './config.js';

export interface DroidCommandArgs {
  prompt: string;
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  skipPermissions?: boolean;
  enableTracing?: boolean;
}

export function buildDroidCommandArgs({
  prompt,
  cwd,
  model,
  reasoningEffort,
  skipPermissions,
  enableTracing,
}: DroidCommandArgs): string[] {
  // Start with 'exec' subcommand for non-interactive mode
  // Format: droid exec [flags] "prompt"
  const args: string[] = [
    DROID_EXEC_SUBCOMMAND,
    ...DROID_NON_INTERACTIVE_FLAGS,
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

  if (enableTracing) {
    args.push('--output-format', 'stream-json');
  }

  args.push('--cwd', cwd);

  // Prompt is passed as positional argument to exec subcommand
  args.push(prompt);

  return args;
}
