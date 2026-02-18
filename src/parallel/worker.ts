/**
 * ABOUTME: Single parallel worker that wraps an ExecutionEngine for one worktree.
 * Each worker operates in an isolated git worktree with a pre-assigned task.
 * The tracker is managed centrally by the ParallelExecutor to prevent concurrent
 * writes to the beads database.
 */

import { ExecutionEngine, type WorkerModeOptions } from '../engine/index.js';
import type { EngineEvent, EngineEventListener } from '../engine/types.js';
import type { RalphConfig } from '../config/types.js';
import type { TrackerPlugin, TrackerTask } from '../plugins/trackers/types.js';
import type {
  WorkerConfig,
  WorkerResult,
  WorkerStatus,
  WorkerDisplayState,
} from './types.js';
import type {
  ParallelEventListener,
  ParallelEvent,
} from './events.js';

/**
 * A parallel worker that executes a single task in an isolated git worktree.
 *
 * Design:
 * - Wraps an ExecutionEngine with a modified config pointing to the worktree
 * - Does NOT use the tracker to pick tasks — the task is pre-assigned
 * - Forwards all engine events with a workerId prefix so the executor can route them
 * - Reports status changes back to the ParallelExecutor
 */
export class Worker {
  readonly id: string;
  readonly config: WorkerConfig;

  private engine: ExecutionEngine | null = null;
  private status: WorkerStatus = 'idle';
  private startTime = 0;
  private currentIteration = 0;
  private maxIterations: number;
  private lastOutput = '';
  private lastCommitSha?: string;
  private commitCount = 0;
  private readonly listeners: ParallelEventListener[] = [];
  private readonly engineListeners: EngineEventListener[] = [];

  constructor(config: WorkerConfig, maxIterations: number) {
    this.id = config.id;
    this.config = config;
    this.maxIterations = maxIterations;
  }

