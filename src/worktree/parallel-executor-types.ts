/**
 * ABOUTME: Type definitions for the Parallel Executor.
 * Defines types for executing tasks in parallel with continue-on-error semantics,
 * collecting failures, and generating detailed failure reports.
 */

import type { ManagedWorktree } from './types.js';
import type { ParallelWorkUnit, GraphTask } from './task-graph-types.js';

/**
 * Status of a parallel task execution.
 */
export type ParallelTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Result of executing a single task in a parallel work unit.
 */
export interface ParallelTaskResult {
  /** Task that was executed */
  task: GraphTask;

  /** Status of the task execution */
  status: ParallelTaskStatus;

  /** Associated worktree (for debugging failed state) */
  worktree?: ManagedWorktree;

  /** Start time of execution */
  startedAt: Date;

  /** End time of execution */
  endedAt?: Date;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Stdout from the agent execution */
  stdout?: string;

  /** Stderr from the agent execution */
  stderr?: string;

  /** Exit code from agent process */
  exitCode?: number;

  /** Error details if failed */
  error?: TaskExecutionError;
}

/**
 * Detailed error information for a failed task.
 */
export interface TaskExecutionError {
  /** Error message */
  message: string;

  /** Error code/type */
  code?: string;

  /** Stack trace (if available) */
  stack?: string;

  /** Phase where failure occurred */
  phase: TaskFailurePhase;

  /** Timestamp when error occurred */
  occurredAt: Date;
}

/**
 * Phase in which a task execution failure occurred.
 */
export type TaskFailurePhase =
  | 'worktree_acquisition'
  | 'agent_spawn'
  | 'agent_execution'
  | 'agent_timeout'
  | 'merge_conflict'
  | 'unknown';

/**
 * Attribution information for a failed agent/task.
 */
export interface FailureAttribution {
  /** Task that failed */
  taskId: string;

  /** Task title for display */
  taskTitle: string;

  /** Agent ID that was executing the task */
  agentId: string;

  /** Agent name for display */
  agentName?: string;

  /** Worktree ID (for state preservation) */
  worktreeId: string;

  /** Worktree path (for debugging) */
  worktreePath: string;

  /** Work unit this task belonged to */
  workUnitId: string;

  /** Work unit name */
  workUnitName: string;

  /** Error that caused the failure */
  error: TaskExecutionError;

  /** Duration before failure (ms) */
  durationMs: number;
}

/**
 * Summary statistics for the failure report.
 */
export interface FailureSummary {
  /** Total number of tasks executed */
  totalTasks: number;

  /** Number of tasks completed successfully */
  completedTasks: number;

  /** Number of tasks that failed */
  failedTasks: number;

  /** Number of tasks cancelled (due to shutdown/abort) */
  cancelledTasks: number;

  /** Total execution duration (ms) */
  totalDurationMs: number;

  /** Success rate (0-100) */
  successRate: number;

  /** Whether all failures should be considered blockers */
  hasBlockingFailures: boolean;
}

/**
 * Detailed log entry for a failed agent.
 */
export interface FailedAgentLog {
  /** Attribution for the failure */
  attribution: FailureAttribution;

  /** Full stdout captured before failure */
  stdout: string;

  /** Full stderr captured before failure */
  stderr: string;

  /** Exit code (if available) */
  exitCode?: number;

  /** Environment variables (sanitized) */
  environment?: Record<string, string>;

  /** Command that was executed */
  command?: string;

  /** Arguments passed to the command */
  args?: string[];
}

/**
 * Complete failure report for a parallel execution run.
 */
export interface ParallelExecutionFailureReport {
  /** Unique identifier for this report */
  id: string;

  /** When the report was generated */
  generatedAt: Date;

  /** Summary statistics */
  summary: FailureSummary;

  /** Detailed failure attributions */
  failures: FailureAttribution[];

  /** Detailed logs per failed agent */
  failedAgentLogs: FailedAgentLog[];

  /** Work units that were executed */
  workUnits: ParallelWorkUnit[];

