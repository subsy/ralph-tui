/**
 * ABOUTME: Generates structured diff summaries after each iteration.
 * Captures files changed, new exports, and patterns for cross-iteration context.
 */

import { runProcess } from '../utils/process.js';

export interface DiffSummary {
  filesChanged: string[];
  filesAdded: string[];
  filesDeleted: string[];
  summary: string;
}

/**
 * Generate a structured diff summary of changes since the last commit.
 * Should be called BEFORE auto-commit to capture the iteration's changes.
 */
export async function generateDiffSummary(cwd: string): Promise<DiffSummary | null> {
  // Get list of changed files
  const statusResult = await runProcess('git', ['status', '--porcelain'], { cwd });
  if (!statusResult.success || !statusResult.stdout.trim()) return null;

  const lines = statusResult.stdout.split('\n').filter(line => line.length > 0);
  const filesAdded: string[] = [];
  const filesChanged: string[] = [];
  const filesDeleted: string[] = [];

  for (const line of lines) {
    const status = line.substring(0, 2).trim();
    const file = line.substring(3);
    if (status === 'A' || status === '??') filesAdded.push(file);
    else if (status === 'D') filesDeleted.push(file);
    else filesChanged.push(file);
  }

  // Get compact diff stat
  const diffResult = await runProcess('git', ['diff', '--stat', 'HEAD'], { cwd });
  const stat = diffResult.success ? diffResult.stdout.trim() : '';
  void stat; // captured for potential future use

  // Build human-readable summary
  const parts: string[] = [];
  if (filesAdded.length > 0) parts.push(`Created: ${filesAdded.join(', ')}`);
  if (filesChanged.length > 0) parts.push(`Modified: ${filesChanged.join(', ')}`);
  if (filesDeleted.length > 0) parts.push(`Deleted: ${filesDeleted.join(', ')}`);

  return {
    filesChanged,
    filesAdded,
    filesDeleted,
    summary: parts.join('\n'),
  };
}

/**
 * Format multiple iteration diff summaries into a context block
 * suitable for injection into agent prompts.
 */
export function formatDiffContext(summaries: DiffSummary[]): string {
  if (summaries.length === 0) return '';

  return summaries.map((s, i) =>
    `### Iteration ${i + 1}\n${s.summary}`
  ).join('\n\n');
}