  /**
   * Register a parallel event listener.
   */
  on(listener: ParallelEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Register an engine event listener for raw engine events.
   */
  onEngineEvent(listener: EngineEventListener): () => void {
    this.engineListeners.push(listener);
    return () => {
      const idx = this.engineListeners.indexOf(listener);
      if (idx >= 0) this.engineListeners.splice(idx, 1);
    };
  }

  /**
   * Create and initialize the execution engine for this worker.
   * Must be called before start().
   *
   * @param baseConfig - The base RalphConfig to modify for this worktree
   * @param tracker - Pre-initialized tracker plugin from the parent executor.
   *   The tracker is injected to avoid re-initializing in the worktree directory
   *   where tracker data (e.g., .beads/) may not be accessible.
   */
  async initialize(baseConfig: RalphConfig, tracker: TrackerPlugin): Promise<void> {
    // Create a worker-specific config pointing to the worktree
    const workerConfig: RalphConfig = {
      ...baseConfig,
      cwd: this.config.worktreePath,
      maxIterations: this.maxIterations,
      outputDir: `${this.config.worktreePath}/.ralph-tui/iterations`,
      progressFile: `${this.config.worktreePath}/.ralph-tui/progress.md`,
      sessionId: `${baseConfig.sessionId ?? 'session'}-${this.id}`,
      // Force auto-commit in parallel mode — required for merge workflow to work.
      // Without commits, there's nothing to merge back to main.
      autoCommit: true,
    };

    this.engine = new ExecutionEngine(workerConfig);

    // Forward engine events with worker context
    this.engine.on((event: EngineEvent) => {
      this.handleEngineEvent(event);
    });

    // Initialize in worker mode: inject the tracker and force a single task
    const workerMode: WorkerModeOptions = {
      tracker,
      forcedTask: this.config.task,
    };
    await this.engine.initialize(workerMode);

    this.emitParallel({
      type: 'worker:created',
      timestamp: new Date().toISOString(),
      workerId: this.id,
      task: this.config.task,
      worktreePath: this.config.worktreePath,
      branchName: this.config.branchName,
    });
  }

  /**
   * Start the worker's execution engine.
   * Returns when the engine stops (task completed, max iterations, or error).
   */
  async start(): Promise<WorkerResult> {
    if (!this.engine) {
      throw new Error(`Worker ${this.id} not initialized. Call initialize() first.`);
    }

    this.status = 'running';
    this.startTime = Date.now();
    this.commitCount = 0;
    this.lastCommitSha = undefined;

    this.emitParallel({
      type: 'worker:started',
      timestamp: new Date().toISOString(),
      workerId: this.id,
      task: this.config.task,
    });

    try {
      await this.engine.start();

      // Check if we were cancelled while the engine was running.
      // stop() may have been called concurrently, setting this.status = 'cancelled'.
      // Use getStatus() to bypass TypeScript's type narrowing (it thinks status is still 'running').
      if (this.getStatus() === 'cancelled') {
        const result: WorkerResult = {
          workerId: this.id,
          task: this.config.task,
          success: false,
          iterationsRun: this.currentIteration,
          taskCompleted: false,
          durationMs: Date.now() - this.startTime,
          error: 'Worker was cancelled',
          branchName: this.config.branchName,
          commitCount: this.commitCount,
          worktreePath: this.config.worktreePath,
        };

        this.emitParallel({
          type: 'worker:failed',
          timestamp: new Date().toISOString(),
          workerId: this.id,
          task: this.config.task,
          error: 'Worker was cancelled',
        });

        return result;
      }

      const engineState = this.engine.getState();
      const taskCompleted = engineState.tasksCompleted > 0;

      this.status = 'completed';

      const result: WorkerResult = {
        workerId: this.id,
        task: this.config.task,
        success: true,
        iterationsRun: engineState.currentIteration,
        taskCompleted,
        durationMs: Date.now() - this.startTime,
        branchName: this.config.branchName,
        commitCount: this.commitCount,
        worktreePath: this.config.worktreePath,
      };

      this.emitParallel({
        type: 'worker:completed',
        timestamp: new Date().toISOString(),
        workerId: this.id,
        result,
      });

      return result;
    } catch (err) {
      this.status = 'failed';
      const error = err instanceof Error ? err.message : String(err);

      const result: WorkerResult = {
        workerId: this.id,
        task: this.config.task,
        success: false,
        iterationsRun: this.currentIteration,
        taskCompleted: false,
        durationMs: Date.now() - this.startTime,
        error,
        branchName: this.config.branchName,
        commitCount: this.commitCount,
        worktreePath: this.config.worktreePath,
      };

      this.emitParallel({
        type: 'worker:failed',
        timestamp: new Date().toISOString(),
        workerId: this.id,
        task: this.config.task,
        error,
      });

      return result;
    }
  }

  /**
   * Stop the worker's execution engine.
   * Sets status to 'cancelled' immediately before stopping the engine so that
   * start()'s post-start check via getStatus() observes the cancelled state.
   */
  async stop(): Promise<void> {
    this.status = 'cancelled';
    if (this.engine) {
      await this.engine.stop();
    }
  }

  /**
   * Pause the worker's execution engine after the current iteration completes.
   */
  pause(): void {
    this.engine?.pause();
  }

  /**
   * Resume the worker's execution engine from paused state.
   */
  resume(): void {
    this.engine?.resume();
  }

  /**
   * Get the current display state for TUI rendering.
   */
  getDisplayState(): WorkerDisplayState {
    return {
      id: this.id,
      status: this.status,
      task: this.config.task,
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
      lastOutput: this.lastOutput,
      elapsedMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
      worktreePath: this.config.worktreePath,
      branchName: this.config.branchName,
      commitSha: this.lastCommitSha,
    };
  }

  /**
   * Get the current worker status.
   */
  getStatus(): WorkerStatus {
    return this.status;
  }

  /**
   * Get the task assigned to this worker.
   */
  getTask(): TrackerTask {
    return this.config.task;
  }

  /**
   * Handle engine events: update internal state and forward to listeners.
   */
  private handleEngineEvent(event: EngineEvent): void {
    // Update internal tracking based on event type
    switch (event.type) {
      case 'iteration:started':
        this.currentIteration = event.iteration;
        this.emitParallel({
          type: 'worker:progress',
          timestamp: event.timestamp,
          workerId: this.id,
          task: this.config.task,
          currentIteration: event.iteration,
          maxIterations: this.maxIterations,
        });
        break;

      case 'agent:output':
        if (event.stream === 'stdout' && event.data.trim()) {
          this.lastOutput = event.data.trim().slice(-200);
        }
        this.emitParallel({
          type: 'worker:output',
          timestamp: event.timestamp,
          workerId: this.id,
          stream: event.stream,
          data: event.data,
        });
        break;

      case 'task:auto-committed':
        // Capture the commit SHA for display in the worker detail view
        this.commitCount++;
        if (event.commitSha) {
          this.lastCommitSha = event.commitSha;
        }
        break;
    }

    // Forward all engine events to registered listeners
    for (const listener of this.engineListeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the worker
      }
    }
  }

  /**
   * Emit a parallel event to all listeners.
   */
  private emitParallel(event: ParallelEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the worker
      }
    }
  }
}