  /** Preserved worktree paths for debugging */
  preservedWorktrees: Array<{
    worktreeId: string;
    path: string;
    branch: string;
    taskId: string;
    errorMessage: string;
  }>;

  /** Human-readable report text */
  formattedReport: string;
}

/**
 * Result of a complete parallel execution run.
 */
export interface ParallelExecutionResult {
  /** Whether all tasks completed successfully */
  success: boolean;

  /** Total tasks attempted */
  totalTasks: number;

  /** Tasks completed successfully */
  completedTasks: number;

  /** Tasks that failed */
  failedTasks: number;

  /** Tasks that were cancelled */
  cancelledTasks: number;

  /** All task results */
  results: ParallelTaskResult[];

  /** Failure report (if any failures occurred) */
  failureReport?: ParallelExecutionFailureReport;

  /** Start time of execution */
  startedAt: Date;

  /** End time of execution */
  endedAt: Date;

  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Configuration for the parallel executor.
 */
export interface ParallelExecutorConfig {
  /** Maximum number of concurrent task executions (default: 4) */
  maxConcurrency: number;

  /** Whether to continue executing remaining tasks when one fails (default: true) */
  continueOnError: boolean;

  /** Whether to preserve failed worktree state for debugging (default: true) */
  preserveFailedWorktrees: boolean;

  /** Timeout for individual task execution in milliseconds (default: 600000 = 10min) */
  taskTimeoutMs: number;

  /** Whether to generate detailed failure reports (default: true) */
  generateDetailedReports: boolean;

  /** Working directory for git operations */
  workingDir: string;

  /** Directory for storing failure reports */
  reportDir?: string;

  /** Whether to capture full stdout/stderr for failures (default: true) */
  captureFullOutput: boolean;

  /** Maximum output size to capture per task in bytes (default: 1MB) */
  maxOutputSizeBytes: number;
}

/**
 * Default configuration for the parallel executor.
 */
export const DEFAULT_PARALLEL_EXECUTOR_CONFIG: ParallelExecutorConfig = {
  maxConcurrency: 4,
  continueOnError: true,
  preserveFailedWorktrees: true,
  taskTimeoutMs: 600000, // 10 minutes
  generateDetailedReports: true,
  workingDir: process.cwd(),
  captureFullOutput: true,
  maxOutputSizeBytes: 1024 * 1024, // 1MB
};

/**
 * Events emitted by the parallel executor.
 */
export type ParallelExecutorEvent =
  | { type: 'execution_started'; workUnits: ParallelWorkUnit[]; config: ParallelExecutorConfig }
  | { type: 'task_started'; task: GraphTask; worktree: ManagedWorktree; agentId: string }
  | { type: 'task_completed'; result: ParallelTaskResult }
  | { type: 'task_failed'; result: ParallelTaskResult; continueExecution: boolean }
  | { type: 'task_cancelled'; task: GraphTask; reason: string }
  | { type: 'work_unit_completed'; workUnit: ParallelWorkUnit; results: ParallelTaskResult[] }
  | { type: 'execution_completed'; result: ParallelExecutionResult }
  | { type: 'failure_report_generated'; report: ParallelExecutionFailureReport }
  | { type: 'worktree_preserved'; worktreeId: string; path: string; taskId: string; error: string };

/**
 * Callback type for parallel executor event listeners.
 */
export type ParallelExecutorEventListener = (event: ParallelExecutorEvent) => void;

/**
 * Statistics tracked by the parallel executor.
 */
export interface ParallelExecutorStats {
  /** Total executions run */
  totalExecutions: number;

  /** Total tasks executed */
  totalTasksExecuted: number;

  /** Total tasks completed successfully */
  totalTasksCompleted: number;

  /** Total tasks failed */
  totalTasksFailed: number;

  /** Total tasks cancelled */
  totalTasksCancelled: number;

  /** Average execution time per task (ms) */
  avgTaskDurationMs: number;

  /** Total execution time across all runs (ms) */
  totalExecutionTimeMs: number;

  /** Number of worktrees preserved for debugging */
  worktreesPreserved: number;

  /** Last execution timestamp */
  lastExecutionAt?: Date;
}
