/**
 * ABOUTME: Auto-commit utility for committing changes after successful task completion.
 * Provides git operations to stage and commit changes when autoCommit is enabled.
 */

import { runProcess } from '../utils/process.js';

/**
 * Result of an auto-commit operation
 */
export interface AutoCommitResult {
  /** Whether a commit was actually created */
  committed: boolean;
  /** The commit message used (if committed) */
  commitMessage?: string;
  /** The short SHA of the created commit (if committed) */
  commitSha?: string;
  /** Reason commit was skipped (if not committed and no error) */
  skipReason?: string;
  /** Error message if the commit failed */
  error?: string;
}

/**
 * Check if there are uncommitted changes in the working directory.
 * Throws if git status cannot be determined (not a git repo, git not installed, etc.).
 */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const result = await runProcess('git', ['status', '--porcelain'], { cwd });
  if (!result.success) {
    throw new Error(`git status failed: ${result.stderr.trim() || 'unknown error (exit code ' + result.exitCode + ')'}`);
  }
  return result.stdout.trim().length > 0;
}

/**
 * Stage all changes and create a commit with a standardized message format.
 * Returns the result of the operation including commit SHA on success.
 */
export async function performAutoCommit(
  cwd: string,
  taskId: string,
  taskTitle: string,
  iteration?: number
): Promise<AutoCommitResult> {
  // Check for uncommitted changes first
  let hasChanges: boolean;
  try {
    hasChanges = await hasUncommittedChanges(cwd);
  } catch (err) {
    return {
      committed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!hasChanges) {
    return {
      committed: false,
      skipReason: 'no uncommitted changes',
    };
  }

  // Stage all changes
  const addResult = await runProcess('git', ['add', '-A'], { cwd });
  if (!addResult.success) {
    return {
      committed: false,
      error: `git add failed: ${addResult.stderr.trim() || 'unknown error'}`,
    };
  }

  // Create commit with standardized message
  const iterationLine = iteration !== undefined ? `\n\nIteration: ${iteration}\nAgent: ralph-tui` : '';
  const commitMessage = `feat(ralph): ${taskId} - ${taskTitle.replace(/\n/g, ' ').trim()}${iterationLine}`;
  const commitResult = await runProcess(
    'git',
    ['commit', '-m', commitMessage],
    { cwd }
  );
  if (!commitResult.success) {
    return {
      committed: false,
      error: `git commit failed: ${commitResult.stderr.trim() || 'unknown error'}`,
    };
  }

  // Get the short SHA of the new commit
  const shaResult = await runProcess(
    'git',
    ['rev-parse', '--short', 'HEAD'],
    { cwd }
  );
  const commitSha = shaResult.success ? shaResult.stdout.trim() : undefined;

  return {
    committed: true,
    commitMessage,
    commitSha,
  };
}
