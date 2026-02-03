/**
 * ABOUTME: Type definitions for the parallel execution system.
 * Defines worker states, worktree management, merge operations, conflict resolution,
 * task graph analysis, and parallel session persistence types.
 */

import type { TrackerTask, TaskPriority } from '../plugins/trackers/types.js';

// ─── Worker Types ──────────────────────────────────────────────────────────────

/**
 * Status of a parallel worker.
 * - 'idle': Worker created but not yet started
 * - 'running': Actively executing a task in its worktree
 * - 'completed': Task finished successfully
 * - 'failed': Task execution failed
 * - 'cancelled': Worker was cancelled (e.g., Ctrl+C)
 */
export type WorkerStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Configuration for a single parallel worker.
 */
export interface WorkerConfig {
  /** Unique identifier for this worker (e.g., "worker-1") */
  id: string;

  /** The task assigned to this worker */
  task: TrackerTask;

  /** Path to the git worktree this worker operates in */
  worktreePath: string;

  /** Branch name in the worktree (e.g., "ralph-parallel/task-123") */
  branchName: string;

  /** Working directory for the project (the main repo cwd) */
  cwd: string;
}

/**
 * Result of a worker's execution.
 */
export interface WorkerResult {
  /** Worker that produced this result */
  workerId: string;

  /** Task that was executed */
  task: TrackerTask;

  /** Whether the task completed successfully */
  success: boolean;

  /** Number of iterations the worker ran */
  iterationsRun: number;

  /** Whether the task was marked as completed by the agent */
  taskCompleted: boolean;

  /** Duration of the worker's execution in milliseconds */
  durationMs: number;

  /** Error message if the worker failed */
  error?: string;

  /** Branch name containing the worker's commits */
  branchName: string;

  /** Number of commits made in the worktree */
  commitCount: number;

  /** Path to the worktree directory (for progress.md merging) */
  worktreePath?: string;
}

/**
 * Display state for a worker in the TUI.
 */
export interface WorkerDisplayState {
  /** Worker identifier */
  id: string;

  /** Current status */
  status: WorkerStatus;

  /** Task being worked on */
  task: TrackerTask;

  /** Current iteration number within this worker */
  currentIteration: number;

  /** Maximum iterations for this worker */
  maxIterations: number;

  /** Latest output line from the agent */
  lastOutput: string;

  /** Elapsed time in milliseconds since worker started */
  elapsedMs: number;

  /** Path to the git worktree (for display in detail view) */
  worktreePath?: string;

  /** Git branch name (e.g., "ralph-parallel/TASK-001") */
  branchName?: string;

  /** Latest commit SHA on this worker's branch (short form) */
  commitSha?: string;
}

// ─── Worktree Types ────────────────────────────────────────────────────────────

/**
 * Information about a managed git worktree.
 */
export interface WorktreeInfo {
  /** Unique identifier for this worktree */
  id: string;

  /** Absolute filesystem path to the worktree */
  path: string;

  /** Git branch name used by this worktree */
  branch: string;

  /** Worker ID currently using this worktree (if any) */
  workerId?: string;

  /** Task ID this worktree was created for */
  taskId: string;

  /** Whether the worktree is currently in use */
  active: boolean;

  /** Whether the worktree has uncommitted changes */
  dirty: boolean;

  /** Timestamp when the worktree was created (ISO 8601) */
  createdAt: string;
}

/**
 * Configuration for the worktree manager.
 */
export interface WorktreeManagerConfig {
  /** Base directory for worktrees (default: ".ralph-tui/worktrees") */
  worktreeDir: string;

  /** Working directory of the main repository */
  cwd: string;

  /** Maximum number of concurrent worktrees */
  maxWorktrees: number;

  /** Minimum free disk space in bytes before creating a worktree */
  minFreeDiskSpace: number;
}

// ─── Merge Types ───────────────────────────────────────────────────────────────

/**
 * Status of a merge operation.
 * - 'queued': Waiting in the merge queue
 * - 'in-progress': Merge is currently running
 * - 'completed': Merge completed successfully
 * - 'conflicted': Merge has conflicts requiring resolution
 * - 'failed': Merge failed (non-conflict error)
 * - 'rolled-back': Merge was rolled back after failure
 */
export type MergeStatus =
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'conflicted'
  | 'failed'
  | 'rolled-back';

/**
 * A single merge operation in the merge queue.
 */
export interface MergeOperation {
  /** Unique identifier for this merge operation */
  id: string;

