/**
 * ABOUTME: Event types for the parallel execution system.
 * Defines worker lifecycle, merge, conflict resolution, and session-level events
 * following the EngineEventBase pattern from the core engine.
 */

import type { EngineEventBase } from '../engine/types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type {
  WorkerResult,
  MergeResult,
  MergeOperation,
  FileConflict,
  ConflictResolutionResult,
  ParallelGroup,
  TaskGraphAnalysis,
} from './types.js';

// ─── Parallel Event Type Union ─────────────────────────────────────────────────

/**
 * All parallel-specific event types.
 */
export type ParallelEventType =
  // Worker lifecycle
  | 'worker:created'
  | 'worker:started'
  | 'worker:progress'
  | 'worker:completed'
  | 'worker:failed'
  | 'worker:output'
  // Merge lifecycle
  | 'merge:queued'
  | 'merge:started'
  | 'merge:completed'
  | 'merge:failed'
  | 'merge:rolled-back'
  // Conflict resolution
  | 'conflict:detected'
  | 'conflict:ai-resolving'
  | 'conflict:ai-resolved'
  | 'conflict:ai-failed'
  | 'conflict:resolved'
  // Session-level
  | 'parallel:started'
  | 'parallel:session-branch-created'
  | 'parallel:group-started'
  | 'parallel:group-completed'
  | 'parallel:completed'
  | 'parallel:failed';

// ─── Worker Events ─────────────────────────────────────────────────────────────

/** Emitted when a new worker is created with an assigned task and worktree. */
export interface WorkerCreatedEvent extends EngineEventBase {
  type: 'worker:created';
  workerId: string;
  task: TrackerTask;
  worktreePath: string;
  branchName: string;
}

/** Emitted when a worker begins executing its task. */
export interface WorkerStartedEvent extends EngineEventBase {
  type: 'worker:started';
  workerId: string;
  task: TrackerTask;
}

/** Emitted periodically with worker progress updates. */
export interface WorkerProgressEvent extends EngineEventBase {
  type: 'worker:progress';
  workerId: string;
  task: TrackerTask;
  currentIteration: number;
  maxIterations: number;
}

/** Emitted when a worker finishes its task successfully. */
export interface WorkerCompletedEvent extends EngineEventBase {
  type: 'worker:completed';
  workerId: string;
  result: WorkerResult;
}

/** Emitted when a worker fails during task execution. */
export interface WorkerFailedEvent extends EngineEventBase {
  type: 'worker:failed';
  workerId: string;
  task: TrackerTask;
  error: string;
}

