/**
 * ABOUTME: AI-assisted conflict resolution for parallel merge operations.
 * Extracts conflict data from git's merge state, sends it to an AI agent for
 * resolution, and applies the resolved content. Falls back to rollback on failure.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Validate that a string is a valid git ref name.
 * Based on git-check-ref-format rules.
 * @throws Error if the ref name is invalid
 */
function validateGitRef(ref: string, context: string): void {
  // Empty ref is invalid
  if (!ref || ref.trim() === '') {
    throw new Error(`Invalid git ref for ${context}: ref is empty`);
  }
  // Cannot contain spaces
  if (ref.includes(' ')) {
    throw new Error(`Invalid git ref for ${context}: contains spaces`);
  }
  // Cannot contain double dots
  if (ref.includes('..')) {
    throw new Error(`Invalid git ref for ${context}: contains '..'`);
  }
  // Cannot contain control characters
  if (/[\x00-\x1f\x7f]/.test(ref)) {
    throw new Error(`Invalid git ref for ${context}: contains control characters`);
  }
  // Cannot start with a dot
  if (ref.startsWith('.') || ref.includes('/.')) {
    throw new Error(`Invalid git ref for ${context}: starts with '.'`);
  }
  // Cannot end with a dot
  if (ref.endsWith('.')) {
    throw new Error(`Invalid git ref for ${context}: ends with '.'`);
  }
  // Cannot contain consecutive slashes
  if (ref.includes('//')) {
    throw new Error(`Invalid git ref for ${context}: contains consecutive slashes`);
  }
  // Cannot end with .lock
  if (ref.endsWith('.lock')) {
    throw new Error(`Invalid git ref for ${context}: ends with '.lock'`);
  }
  // Cannot contain certain characters
  if (/[~^:?*\[\\]/.test(ref)) {
    throw new Error(`Invalid git ref for ${context}: contains invalid characters (~, ^, :, ?, *, [, \\)`);
  }
  // Cannot contain @{ sequence (used for reflog)
  if (ref.includes('@{')) {
    throw new Error(`Invalid git ref for ${context}: contains '@{' sequence`);
  }
}
import type {
  FileConflict,
  ConflictResolutionResult,
  MergeOperation,
} from './types.js';
import type {
  ParallelEventListener,
  ParallelEvent,
} from './events.js';

/**
 * Callback type for AI resolution.
 * The parallel executor injects the actual AI agent call.
 * Receives the three-way merge context and returns the resolved content.
 */
export type AiResolverCallback = (
  conflict: FileConflict,
  taskContext: { taskId: string; taskTitle: string }
) => Promise<string | null>;

/**
 * Resolves merge conflicts using AI assistance with manual fallback.
 *
 * Resolution flow:
 * 1. Start the merge (do not abort — keep the conflicted index)
 * 2. For each conflicted file:
 *    a. Extract base/ours/theirs from git index stages
 *    b. Send to AI with task context
 *    c. Write resolved content and `git add`
 * 3. If all files resolved: `git commit` to complete the merge
 * 4. If any file fails: `git merge --abort` and rollback
 */
export class ConflictResolver {
  private readonly cwd: string;
  private aiResolver: AiResolverCallback | null = null;
  private readonly listeners: ParallelEventListener[] = [];

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Set the AI resolver callback.
   * Called by the ParallelExecutor to inject the agent-backed resolver.
   */
  setAiResolver(resolver: AiResolverCallback): void {
    this.aiResolver = resolver;
  }

  /**
   * Register an event listener.
   */
  on(listener: ParallelEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Attempt to resolve conflicts for a merge operation.
   *
   * This method expects the merge to be in a conflicted state
   * (i.e., `git merge` was run but not aborted). It will:
   * 1. Extract conflict data from the index
   * 2. Attempt AI resolution for each file
   * 3. Complete the merge on success, or abort on failure
   *
   * @param operation - The merge operation with conflicts
   * @returns Array of resolution results (one per conflicted file)
   */
  async resolveConflicts(
    operation: MergeOperation
  ): Promise<ConflictResolutionResult[]> {
    const conflictedFiles = operation.conflictedFiles ?? [];
    if (conflictedFiles.length === 0) {
      return [];
    }

    const taskId = operation.workerResult.task.id;
    const taskTitle = operation.workerResult.task.title;
    const results: ConflictResolutionResult[] = [];

    // Start the merge again (it was aborted in merge-engine for safety)
    // Validate the source branch name to prevent issues
    validateGitRef(operation.sourceBranch, 'sourceBranch');
    try {
      this.git(['merge', '--no-commit', operation.sourceBranch]);
    } catch {
      // Expected to fail with conflicts — that's the state we want
    }

    // Resolve each conflicted file
    for (const filePath of conflictedFiles) {
      const conflict = this.extractConflict(filePath);
      if (!conflict) {
        results.push({
          filePath,
          success: false,
          method: 'ai',
          error: 'Failed to extract conflict data',
        });
        continue;
      }

      const result = await this.resolveFile(
        conflict,
        operation.id,
        taskId,
        taskTitle
      );
      results.push(result);

      // If any file fails, abort the whole merge
      if (!result.success) {
        this.abortMerge(operation);
        return results;
      }
    }

    // All files resolved — complete the merge
    const allResolved = results.every((r) => r.success);
    if (allResolved) {
      try {
        // Use -m with the message as a separate argument to avoid shell injection
        this.git(['commit', '--no-edit', '-m', operation.commitMessage]);

        this.emit({
          type: 'conflict:resolved',
          timestamp: new Date().toISOString(),
          operationId: operation.id,
          taskId,
          results,
        });
      } catch (err) {
        // Commit failed — abort
        this.abortMerge(operation);
        results.push({
          filePath: '<commit>',
          success: false,
          method: 'ai',
          error: `Failed to commit resolved merge: ${err}`,
        });
      }
    }

    return results;
  }

  /**
   * Resolve a single conflicted file.
   */
  private async resolveFile(
    conflict: FileConflict,
    operationId: string,
    taskId: string,
    taskTitle: string
  ): Promise<ConflictResolutionResult> {
    // Try AI resolution if available
    if (this.aiResolver) {
      this.emit({
        type: 'conflict:ai-resolving',
        timestamp: new Date().toISOString(),
        operationId,
        taskId,
        filePath: conflict.filePath,
      });

      try {
        const resolved = await this.aiResolver(conflict, {
          taskId,
          taskTitle,
        });

        if (resolved !== null) {
          // Write resolved content
          const absPath = path.resolve(this.cwd, conflict.filePath);
          fs.writeFileSync(absPath, resolved, 'utf-8');
          this.git(['add', conflict.filePath]);

          const result: ConflictResolutionResult = {
            filePath: conflict.filePath,
            success: true,
            method: 'ai',
            resolvedContent: resolved,
          };

          this.emit({
            type: 'conflict:ai-resolved',
            timestamp: new Date().toISOString(),
            operationId,
            taskId,
            result,
          });

          return result;
        }
      } catch (err) {
        this.emit({
          type: 'conflict:ai-failed',
          timestamp: new Date().toISOString(),
          operationId,
          taskId,
          filePath: conflict.filePath,
          error: `${err}`,
        });
      }
    }

    // AI resolution failed or unavailable
    return {
      filePath: conflict.filePath,
      success: false,
      method: 'ai',
      error: 'AI resolution failed or unavailable',
    };
  }

  /**
   * Extract conflict data for a file from the git index.
   * Uses git's merge stages: :1: (base), :2: (ours), :3: (theirs)
   */
  private extractConflict(filePath: string): FileConflict | null {
    try {
      const baseContent = this.gitContent(`:1:${filePath}`);
      const oursContent = this.gitContent(`:2:${filePath}`);
      const theirsContent = this.gitContent(`:3:${filePath}`);

      // Read the file with conflict markers
      const absPath = path.resolve(this.cwd, filePath);
      const conflictMarkers = fs.existsSync(absPath)
        ? fs.readFileSync(absPath, 'utf-8')
        : '';

      return {
        filePath,
        oursContent,
        theirsContent,
        baseContent,
        conflictMarkers,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get file content from a git index stage.
   */
  private gitContent(ref: string): string {
    try {
      return this.git(['show', ref]);
    } catch {
      return '';
    }
  }

  /**
   * Abort the current merge and rollback.
   */
  private abortMerge(operation: MergeOperation): void {
    try {
      this.git(['merge', '--abort']);
    } catch {
      // Merge may not be in progress
    }

    // Rollback to backup tag
    try {
      validateGitRef(operation.backupTag, 'backupTag');
      this.git(['reset', '--hard', operation.backupTag]);
    } catch {
      // Best effort rollback
    }

    this.emit({
      type: 'merge:rolled-back',
      timestamp: new Date().toISOString(),
      operationId: operation.id,
      taskId: operation.workerResult.task.id,
      backupTag: operation.backupTag,
      reason: 'Conflict resolution failed',
    });
  }

  /**
   * Emit a parallel event to all listeners.
   */
  private emit(event: ParallelEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the resolver
      }
    }
  }

  /**
   * Execute a git command in the main repository.
   * Uses execFileSync with argument array to prevent shell injection.
   * Pipes stdio so git output doesn't bleed through to the TUI.
   */
  private git(args: string[]): string {
    return execFileSync('git', ['-C', this.cwd, ...args], {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}