  /** Worker result that produced the changes to merge */
  workerResult: WorkerResult;

  /** Current status of the merge */
  status: MergeStatus;

  /** Git backup tag created before the merge (for rollback) */
  backupTag: string;

  /** Branch being merged into main */
  sourceBranch: string;

  /** Commit message for the merge commit */
  commitMessage: string;

  /** Timestamp when the merge was queued (ISO 8601) */
  queuedAt: string;

  /** Timestamp when the merge started (ISO 8601) */
  startedAt?: string;

  /** Timestamp when the merge completed (ISO 8601) */
  completedAt?: string;

  /** Error message if the merge failed */
  error?: string;

  /** Files that had conflicts (if any) */
  conflictedFiles?: string[];
}

/**
 * Result of a completed merge operation.
 */
export interface MergeResult {
  /** Merge operation this result belongs to */
  operationId: string;

  /** Whether the merge succeeded */
  success: boolean;

  /** Merge strategy used ('fast-forward' or 'merge-commit') */
  strategy: 'fast-forward' | 'merge-commit';

  /** Short SHA of the merge commit (if merge-commit strategy) */
  commitSha?: string;

  /** Whether conflicts were encountered and resolved */
  hadConflicts: boolean;

  /** Number of files merged */
  filesChanged: number;

  /** Duration of the merge in milliseconds */
  durationMs: number;

  /** Error message if the merge failed */
  error?: string;
}

// ─── Conflict Resolution Types ─────────────────────────────────────────────────

/**
 * A single file conflict during a merge.
 */
export interface FileConflict {
  /** Path to the conflicting file (relative to repo root) */
  filePath: string;

  /** Content from our side (current branch) */
  oursContent: string;

  /** Content from their side (merging branch) */
  theirsContent: string;

  /** Content from the common ancestor (merge base) */
  baseContent: string;

  /** Raw conflict markers in the file */
  conflictMarkers: string;
}

/**
 * Result of resolving a conflict (single file).
 */
export interface ConflictResolutionResult {
  /** Path to the resolved file */
  filePath: string;

  /** Whether the resolution was successful */
  success: boolean;

  /** How the conflict was resolved */
  method: 'ai' | 'manual' | 'ours' | 'theirs';

  /** The resolved content (written to the file) */
  resolvedContent?: string;

  /** Error message if resolution failed */
  error?: string;
}

// ─── Parallel Executor Types ───────────────────────────────────────────────────

/**
 * Configuration for the ParallelExecutor.
 */
export interface ParallelExecutorConfig {
  /** Maximum number of concurrent workers (default: 3) */
  maxWorkers: number;

  /** Base directory for worktrees (default: ".ralph-tui/worktrees") */
  worktreeDir: string;

  /** Working directory of the main repository */
  cwd: string;

  /** Maximum iterations per worker */
  maxIterationsPerWorker: number;

  /** Delay between iterations within each worker (ms) */
  iterationDelay: number;

  /** Whether to attempt AI-assisted conflict resolution */
  aiConflictResolution: boolean;

  /** Maximum times a task can be re-queued after conflict (default: 1) */
  maxRequeueCount: number;

  /**
   * Merge directly to the current branch instead of creating a session branch.
   * When false (default), a session branch `ralph-session/{shortId}` is created
   * and all worker changes are merged there. When true, uses the legacy behavior
   * of merging directly to the current branch.
   */
  directMerge?: boolean;

  /**
   * Optional list of task IDs to execute. When provided, only tasks with these
   * IDs will be executed, filtering out any others returned by the tracker.
   * Used for --task-range filtering.
   */
  filteredTaskIds?: string[];
}

/**
 * Status of the overall parallel executor.
 * - 'idle': Not started
 * - 'analyzing': Running task graph analysis
 * - 'executing': Workers are running
 * - 'merging': Merging completed workers back to main
 * - 'completed': All groups finished
 * - 'failed': Fatal error stopped execution
 * - 'interrupted': Cancelled by user
 */
export type ParallelExecutorStatus =
  | 'idle'
  | 'analyzing'
  | 'executing'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'interrupted';

/**
 * Current state of the ParallelExecutor for TUI rendering.
 */
export interface ParallelExecutorState {
  /** Current executor status */
  status: ParallelExecutorStatus;

  /** Task graph analysis results */
  taskGraph: TaskGraphAnalysis | null;

  /** Index of the current group being executed (0-based) */
  currentGroupIndex: number;

  /** Total number of parallel groups */
  totalGroups: number;

