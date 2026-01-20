/**
 * ABOUTME: Type definitions for the orchestrator module.
 * Defines interfaces for multi-agent parallel task execution.
 */

export type WorkerStatus = 'idle' | 'running' | 'completed' | 'failed' | 'killed';

/** Hint about parallelism confidence for a story */
export interface ParallelismHint {
  confidence: number; // 0-1, higher = more parallelizable
  reason: string;
}

/** A range of task IDs (lexicographic, inclusive) */
export interface IdRange {
  from: string;
  to: string;
}

/** A group of stories assignable to a single worker */
export interface StoryGroup {
  idRange: IdRange;
  estimatedFiles: string[]; // for conflict detection
}

/** An execution phase containing one or more story groups */
export interface Phase {
  name: string;
  storyGroups: StoryGroup[];
  parallel: boolean; // whether groups can run in parallel
}

/** State of a worker process */
export interface WorkerState {
  id: string;
  range: IdRange;
  status: WorkerStatus;
  progress: number; // 0-100
  currentTaskId?: string;
  error?: string;
}

/** Configuration for the orchestrator */
export interface OrchestratorConfig {
  prdPath: string;
  maxWorkers: number;
  headless: boolean;
  cwd: string;
  workerArgs?: string[];
}

export interface WorkerStartedEvent {
  type: 'worker:started';
  workerId: string;
  range: IdRange;
}

export interface WorkerProgressEvent {
  type: 'worker:progress';
  workerId: string;
  progress: number;
  currentTaskId?: string;
}

export interface WorkerCompletedEvent {
  type: 'worker:completed';
  workerId: string;
}

export interface WorkerFailedEvent {
  type: 'worker:failed';
  workerId: string;
  error: string;
}

export interface PhaseStartedEvent {
  type: 'phase:started';
  phaseName: string;
  phaseIndex: number;
  totalPhases: number;
}

export interface PhaseCompletedEvent {
  type: 'phase:completed';
  phaseName: string;
  phaseIndex: number;
}

export interface OrchestrationCompletedEvent {
  type: 'orchestration:completed';
  totalTasks: number;
  completedTasks: number;
}

export type OrchestratorEvent =
  | WorkerStartedEvent
  | WorkerProgressEvent
  | WorkerCompletedEvent
  | WorkerFailedEvent
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | OrchestrationCompletedEvent;
