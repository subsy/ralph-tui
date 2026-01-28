/**
 * ABOUTME: Sequential merge queue for parallel execution.
 * Merges completed worker branches back into the main branch one at a time.
 * Uses fast-forward when possible, falls back to merge commits, and supports
 * rollback via backup tags for safety.
 */

import { execSync } from 'node:child_process';
import type {
  MergeOperation,
  MergeResult,
  MergeStatus,
  WorkerResult,
  FileConflict,
} from './types.js';
import type {
  ParallelEventListener,
  ParallelEvent,
} from './events.js';

/**
 * Sequential merge queue that processes completed worker branches.
 *
 * Merge strategy:
 * 1. Pre-flight: Verify the branch has commits ahead of current HEAD
 * 2. Backup: Create a tag on current HEAD for rollback
 * 3. Fast-forward: Try `git merge --ff-only` (cleanest, no merge commit)
 * 4. Merge commit: Fall back to `git merge --no-edit` if ff fails
 * 5. Conflict: Detect conflicts, invoke resolver or rollback
 * 6. Cleanup: Remove worktree and branch after successful merge
 */
export class MergeEngine {
  private readonly cwd: string;
  private readonly queue: MergeOperation[] = [];
  private processing = false;
  private sessionStartTag: string | null = null;
  private readonly listeners: ParallelEventListener[] = [];

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Register an event listener.
   * @returns Unsubscribe function
   */
  on(listener: ParallelEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Create a session-level backup tag before any merges begin.
   * Used for full rollback of the entire parallel session.
   */
  createSessionBackup(sessionId: string): string {
    const tag = `ralph/session-start/${sessionId}`;
    this.git(`tag "${tag}" HEAD`);
    this.sessionStartTag = tag;
    return tag;
  }

  /**
   * Get the session start tag for full rollback.
   */
  getSessionStartTag(): string | null {
    return this.sessionStartTag;
  }

  /**
   * Enqueue a completed worker's branch for merging.
   * @param workerResult - Result from the completed worker
   * @returns The created merge operation
   */
  enqueue(workerResult: WorkerResult): MergeOperation {
    const now = new Date().toISOString();
    const taskId = workerResult.task.id;

    const operation: MergeOperation = {
      id: `merge-${taskId}-${Date.now()}`,
      workerResult,
      status: 'queued',
      backupTag: `ralph/pre-merge/${taskId}/${Date.now()}`,
      sourceBranch: workerResult.branchName,
      commitMessage: `feat(${taskId}): ${workerResult.task.title}`,
      queuedAt: now,
    };

    this.queue.push(operation);

    this.emit({
      type: 'merge:queued',
      timestamp: now,
      operation,
    });

    return operation;
  }

  /**
   * Process the next merge in the queue.
   * Returns the merge result, or null if the queue is empty or already processing.
   */
  async processNext(): Promise<MergeResult | null> {
    if (this.processing) return null;

    const operation = this.queue.find((op) => op.status === 'queued');
    if (!operation) return null;

    this.processing = true;
    try {
      return await this.executeMerge(operation);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process all queued merges sequentially.
   * @returns Array of merge results
   */
  async processAll(): Promise<MergeResult[]> {
    const results: MergeResult[] = [];

    let result = await this.processNext();
    while (result) {
      results.push(result);
      result = await this.processNext();
    }

    return results;
  }

  /**
   * Get the current merge queue.
   */
  getQueue(): readonly MergeOperation[] {
    return this.queue;
  }

  /**
   * Get the number of pending merges.
   */
  getPendingCount(): number {
    return this.queue.filter((op) => op.status === 'queued').length;
  }

  /**
   * Rollback a specific merge operation using its backup tag.
   */
  rollbackMerge(operationId: string): void {
    const operation = this.queue.find((op) => op.id === operationId);
    if (!operation) {
      throw new Error(`Merge operation ${operationId} not found`);
    }

    this.git(`reset --hard "${operation.backupTag}"`);
    this.updateStatus(operation, 'rolled-back');

    this.emit({
      type: 'merge:rolled-back',
      timestamp: new Date().toISOString(),
      operationId: operation.id,
      taskId: operation.workerResult.task.id,
      backupTag: operation.backupTag,
      reason: 'Manual rollback',
    });
  }

  /**
   * Rollback all merges in this session to the session start point.
   */
  rollbackSession(): void {
    if (!this.sessionStartTag) {
      throw new Error('No session start tag available for rollback');
    }

    this.git(`reset --hard "${this.sessionStartTag}"`);

    // Mark all completed merges as rolled back
    for (const op of this.queue) {
      if (op.status === 'completed') {
        this.updateStatus(op, 'rolled-back');
      }
    }
  }

  /**
   * Clean up backup tags created during this session.
   */
  cleanupTags(): void {
    for (const op of this.queue) {
      try {
        this.git(`tag -d "${op.backupTag}"`);
      } catch {
        // Tag may not exist
      }
    }

    if (this.sessionStartTag) {
      try {
        this.git(`tag -d "${this.sessionStartTag}"`);
      } catch {
        // Tag may not exist
      }
    }
  }

  /**
   * Execute a single merge operation.
   */
  private async executeMerge(operation: MergeOperation): Promise<MergeResult> {
    const startTime = Date.now();
    const taskId = operation.workerResult.task.id;
    operation.startedAt = new Date().toISOString();
    this.updateStatus(operation, 'in-progress');

    this.emit({
      type: 'merge:started',
      timestamp: operation.startedAt,
      operationId: operation.id,
      sourceBranch: operation.sourceBranch,
      taskId,
    });

    // Pre-flight: verify branch has commits
    if (!this.branchHasCommits(operation.sourceBranch)) {
      const result = this.failMerge(
        operation,
        'Source branch has no commits ahead of HEAD',
        startTime
      );
      return result;
    }

    // Create backup tag
    try {
      this.git(`tag "${operation.backupTag}" HEAD`);
    } catch (err) {
      const result = this.failMerge(
        operation,
        `Failed to create backup tag: ${err}`,
        startTime
      );
      return result;
    }

    // Try fast-forward merge first
    try {
      this.git(`merge --ff-only "${operation.sourceBranch}"`);

      const filesChanged = this.getFilesChangedCount(operation.backupTag);
      const result = this.completeMerge(
        operation,
        'fast-forward',
        filesChanged,
        startTime
      );
      return result;
    } catch {
      // Fast-forward not possible, try regular merge
    }

    // Fall back to merge commit
    try {
      this.git(
        `merge --no-edit -m "${operation.commitMessage}" "${operation.sourceBranch}"`
      );

      const commitSha = this.git('rev-parse --short HEAD').trim();
      const filesChanged = this.getFilesChangedCount(operation.backupTag);
      const result = this.completeMerge(
        operation,
        'merge-commit',
        filesChanged,
        startTime,
        commitSha
      );
      return result;
    } catch {
      // Merge failed — check for conflicts
    }

    // Check for conflicts
    const conflictedFiles = this.getConflictedFiles();
    if (conflictedFiles.length > 0) {
      operation.conflictedFiles = conflictedFiles;
      this.updateStatus(operation, 'conflicted');

      // Abort the merge for now — conflict resolver handles this separately
      this.git('merge --abort');

      // Rollback to backup
      this.git(`reset --hard "${operation.backupTag}"`);

      this.emit({
        type: 'conflict:detected',
        timestamp: new Date().toISOString(),
        operationId: operation.id,
        taskId,
        conflicts: conflictedFiles.map(
          (f): FileConflict => ({
            filePath: f,
            oursContent: '',
            theirsContent: '',
            baseContent: '',
            conflictMarkers: '',
          })
        ),
      });

      const result: MergeResult = {
        operationId: operation.id,
        success: false,
        strategy: 'merge-commit',
        hadConflicts: true,
        filesChanged: 0,
        durationMs: Date.now() - startTime,
        error: `Merge conflicts in ${conflictedFiles.length} file(s): ${conflictedFiles.join(', ')}`,
      };

      this.emit({
        type: 'merge:failed',
        timestamp: new Date().toISOString(),
        operationId: operation.id,
        taskId,
        error: result.error!,
      });

      return result;
    }

    // Non-conflict merge failure
    const result = this.failMerge(
      operation,
      'Merge failed for unknown reason',
      startTime
    );

    // Rollback
    try {
      this.git(`reset --hard "${operation.backupTag}"`);
    } catch {
      // Best effort rollback
    }

    return result;
  }

  /**
   * Complete a successful merge operation.
   */
  private completeMerge(
    operation: MergeOperation,
    strategy: 'fast-forward' | 'merge-commit',
    filesChanged: number,
    startTime: number,
    commitSha?: string
  ): MergeResult {
    operation.completedAt = new Date().toISOString();
    this.updateStatus(operation, 'completed');

    const result: MergeResult = {
      operationId: operation.id,
      success: true,
      strategy,
      commitSha,
      hadConflicts: false,
      filesChanged,
      durationMs: Date.now() - startTime,
    };

    this.emit({
      type: 'merge:completed',
      timestamp: operation.completedAt,
      result,
      taskId: operation.workerResult.task.id,
    });

    return result;
  }

  /**
   * Fail a merge operation.
   */
  private failMerge(
    operation: MergeOperation,
    error: string,
    startTime: number
  ): MergeResult {
    operation.completedAt = new Date().toISOString();
    operation.error = error;
    this.updateStatus(operation, 'failed');

    const result: MergeResult = {
      operationId: operation.id,
      success: false,
      strategy: 'merge-commit',
      hadConflicts: false,
      filesChanged: 0,
      durationMs: Date.now() - startTime,
      error,
    };

    this.emit({
      type: 'merge:failed',
      timestamp: operation.completedAt,
      operationId: operation.id,
      taskId: operation.workerResult.task.id,
      error,
    });

    return result;
  }

  /**
   * Update a merge operation's status.
   */
  private updateStatus(operation: MergeOperation, status: MergeStatus): void {
    operation.status = status;
  }

  /**
   * Check if a branch has commits ahead of current HEAD.
   */
  private branchHasCommits(branchName: string): boolean {
    try {
      const output = this.git(
        `rev-list --count HEAD.."${branchName}"`
      );
      return parseInt(output.trim(), 10) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the number of files changed between a tag and current HEAD.
   */
  private getFilesChangedCount(fromTag: string): number {
    try {
      const output = this.git(
        `diff --name-only "${fromTag}" HEAD`
      );
      return output
        .trim()
        .split('\n')
        .filter((l) => l.trim()).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get list of conflicted files from git status.
   */
  private getConflictedFiles(): string[] {
    try {
      const output = this.git('status --porcelain');
      const conflicted: string[] = [];

      for (const line of output.split('\n')) {
        const status = line.substring(0, 2);
        // UU = both modified, AA = both added, DD = both deleted
        if (
          status === 'UU' ||
          status === 'AA' ||
          status === 'DD' ||
          status === 'AU' ||
          status === 'UA'
        ) {
          conflicted.push(line.substring(3).trim());
        }
      }

      return conflicted;
    } catch {
      return [];
    }
  }

  /**
   * Emit a parallel event to all listeners.
   */
  private emit(event: ParallelEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the merge engine
      }
    }
  }

  /**
   * Execute a git command in the main repository.
   * Pipes stdio so git output doesn't bleed through to the TUI.
   */
  private git(args: string): string {
    return execSync(`git -C "${this.cwd}" ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}