  /** Active workers and their display states */
  workers: WorkerDisplayState[];

  /** Merge queue state */
  mergeQueue: MergeOperation[];

  /** Completed merge results */
  completedMerges: MergeResult[];

  /** Active conflict resolution (if any) */
  activeConflicts: FileConflict[];

  /** Total tasks completed across all workers */
  totalTasksCompleted: number;

  /** Total tasks assigned across all workers */
  totalTasks: number;

  /** Timestamp when parallel execution started (ISO 8601) */
  startedAt: string | null;

  /** Elapsed time in milliseconds */
  elapsedMs: number;
}

// ─── Session Persistence Types ─────────────────────────────────────────────────

/**
 * Persisted state for crash recovery of parallel sessions.
 */
export interface ParallelSessionState {
  /** Session identifier */
  sessionId: string;

  /** Snapshot of the task graph at session start */
  taskGraph: TaskGraphAnalysis;

  /** Index of the last completed group */
  lastCompletedGroupIndex: number;

  /** IDs of tasks that have been successfully merged */
  mergedTaskIds: string[];

  /** IDs of tasks that failed and were not merged */
  failedTaskIds: string[];

  /** IDs of tasks that were re-queued due to conflicts */
  requeuedTaskIds: string[];

  /** Git tag created at session start for full rollback */
  sessionStartTag: string;

  /** Timestamp when the session started (ISO 8601) */
  startedAt: string;

  /** Timestamp of the last state update (ISO 8601) */
  lastUpdatedAt: string;

  /**
   * Session branch name (e.g., "ralph-session/a4d1aae7").
   * All worker changes are merged to this branch. After completion,
   * the user can merge this to main via PR or direct merge.
   * Only set when directMerge is false (the default).
   */
  sessionBranch?: string;

  /**
   * Original branch name that was checked out when the session started.
   * Used to return to this branch after parallel execution completes.
   * Only set when directMerge is false (the default).
   */
  originalBranch?: string;
}

// ─── Task Graph Types ──────────────────────────────────────────────────────────

/**
 * A node in the task dependency graph.
 */
export interface TaskGraphNode {
  /** The task this node represents */
  task: TrackerTask;

  /** IDs of tasks this node depends on (must complete before this) */
  dependencies: string[];

  /** IDs of tasks that depend on this node (blocked by this) */
  dependents: string[];

  /** Topological depth (0 = no dependencies, higher = deeper in the graph) */
  depth: number;

  /** Whether this node is part of a dependency cycle */
  inCycle: boolean;
}

/**
 * A group of tasks that can execute in parallel.
 * All tasks in a group have the same topological depth and no mutual dependencies.
 */
export interface ParallelGroup {
  /** Group index (0-based, corresponds to topological depth) */
  index: number;

  /** Tasks in this group (can run in parallel) */
  tasks: TrackerTask[];

  /** Topological depth of tasks in this group */
  depth: number;

  /** Maximum priority among tasks in this group (lower = higher priority) */
  maxPriority: TaskPriority;
}

/**
 * Result of analyzing a task graph for parallel execution.
 */
export interface TaskGraphAnalysis {
  /** All nodes in the dependency graph */
  nodes: Map<string, TaskGraphNode>;

  /** Ordered groups of tasks that can run in parallel */
  groups: ParallelGroup[];

  /** Task IDs that are part of dependency cycles (cannot be scheduled) */
  cyclicTaskIds: string[];

  /** Total number of actionable tasks (non-cyclic) */
  actionableTaskCount: number;

  /** Maximum parallelism achievable (size of largest group) */
  maxParallelism: number;

  /** Whether parallel execution is recommended (based on heuristics) */
  recommendParallel: boolean;
}

// ─── Smart Parallelism Heuristics ──────────────────────────────────────────────

/**
 * Confidence level for parallelism recommendations.
 * - 'high': Strong signal from task characteristics (e.g., 50%+ test tasks or refactors)
 * - 'medium': Moderate signal (e.g., significant file overlap detected)
 * - 'low': No strong patterns detected, recommendation is default
 */
export type ParallelismConfidence = 'high' | 'medium' | 'low';

/**
 * Recommendation for parallel worker count based on task characteristics.
 * Used by smart heuristics to adjust workers before execution.
 */
export interface ParallelismRecommendation {
  /** Recommended number of workers */
  recommendedWorkers: number;

  /** Confidence level of the recommendation */
  confidence: ParallelismConfidence;

  /** Human-readable reason for the recommendation */
  reason: string;
}
