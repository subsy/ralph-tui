/**
 * ABOUTME: ParallelExecutor — top-level coordinator for parallel task execution.
 * Analyzes task dependencies, groups independent tasks, executes them in parallel
 * git worktrees, and merges results back sequentially with conflict resolution.
 */

import { readFile, writeFile, appendFile, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import type { RalphConfig } from '../config/types.js';
import type { TrackerPlugin, TrackerTask } from '../plugins/trackers/types.js';
import type { EngineEventListener } from '../engine/types.js';
import { analyzeTaskGraph, shouldRunParallel } from './task-graph.js';
import { WorktreeManager } from './worktree-manager.js';
import { MergeEngine } from './merge-engine.js';
import { ConflictResolver, type AiResolverCallback } from './conflict-resolver.js';
import { Worker } from './worker.js';
import type {
  MergeOperation,
  ParallelExecutorConfig,
  ParallelExecutorState,
  ParallelExecutorStatus,
  TaskGraphAnalysis,
  WorkerDisplayState,
  WorkerResult,
} from './types.js';
import type {
  ParallelEvent,
  ParallelEventListener,
} from './events.js';

/** Default parallel executor configuration */
const DEFAULT_PARALLEL_CONFIG: ParallelExecutorConfig = {
  maxWorkers: 3,
  worktreeDir: '.ralph-tui/worktrees',
  cwd: process.cwd(),
  maxIterationsPerWorker: 10,
  iterationDelay: 1000,
  aiConflictResolution: true,
  maxRequeueCount: 1,
};

/**
 * Coordinates parallel execution of independent tasks using git worktrees.
 *
 * Execution flow:
 * 1. Fetch all tasks from the tracker
 * 2. Run TaskGraphAnalysis to find parallel groups
 * 3. For each group (in topological order):
 *    a. Acquire worktrees (up to maxWorkers per batch)
 *    b. Create + start workers (one per task)
 *    c. Wait for all workers in the group to complete
 *    d. Merge completed workers via merge queue (sequential)
 *    e. Handle merge conflicts (rollback + re-queue if needed)
 *    f. Release worktrees
 * 4. After all groups: cleanup all worktrees, emit completion
 */
export class ParallelExecutor {
  private readonly config: ParallelExecutorConfig;
  private readonly baseConfig: RalphConfig;
  private readonly tracker: TrackerPlugin;

  private readonly worktreeManager: WorktreeManager;
  private readonly mergeEngine: MergeEngine;
  private readonly conflictResolver: ConflictResolver;

  private status: ParallelExecutorStatus = 'idle';
  private taskGraph: TaskGraphAnalysis | null = null;
  private currentGroupIndex = 0;
  private activeWorkers: Worker[] = [];
  private completedResults: WorkerResult[] = [];
  private totalTasksCompleted = 0;
  private totalTasksFailed = 0;
  private totalMergesCompleted = 0;
  private totalConflictsResolved = 0;
  private startedAt: string | null = null;
  private sessionId: string;
  private shouldStop = false;

  private readonly parallelListeners: ParallelEventListener[] = [];
  private readonly engineListeners: EngineEventListener[] = [];

  /** Track re-queue counts per task to prevent infinite loops */
  private requeueCounts = new Map<string, number>();

  /** Track the operation with pending conflicts for retry/skip */
  private pendingConflictOperation: MergeOperation | null = null;

  /** Worker result associated with pending conflict (for re-processing) */
  private pendingConflictWorkerResult: WorkerResult | null = null;

  constructor(
    baseConfig: RalphConfig,
    tracker: TrackerPlugin,
    parallelConfig?: Partial<ParallelExecutorConfig>
  ) {
    this.baseConfig = baseConfig;
    this.tracker = tracker;
    this.sessionId = baseConfig.sessionId ?? `parallel-${Date.now()}`;

    this.config = {
      ...DEFAULT_PARALLEL_CONFIG,
      cwd: baseConfig.cwd,
      maxIterationsPerWorker: baseConfig.maxIterations,
      iterationDelay: baseConfig.iterationDelay,
      ...parallelConfig,
    };

    this.worktreeManager = new WorktreeManager({
      cwd: this.config.cwd,
      worktreeDir: this.config.worktreeDir,
      maxWorktrees: this.config.maxWorkers * 2, // Buffer for re-queued tasks
    });

    this.mergeEngine = new MergeEngine(this.config.cwd);
    this.conflictResolver = new ConflictResolver(this.config.cwd);

    // Wire up merge and conflict events
    this.mergeEngine.on((event) => this.emitParallel(event));
    this.conflictResolver.on((event) => this.emitParallel(event));
  }

  /**
   * Register a parallel event listener.
   * @returns Unsubscribe function
   */
  on(listener: ParallelEventListener): () => void {
    this.parallelListeners.push(listener);
    return () => {
      const idx = this.parallelListeners.indexOf(listener);
      if (idx >= 0) this.parallelListeners.splice(idx, 1);
    };
  }

  /**
   * Register an engine event listener for forwarded worker events.
   * @returns Unsubscribe function
   */
  onEngineEvent(listener: EngineEventListener): () => void {
    this.engineListeners.push(listener);
    return () => {
      const idx = this.engineListeners.indexOf(listener);
      if (idx >= 0) this.engineListeners.splice(idx, 1);
    };
  }

  /**
   * Set the AI conflict resolver callback.
   */
  setAiResolver(resolver: AiResolverCallback): void {
    this.conflictResolver.setAiResolver(resolver);
  }

  /**
   * Retry conflict resolution for the pending failed operation.
   * Returns true if retry was initiated, false if no pending conflict.
   */
  async retryConflictResolution(): Promise<boolean> {
    const operation = this.pendingConflictOperation;
    const workerResult = this.pendingConflictWorkerResult;

    if (!operation || !workerResult) {
      return false;
    }

    // Save tracker state before resolution to prevent stale worktree state from overwriting
    const savedState = await this.saveTrackerState();

    try {
      // Re-attempt resolution
      const resolutions = await this.conflictResolver.resolveConflicts(operation);
      const allResolved = resolutions.every((r) => r.success);

      if (allResolved) {
        // Success! Clear pending state and mark task as complete
        this.pendingConflictOperation = null;
        this.pendingConflictWorkerResult = null;

        try {
          await this.tracker.completeTask(workerResult.task.id);
        } catch {
          // Log but don't fail after successful resolution
        }

        await this.mergeProgressFile(workerResult);
        this.totalConflictsResolved += resolutions.length;
        this.totalMergesCompleted++;
        return true;
      }

      // Still failed - keep pending state for another retry
      return false;
    } finally {
      // Always restore tracker state to prevent stale worktree data from persisting
      await this.restoreTrackerState(savedState);
    }
  }

  /**
   * Skip the pending failed conflict and continue execution.
   * The task's merge will be abandoned (task remains incomplete).
   */
  skipFailedConflict(): void {
    if (this.pendingConflictOperation) {
      // Emit an event so the TUI knows to close the conflict panel
      this.emitParallel({
        type: 'conflict:resolved',
        timestamp: new Date().toISOString(),
        operationId: this.pendingConflictOperation.id,
        taskId: this.pendingConflictOperation.workerResult.task.id,
        results: [], // Empty results indicates skip
      });
    }

    this.pendingConflictOperation = null;
    this.pendingConflictWorkerResult = null;
  }

  /**
   * Check if there's a pending conflict operation.
   */
  hasPendingConflict(): boolean {
    return this.pendingConflictOperation !== null;
  }

  /**
   * Reset internal state so the executor can run again.
   * Call this before `execute()` when restarting after completion or stop.
   */
  reset(): void {
    this.shouldStop = false;
    this.status = 'idle';
    this.taskGraph = null;
    this.currentGroupIndex = 0;
    this.activeWorkers = [];
    this.completedResults = [];
    this.totalTasksCompleted = 0;
    this.totalTasksFailed = 0;
    this.totalMergesCompleted = 0;
    this.totalConflictsResolved = 0;
    this.startedAt = null;
    this.requeueCounts.clear();
    this.sessionId = `parallel-${Date.now()}`;
    this.pendingConflictOperation = null;
    this.pendingConflictWorkerResult = null;
  }

  /**
   * Analyze tasks and run parallel execution.
   * Main entry point for the parallel execution flow.
   */
  async execute(): Promise<void> {
    this.startedAt = new Date().toISOString();
    this.status = 'analyzing';

    try {
      // Fetch all tasks from the tracker
      let tasks = await this.tracker.getTasks({
        status: ['open', 'in_progress'],
      });

      // Apply task ID filter if provided (for --task-range support)
      if (this.config.filteredTaskIds && this.config.filteredTaskIds.length > 0) {
        const filteredIdSet = new Set(this.config.filteredTaskIds);
        tasks = tasks.filter((t) => filteredIdSet.has(t.id));
      }

      if (tasks.length === 0) {
        this.status = 'completed';
        return;
      }

      // Analyze task graph
      this.taskGraph = analyzeTaskGraph(tasks);

      if (!shouldRunParallel(this.taskGraph)) {
        // Fall back — this shouldn't happen if the caller checked first
        this.status = 'completed';
        return;
      }

      // Initialize session branch unless directMerge is enabled.
      // The session branch holds all worker merges, keeping the original branch clean.
      if (!this.config.directMerge) {
        const { branch, original } = this.mergeEngine.initializeSessionBranch(this.sessionId);

        this.emitParallel({
          type: 'parallel:session-branch-created',
          timestamp: new Date().toISOString(),
          sessionId: this.sessionId,
          sessionBranch: branch,
          originalBranch: original,
        });
      }

      // Create session backup (on the session branch if one was created)
      this.mergeEngine.createSessionBackup(this.sessionId);

      this.emitParallel({
        type: 'parallel:started',
        timestamp: this.startedAt,
        sessionId: this.sessionId,
        analysis: this.taskGraph,
        totalGroups: this.taskGraph.groups.length,
        totalTasks: this.taskGraph.actionableTaskCount,
        maxWorkers: this.config.maxWorkers,
      });

      // Execute groups in topological order
      for (let i = 0; i < this.taskGraph.groups.length; i++) {
        if (this.shouldStop) break;

        this.currentGroupIndex = i;
        const group = this.taskGraph.groups[i];

        await this.executeGroup(group, i);
      }

      const allActionableTasksCompleted =
        this.totalTasksCompleted >= this.taskGraph.actionableTaskCount &&
        this.totalTasksFailed === 0;
      this.status = this.shouldStop || !allActionableTasksCompleted
        ? 'interrupted'
        : 'completed';

      this.emitParallel({
        type: 'parallel:completed',
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        totalTasksCompleted: this.totalTasksCompleted,
        totalTasksFailed: this.totalTasksFailed,
        totalMergesCompleted: this.totalMergesCompleted,
        totalConflictsResolved: this.totalConflictsResolved,
        durationMs: Date.now() - new Date(this.startedAt).getTime(),
      });
    } catch (err) {
      this.status = 'failed';
      const error = err instanceof Error ? err.message : String(err);

      this.emitParallel({
        type: 'parallel:failed',
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        error,
        tasksCompletedBeforeFailure: this.totalTasksCompleted,
      });

      throw err;
    } finally {
      // Always cleanup
      await this.cleanup();
    }
  }

  /**
   * Stop parallel execution gracefully.
   * Stops all active workers and waits for them to finish.
   */
  async stop(): Promise<void> {
    this.shouldStop = true;

    // Stop all active workers
    const stopPromises = this.activeWorkers.map((w) => w.stop());
    await Promise.allSettled(stopPromises);

    this.status = 'interrupted';
  }

  /**
   * Pause all active workers after their current iterations complete.
   */
  pause(): void {
    for (const worker of this.activeWorkers) {
      worker.pause();
    }
  }

  /**
   * Resume all active workers from paused state.
   */
  resume(): void {
    for (const worker of this.activeWorkers) {
      worker.resume();
    }
  }

  /**
   * Get the current executor state for TUI rendering.
   */
  getState(): ParallelExecutorState {
    return {
      status: this.status,
      taskGraph: this.taskGraph,
      currentGroupIndex: this.currentGroupIndex,
      totalGroups: this.taskGraph?.groups.length ?? 0,
      workers: this.activeWorkers.map((w) => w.getDisplayState()),
      mergeQueue: [...this.mergeEngine.getQueue()],
      completedMerges: [],
      activeConflicts: [],
      totalTasksCompleted: this.totalTasksCompleted,
      totalTasks: this.taskGraph?.actionableTaskCount ?? 0,
      startedAt: this.startedAt,
      elapsedMs: this.startedAt
        ? Date.now() - new Date(this.startedAt).getTime()
        : 0,
    };
  }

  /**
   * Get the session branch name (e.g., "ralph-session/a4d1aae7").
   * @returns Session branch name, or null if using directMerge mode
   */
  getSessionBranch(): string | null {
    return this.mergeEngine.getSessionBranch();
  }

  /**
   * Get the original branch name before session branch was created.
   * @returns Original branch name, or null if using directMerge mode
   */
  getOriginalBranch(): string | null {
    return this.mergeEngine.getOriginalBranch();
  }

  /**
   * Get display states for all active workers.
   */
  getWorkerStates(): WorkerDisplayState[] {
    return this.activeWorkers.map((w) => w.getDisplayState());
  }

  /**
   * Execute a single parallel group.
   */
  private async executeGroup(
    group: { index: number; tasks: TrackerTask[]; depth: number },
    groupIndex: number
  ): Promise<void> {
    this.status = 'executing';
    const totalGroups = this.taskGraph!.groups.length;

    this.emitParallel({
      type: 'parallel:group-started',
      timestamp: new Date().toISOString(),
      group: { ...group, maxPriority: group.tasks[0]?.priority ?? 2 },
      groupIndex,
      totalGroups,
      workerCount: Math.min(group.tasks.length, this.config.maxWorkers),
    });

    // Split tasks into batches of maxWorkers
    const batches = this.batchTasks(group.tasks);
    let groupTasksCompleted = 0;
    let groupTasksFailed = 0;
    let groupMergesCompleted = 0;
    let groupMergesFailed = 0;

    for (const batch of batches) {
      if (this.shouldStop) break;

      // Execute batch of workers in parallel
      const results = await this.executeBatch(batch);

      // Phase 1: Attempt all merges first, collect conflicts
      this.status = 'merging';
      const pendingConflicts: Array<{
        operation: MergeOperation;
        workerResult: WorkerResult;
      }> = [];

      for (const result of results) {
        if (this.shouldStop) {
          // Stop was requested mid-batch: do not merge partial work, reopen task instead.
          groupTasksFailed++;
          this.totalTasksFailed++;
          await this.resetTaskToOpen(result.task.id);
          continue;
        }

        if (result.success && result.taskCompleted) {
          // Save tracker state before merge to prevent worktree's stale copy from overwriting
          const savedState = await this.saveTrackerState();

          // Enqueue and process merge (wrapped in try/finally to guarantee restore)
          let mergeResult: Awaited<ReturnType<typeof this.mergeEngine.processNext>>;
          this.mergeEngine.enqueue(result);
          try {
            mergeResult = await this.mergeEngine.processNext();
          } finally {
            // Restore tracker state after merge to preserve task completion status
            await this.restoreTrackerState(savedState);
          }

          if (mergeResult?.success) {
            // Merge succeeded - mark task as complete in tracker
            try {
              await this.tracker.completeTask(result.task.id);
            } catch {
              // Log but don't fail after successful merge
            }
            // Merge worker's progress.md into main so subsequent workers see learnings
            await this.mergeProgressFile(result);
            groupTasksCompleted++;
            this.totalTasksCompleted++;
            groupMergesCompleted++;
            this.totalMergesCompleted++;
          } else if (mergeResult?.hadConflicts) {
            // Collect conflict for later resolution (don't resolve yet)
            const operation = this.mergeEngine
              .getQueue()
              .find((op) => op.id === mergeResult.operationId);

            if (operation && this.config.aiConflictResolution) {
              pendingConflicts.push({ operation, workerResult: result });
            } else {
              // AI conflict resolution disabled - mark as failed
              groupTasksFailed++;
              this.totalTasksFailed++;
              groupMergesFailed++;
              await this.handleMergeFailure(result);
            }
          } else {
            // Merge failed (non-conflict) - don't mark task as complete
            groupTasksFailed++;
            this.totalTasksFailed++;
            groupMergesFailed++;
            await this.handleMergeFailure(result);
          }
        } else {
          groupTasksFailed++;
          this.totalTasksFailed++;
          await this.resetTaskToOpen(result.task.id);
        }
      }

      // Phase 2: Resolve all collected conflicts after all merges attempted
      if (pendingConflicts.length > 0) {
        if (this.shouldStop) {
          for (const { workerResult } of pendingConflicts) {
            groupTasksFailed++;
            this.totalTasksFailed++;
            groupMergesFailed++;
            await this.resetTaskToOpen(workerResult.task.id);
          }
          continue;
        }

        for (const { operation, workerResult } of pendingConflicts) {
          if (this.shouldStop) {
            groupTasksFailed++;
            this.totalTasksFailed++;
            groupMergesFailed++;
            await this.resetTaskToOpen(workerResult.task.id);
            continue;
          }

          // Save tracker state before conflict resolution
          const savedState = await this.saveTrackerState();

          // Resolve conflicts (wrapped in try/finally to guarantee restore)
          let resolutions: Awaited<ReturnType<typeof this.conflictResolver.resolveConflicts>>;
          let allResolved: boolean;
          try {
            resolutions = await this.conflictResolver.resolveConflicts(operation);
            allResolved = resolutions.every((r) => r.success);
          } finally {
            // Restore tracker state after conflict resolution
            await this.restoreTrackerState(savedState);
          }

          if (allResolved) {
            // Conflict resolution succeeded - mark task as complete
            // Only clear pending state if it refers to this conflict (not a different failed one)
            if (
              !this.pendingConflictWorkerResult ||
              this.pendingConflictWorkerResult.task.id === workerResult.task.id
            ) {
              this.pendingConflictOperation = null;
              this.pendingConflictWorkerResult = null;
            }
            try {
              await this.tracker.completeTask(workerResult.task.id);
            } catch {
              // Log but don't fail after successful resolution
            }
            // Merge worker's progress.md into main
            await this.mergeProgressFile(workerResult);
            this.totalConflictsResolved += resolutions.length;
            groupTasksCompleted++;
            this.totalTasksCompleted++;
            groupMergesCompleted++;
            this.totalMergesCompleted++;
          } else {
            // Conflict resolution failed - track for retry/skip
            this.pendingConflictOperation = operation;
            this.pendingConflictWorkerResult = workerResult;
            groupTasksFailed++;
            this.totalTasksFailed++;
            groupMergesFailed++;
            await this.handleMergeFailure(workerResult);
          }
        }
      }
    }

    this.emitParallel({
      type: 'parallel:group-completed',
      timestamp: new Date().toISOString(),
      groupIndex,
      totalGroups,
      tasksCompleted: groupTasksCompleted,
      tasksFailed: groupTasksFailed,
      mergesCompleted: groupMergesCompleted,
      mergesFailed: groupMergesFailed,
    });
  }

  /**
   * Execute a batch of tasks in parallel using workers.
   */
  private async executeBatch(tasks: TrackerTask[]): Promise<WorkerResult[]> {
    this.activeWorkers = [];

    // Create workers
    // Track branch names from worktree acquisition for failure result construction
    const branchNames: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const workerId = `w${this.currentGroupIndex}-${i}`;

      // Acquire worktree - use the sanitized branch name returned by acquire()
      // since acquire() sanitizes task IDs into valid git branch names
      const worktreeInfo = await this.worktreeManager.acquire(
        workerId,
        task.id
      );
      branchNames.push(worktreeInfo.branch);

      const worker = new Worker(
        {
          id: workerId,
          task,
          worktreePath: worktreeInfo.path,
          branchName: worktreeInfo.branch,
          cwd: this.config.cwd,
        },
        this.config.maxIterationsPerWorker
      );

      // Forward worker events
      worker.on((event) => this.emitParallel(event));
      worker.onEngineEvent((event) => {
        for (const listener of this.engineListeners) {
          try {
            listener(event);
          } catch {
            // Don't let listener errors propagate
          }
        }
      });

      // Initialize the worker engine with the shared tracker
      await worker.initialize(this.baseConfig, this.tracker);
      this.activeWorkers.push(worker);

      // Mark task as in_progress in the tracker
      try {
        await this.tracker.updateTaskStatus(task.id, 'in_progress');
      } catch {
        // Non-fatal — tracker update may fail for some trackers
      }
    }

    // Start all workers in parallel
    const workerPromises = this.activeWorkers.map((w) => w.start());
    const results = await Promise.allSettled(workerPromises);

    // Collect results
    const workerResults: WorkerResult[] = results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      // Worker promise rejected — create a failure result
      const task = tasks[i];
      return {
        workerId: this.activeWorkers[i].id,
        task,
        success: false,
        iterationsRun: 0,
        taskCompleted: false,
        durationMs: 0,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        branchName: branchNames[i],
        commitCount: 0,
      };
    });

    // Release worktrees (use "worker-" prefix to match acquire's worktreeId format)
    for (const worker of this.activeWorkers) {
      this.worktreeManager.release(`worker-${worker.id}`);
    }

    this.completedResults.push(...workerResults);
    this.activeWorkers = [];

    return workerResults;
  }

  /**
   * Handle a merge failure by tracking retries and resetting the task to open.
   */
  private async handleMergeFailure(result: WorkerResult): Promise<void> {
    const taskId = result.task.id;
    const currentCount = this.requeueCounts.get(taskId) ?? 0;

    if (currentCount < this.config.maxRequeueCount) {
      this.requeueCounts.set(taskId, currentCount + 1);
    }

    await this.resetTaskToOpen(taskId);
  }

  /**
   * Best-effort reset of a task status to open.
   * Prevents tasks from remaining stuck in in_progress after cancellation/failure.
   */
  private async resetTaskToOpen(taskId: string): Promise<void> {
    try {
      await this.tracker.updateTaskStatus(taskId, 'open');
    } catch {
      // Best effort
    }
  }

  /**
   * Split tasks into batches of maxWorkers size.
   */
  private batchTasks(tasks: TrackerTask[]): TrackerTask[][] {
    const batches: TrackerTask[][] = [];
    for (let i = 0; i < tasks.length; i += this.config.maxWorkers) {
      batches.push(tasks.slice(i, i + this.config.maxWorkers));
    }
    return batches;
  }

  /**
   * Clean up all resources.
   */
  private async cleanup(): Promise<void> {
    try {
      await this.worktreeManager.cleanupAll();
    } catch {
      // Best effort cleanup
    }

    try {
      this.mergeEngine.cleanupTags();
    } catch {
      // Best effort cleanup
    }

    // Return to original branch if a session branch was created.
    // This leaves the session branch with all merged changes, but the user
    // is back on their original branch ready for next steps.
    if (!this.config.directMerge) {
      try {
        this.mergeEngine.returnToOriginalBranch();
      } catch {
        // Best effort — user may need to checkout manually
      }
    }
  }

  /**
   * Merge a worker's progress.md into the main progress.md.
   * This allows learnings from completed tasks to be visible to subsequent workers.
   */
  private async mergeProgressFile(workerResult: WorkerResult): Promise<void> {
    if (!workerResult.worktreePath) return;

    const workerProgressPath = join(workerResult.worktreePath, '.ralph-tui', 'progress.md');
    const mainProgressPath = join(this.config.cwd, '.ralph-tui', 'progress.md');

    try {
      // Check if worker's progress file exists
      await access(workerProgressPath, constants.R_OK);

      // Read the worker's progress content
      const workerProgress = await readFile(workerProgressPath, 'utf-8');
      if (!workerProgress.trim()) return;

      // Append to main progress file with a separator
      const separator = `\n\n---\n\n## Parallel Task: ${workerResult.task.title} (${workerResult.task.id})\n\n`;
      await appendFile(mainProgressPath, separator + workerProgress);
    } catch {
      // Silently ignore if worker progress file doesn't exist or can't be read
    }
  }

  /**
   * Save tracker state files before a merge operation.
   * Returns a map of file paths to their contents for later restoration.
   *
   * This prevents git merge from overwriting tracker state (like task completion status)
   * with stale versions from worker worktrees.
   */
  private async saveTrackerState(): Promise<Map<string, string>> {
    const savedState = new Map<string, string>();

    if (typeof this.tracker.getStateFiles !== 'function') {
      return savedState;
    }

    const stateFiles = this.tracker.getStateFiles();
    for (const filePath of stateFiles) {
      try {
        const content = await readFile(filePath, 'utf-8');
        savedState.set(filePath, content);
      } catch {
        // File may not exist yet - that's fine
      }
    }

    return savedState;
  }

  /**
   * Restore tracker state files after a merge operation.
   * This ensures tracker state (task completion status) is not overwritten
   * by stale versions from worker worktrees during git merge.
   */
  private async restoreTrackerState(savedState: Map<string, string>): Promise<void> {
    for (const [filePath, content] of savedState) {
      try {
        await writeFile(filePath, content, 'utf-8');
        // Clear tracker's cache so it re-reads the restored content
        const tracker = this.tracker as unknown as { clearCache?: () => void };
        if (typeof tracker.clearCache === 'function') {
          tracker.clearCache();
        }
      } catch {
        // Best effort - log but don't fail
      }
    }
  }

  /**
   * Emit a parallel event to all listeners.
   */
  private emitParallel(event: ParallelEvent): void {
    for (const listener of this.parallelListeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the executor
      }
    }
  }
}

// Re-export key types and functions for convenient imports
export { analyzeTaskGraph, shouldRunParallel, recommendParallelism } from './task-graph.js';
export { WorktreeManager } from './worktree-manager.js';
export { MergeEngine } from './merge-engine.js';
export { ConflictResolver } from './conflict-resolver.js';
export { Worker } from './worker.js';
export type {
  ParallelExecutorConfig,
  ParallelExecutorState,
  ParallelExecutorStatus,
  TaskGraphAnalysis,
  ParallelGroup,
  WorkerResult,
  WorkerDisplayState,
  MergeResult,
  MergeOperation,
  FileConflict,
  ConflictResolutionResult,
  ParallelismRecommendation,
  ParallelismConfidence,
} from './types.js';
export type {
  ParallelEvent,
  ParallelEventType,
  ParallelEventListener,
} from './events.js';