/** Emitted for streaming output from a worker's agent. */
export interface WorkerOutputEvent extends EngineEventBase {
  type: 'worker:output';
  workerId: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

// ─── Merge Events ──────────────────────────────────────────────────────────────

/** Emitted when a completed worker's branch is added to the merge queue. */
export interface MergeQueuedEvent extends EngineEventBase {
  type: 'merge:queued';
  operation: MergeOperation;
}

/** Emitted when a merge operation begins. */
export interface MergeStartedEvent extends EngineEventBase {
  type: 'merge:started';
  operationId: string;
  sourceBranch: string;
  taskId: string;
}

/** Emitted when a merge completes successfully. */
export interface MergeCompletedEvent extends EngineEventBase {
  type: 'merge:completed';
  result: MergeResult;
  taskId: string;
}

/** Emitted when a merge fails (non-conflict error). */
export interface MergeFailedEvent extends EngineEventBase {
  type: 'merge:failed';
  operationId: string;
  taskId: string;
  error: string;
}

/** Emitted when a merge is rolled back after failure or conflict. */
export interface MergeRolledBackEvent extends EngineEventBase {
  type: 'merge:rolled-back';
  operationId: string;
  taskId: string;
  backupTag: string;
  reason: string;
}

// ─── Conflict Events ───────────────────────────────────────────────────────────

/** Emitted when merge conflicts are detected in one or more files. */
export interface ConflictDetectedEvent extends EngineEventBase {
  type: 'conflict:detected';
  operationId: string;
  taskId: string;
  conflicts: FileConflict[];
}

/** Emitted when AI conflict resolution begins. */
export interface ConflictAiResolvingEvent extends EngineEventBase {
  type: 'conflict:ai-resolving';
  operationId: string;
  taskId: string;
  filePath: string;
}

/** Emitted when AI successfully resolves a conflict. */
export interface ConflictAiResolvedEvent extends EngineEventBase {
  type: 'conflict:ai-resolved';
  operationId: string;
  taskId: string;
  result: ConflictResolutionResult;
}

/** Emitted when AI fails to resolve a conflict. */
export interface ConflictAiFailedEvent extends EngineEventBase {
  type: 'conflict:ai-failed';
  operationId: string;
  taskId: string;
  filePath: string;
  error: string;
}

/** Emitted when a conflict is fully resolved (by any method). */
export interface ConflictResolvedEvent extends EngineEventBase {
  type: 'conflict:resolved';
  operationId: string;
  taskId: string;
  results: ConflictResolutionResult[];
}

// ─── Session-level Events ──────────────────────────────────────────────────────

/** Emitted when parallel execution session starts. */
export interface ParallelStartedEvent extends EngineEventBase {
  type: 'parallel:started';
  sessionId: string;
  analysis: TaskGraphAnalysis;
  totalGroups: number;
  totalTasks: number;
  maxWorkers: number;
}

/**
 * Emitted when a session branch is created for parallel execution.
 * The session branch holds all worker merges; the original branch is untouched
 * until the user explicitly merges the session branch (via PR or direct merge).
 */
export interface ParallelSessionBranchCreatedEvent extends EngineEventBase {
  type: 'parallel:session-branch-created';
  sessionId: string;
  /** The session branch name (e.g., "ralph-session/a4d1aae7") */
  sessionBranch: string;
  /** The original branch that was checked out before session branch creation */
  originalBranch: string;
}

/** Emitted when a parallel group begins execution. */
export interface ParallelGroupStartedEvent extends EngineEventBase {
  type: 'parallel:group-started';
  group: ParallelGroup;
  groupIndex: number;
  totalGroups: number;
  workerCount: number;
}

/** Emitted when a parallel group finishes (all workers done + merged). */
export interface ParallelGroupCompletedEvent extends EngineEventBase {
  type: 'parallel:group-completed';
  groupIndex: number;
  totalGroups: number;
  tasksCompleted: number;
  tasksFailed: number;
  mergesCompleted: number;
  mergesFailed: number;
}

/** Emitted when the entire parallel execution session completes. */
export interface ParallelCompletedEvent extends EngineEventBase {
  type: 'parallel:completed';
  sessionId: string;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  totalMergesCompleted: number;
  totalConflictsResolved: number;
  durationMs: number;
}

/** Emitted when parallel execution fails fatally. */
export interface ParallelFailedEvent extends EngineEventBase {
  type: 'parallel:failed';
  sessionId: string;
  error: string;
  tasksCompletedBeforeFailure: number;
}

// ─── Union of All Parallel Events ──────────────────────────────────────────────

/**
 * Discriminated union of all parallel execution events.
 */
export type ParallelEvent =
  // Worker
  | WorkerCreatedEvent
  | WorkerStartedEvent
  | WorkerProgressEvent
  | WorkerCompletedEvent
  | WorkerFailedEvent
  | WorkerOutputEvent
  // Merge
  | MergeQueuedEvent
  | MergeStartedEvent
  | MergeCompletedEvent
  | MergeFailedEvent
  | MergeRolledBackEvent
  // Conflict
  | ConflictDetectedEvent
  | ConflictAiResolvingEvent
  | ConflictAiResolvedEvent
  | ConflictAiFailedEvent
  | ConflictResolvedEvent
  // Session
  | ParallelStartedEvent
  | ParallelSessionBranchCreatedEvent
  | ParallelGroupStartedEvent
  | ParallelGroupCompletedEvent
  | ParallelCompletedEvent
  | ParallelFailedEvent;

/**
 * Listener function for parallel events.
 */
export type ParallelEventListener = (event: ParallelEvent) => void;
