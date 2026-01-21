/**
 * ABOUTME: Type definitions for the orchestrator module.
 * Defines interfaces for multi-agent parallel task execution.
 */

export type WorkerStatus = 'idle' | 'running' | 'completed' | 'failed' | 'killed';

/** State of a worker process */
export interface WorkerState {
  id: string;
  taskId: string;
  status: WorkerStatus;
  progress: number; // 0-100
  error?: string;
}

/** Configuration for the orchestrator */
export interface OrchestratorConfig {
  prdPath: string;
  maxWorkers?: number; // undefined = unlimited (one worker per story)
  headless: boolean;
  cwd: string;
  workerArgs?: string[];
}

export interface WorkerStartedEvent {
  type: 'worker:started';
  workerId: string;
  taskId: string;
}

export interface WorkerProgressEvent {
  type: 'worker:progress';
  workerId: string;
  progress: number;
  taskId: string;
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
  | OrchestrationCompletedEvent;
