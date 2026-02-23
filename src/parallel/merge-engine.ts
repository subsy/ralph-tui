/**
 * ABOUTME: Sequential merge queue for parallel execution.
 * Merges completed worker branches back into the main branch one at a time.
 * Uses fast-forward when possible, falls back to merge commits, and supports
 * rollback via backup tags for safety.
 */

import { execFileSync } from 'node:child_process';

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
  // A lone '@' is not a valid ref (it's a shorthand for HEAD)
  if (ref === '@') {
    throw new Error(`Invalid git ref for ${context}: is '@'`);
  }
  // Cannot contain spaces
  if (ref.includes(' ')) {
    throw new Error(`Invalid git ref for ${context}: contains spaces`);
  }
  // Cannot contain double dots
  if (ref.includes('..')) {
    throw new Error(`Invalid git ref for ${context}: contains '..'`);
  }
  // Cannot contain control characters (use char code scan instead of regex for lint compliance)
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`Invalid git ref for ${context}: contains control characters`);
    }
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
  // Cannot end with a slash
  if (ref.endsWith('/')) {
    throw new Error(`Invalid git ref for ${context}: ends with '/'`);
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

  /** Session branch name (e.g., "ralph-session/a4d1aae7") */
  private sessionBranch: string | null = null;

  /** Original branch name before session branch was created */
  private originalBranch: string | null = null;

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
    validateGitRef(tag, 'sessionBackupTag');
    this.git(['tag', tag, 'HEAD']);
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
   * Initialize a session branch for parallel execution.
   *
   * Creates a new branch `ralph-session/{shortId}` from the current HEAD.
   * All worker changes will be merged to this branch instead of the original branch.
   * This enables safer parallel workflows: the session branch can be merged via PR,
   * or discarded entirely by deleting the branch.
   *
   * @param sessionId - Full session ID (will be truncated to first 8 chars)
   * @returns Object with the session branch name and original branch name
   */
  initializeSessionBranch(sessionId: string): { branch: string; original: string } {
    // Get current branch name
    const currentBranch = this.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    this.originalBranch = currentBranch;

    // Create session branch name from first 8 chars of session ID
    const shortId = sessionId.replace(/^parallel-/, '').slice(0, 8);
    let branchName = `ralph-session/${shortId}`;

    // Handle collision by appending counter suffix
    let counter = 1;
    while (this.branchExists(branchName)) {
      counter++;
      branchName = `ralph-session/${shortId}-${counter}`;
    }

    validateGitRef(branchName, 'sessionBranch');

    // Create and checkout the session branch
    this.git(['checkout', '-b', branchName]);
    this.sessionBranch = branchName;

    return { branch: branchName, original: currentBranch };
  }

  /**
   * Get the session branch name.
   * @returns Session branch name, or null if not using session branches
   */
  getSessionBranch(): string | null {
    return this.sessionBranch;
  }

  /**
   * Get the original branch name before session branch was created.
   * @returns Original branch name, or null if not using session branches
   */
  getOriginalBranch(): string | null {
    return this.originalBranch;
  }

  /**
   * Return to the original branch after parallel execution completes.
   * Does nothing if no session branch was created (directMerge mode).
   */
  returnToOriginalBranch(): void {
    if (!this.originalBranch) {
      return;
    }

    try {
      validateGitRef(this.originalBranch, 'originalBranch');
      this.git(['checkout', this.originalBranch]);
    } catch {
      // Don't throw — best effort to return to original branch
    }
  }

  /**
   * Check if a branch exists in the repository.
   */
  private branchExists(branchName: string): boolean {
    try {
      this.git(['rev-parse', '--verify', `refs/heads/${branchName}`]);
      return true;
    } catch {
      return false;
    }
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

    validateGitRef(operation.backupTag, 'backupTag');
    this.git(['reset', '--hard', operation.backupTag]);
    // Intentionally avoid `git clean -fd` here to prevent deleting untracked
    // project artifacts such as PRD/task files.
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

    validateGitRef(this.sessionStartTag, 'sessionStartTag');
    this.git(['reset', '--hard', this.sessionStartTag]);
    // Intentionally avoid `git clean -fd` here to prevent deleting untracked
    // project artifacts such as PRD/task files.

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
        this.git(['tag', '-d', op.backupTag]);
      } catch {
        // Tag may not exist
      }
    }

    if (this.sessionStartTag) {
      try {
        this.git(['tag', '-d', this.sessionStartTag]);
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
        'No commits to merge. The agent may have completed the task but created no committable files. ' +
          'Common cause: output files are in .gitignore.',
        startTime
      );
      return result;
    }

    // Create backup tag
    try {
      validateGitRef(operation.backupTag, 'backupTag');
      this.git(['tag', operation.backupTag, 'HEAD']);
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
      validateGitRef(operation.sourceBranch, 'sourceBranch');
      this.git(['merge', '--ff-only', operation.sourceBranch]);

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
      // Use argument array to avoid shell injection with commit message
      this.git(['merge', '--no-edit', '-m', operation.commitMessage, operation.sourceBranch]);

      const commitSha = this.git(['rev-parse', '--short', 'HEAD']).trim();
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
      this.git(['merge', '--abort']);

      // Rollback to backup tag. Avoid `git clean -fd` so untracked project files
      // (for example tasks/prd.json) are never removed.
      this.git(['reset', '--hard', operation.backupTag]);

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

    // Rollback tracked files only. Avoid `git clean -fd` to prevent removing
    // unrelated untracked artifacts in the repository.
    try {
      this.git(['reset', '--hard', operation.backupTag]);
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
      validateGitRef(branchName, 'branchName');
      const output = this.git(['rev-list', '--count', `HEAD..${branchName}`]);
      const count = parseInt(output.trim(), 10);
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the number of files changed between a tag and current HEAD.
   */
  private getFilesChangedCount(fromTag: string): number {
    try {
      validateGitRef(fromTag, 'fromTag');
      const output = this.git(['diff', '--name-only', fromTag, 'HEAD']);
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
      const output = this.git(['status', '--porcelain']);
      const conflicted: string[] = [];

      for (const line of output.split('\n')) {
        const status = line.substring(0, 2);
        // Unmerged status codes:
        // UU = both modified, AA = both added, DD = both deleted,
        // AU = added by us, UA = added by them,
        // DU = deleted by us (modified by them), UD = deleted by them (modified by us)
        if (
          status === 'UU' ||
          status === 'AA' ||
          status === 'DD' ||
          status === 'AU' ||
          status === 'UA' ||
          status === 'DU' ||
          status === 'UD'
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
   * Uses execFileSync with argument array to prevent shell injection.
   * Pipes stdio so git output doesn't bleed through to the TUI.
   */
  private git(args: string[]): string {
    return execFileSync('git', ['-C', this.cwd, ...args], {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}
