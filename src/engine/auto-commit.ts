/**
 * ABOUTME: Auto-commit utility for committing changes after successful task completion.
 * Provides git operations to stage and commit changes when autoCommit is enabled,
 * plus Handlebars-based rendering of configurable commit subject templates.
 */

import Handlebars from 'handlebars';
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
 * Default commit subject template used when the user has not set
 * `commitMessageTemplate` in their config. Uses the tracker-reported task type
 * (with a `chore` fallback) so commits look Conventional-Commits-shaped without
 * mis-labeling everything as `feat:`.
 */
export const DEFAULT_COMMIT_MESSAGE_TEMPLATE = '{{taskType}}: {{taskId}} {{taskTitle}}';

/**
 * Fallback used when a task's `type` is missing or empty so user templates
 * always render to a non-empty subject.
 */
export const DEFAULT_TASK_TYPE = 'chore';

/**
 * Inputs for {@link renderCommitMessage}.
 */
export interface CommitMessageContext {
  taskId: string;
  taskTitle: string;
  taskType?: string;
}

/**
 * Result of rendering a commit message template.
 */
export interface RenderCommitMessageResult {
  /** The rendered commit subject. Always non-empty. */
  message: string;
  /**
   * True when the caller-supplied template rendered to an empty/whitespace
   * string (or failed to compile) and we fell back to the default template.
   */
  usedFallback: boolean;
  /** Compile/render error message when {@link usedFallback} is true. */
  fallbackReason?: string;
}

function buildHandlebarsContext(ctx: CommitMessageContext): Record<string, string> {
  const type = ctx.taskType?.trim();
  return {
    taskId: ctx.taskId,
    taskTitle: ctx.taskTitle,
    taskType: type && type.length > 0 ? type : DEFAULT_TASK_TYPE,
  };
}

function compileAndRender(template: string, ctx: Record<string, string>): string {
  const compiled = Handlebars.compile(template, { noEscape: true, strict: false });
  return compiled(ctx).trim();
}

/**
 * Render a Handlebars commit subject template. Falls back to the default
 * template when the user-supplied template renders empty/whitespace-only or
 * throws while compiling.
 */
export function renderCommitMessage(
  template: string | undefined,
  ctx: CommitMessageContext
): RenderCommitMessageResult {
  const handlebarsCtx = buildHandlebarsContext(ctx);
  const effectiveTemplate = template ?? DEFAULT_COMMIT_MESSAGE_TEMPLATE;

  let rendered: string;
  try {
    rendered = compileAndRender(effectiveTemplate, handlebarsCtx);
  } catch (err) {
    const fallback = compileAndRender(DEFAULT_COMMIT_MESSAGE_TEMPLATE, handlebarsCtx);
    return {
      message: fallback,
      usedFallback: true,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }

  if (rendered.length === 0) {
    const fallback = compileAndRender(DEFAULT_COMMIT_MESSAGE_TEMPLATE, handlebarsCtx);
    return {
      message: fallback,
      usedFallback: true,
      fallbackReason: 'template rendered to empty string',
    };
  }

  return { message: rendered, usedFallback: false };
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
 * Stage all changes and create a commit using the supplied subject line.
 * The caller is responsible for rendering any template — see {@link renderCommitMessage}.
 */
export async function performAutoCommit(
  cwd: string,
  commitMessage: string
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

  // Create commit with supplied message
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
