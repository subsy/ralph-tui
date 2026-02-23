/**
 * ABOUTME: Verification gate runner for post-completion checks.
 * Runs configurable shell commands after agent signals task completion.
 * All commands must pass (exit 0) for the task to be marked done.
 */

import { runProcess } from '../utils/process.js';
import type { VerificationConfig } from '../config/types.js';

export interface VerificationResult {
  passed: boolean;
  results: CommandResult[];
  durationMs: number;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  durationMs: number;
}

export async function runVerification(
  cwd: string,
  config: Required<VerificationConfig>,
): Promise<VerificationResult> {
  const startedAt = Date.now();
  const results: CommandResult[] = [];

  for (const command of config.commands) {
    const cmdStart = Date.now();
    const result = await runProcess('sh', ['-c', command], {
      cwd,
      timeout: config.timeoutMs,
    });
    results.push({
      command,
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      passed: result.success,
      durationMs: Date.now() - cmdStart,
    });

    // Stop on first failure
    if (!result.success) break;
  }

  return {
    passed: results.length === 0 || results.every(r => r.passed),
    results,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Format verification failures into a string suitable for injection
 * into the agent's retry prompt context.
 */
export function formatVerificationErrors(result: VerificationResult): string {
  const failures = result.results.filter(r => !r.passed);
  if (failures.length === 0) return '';

  const MAX_OUTPUT_CHARS = 2048;

  function truncate(text: string): string {
    if (text.length <= MAX_OUTPUT_CHARS) return text;
    return text.slice(0, MAX_OUTPUT_CHARS) + '... (truncated)';
  }

  return failures.map(f =>
    `Verification command failed: \`${f.command}\`\nExit code: ${f.exitCode}\nstderr:\n${truncate(f.stderr)}\nstdout:\n${truncate(f.stdout)}`
  ).join('\n\n');
}
