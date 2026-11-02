/**
 * ABOUTME: Shared headless-mode engine event handling for the run and resume commands.
 * Translates engine events into structured log lines and keeps the persisted session
 * state current, so every headless entry point emits the same output.
 */

import type { EngineEvent, EngineEventListener } from '../engine/types.js';
import type { StructuredLogger } from '../logs/index.js';
import {
  addActiveTask,
  removeActiveTask,
  pauseSession,
  updateSessionAfterIteration,
  savePersistedSession,
  type PersistedSessionState,
} from '../session/index.js';

/**
 * Options for creating a headless event handler.
 */
export interface HeadlessEventHandlerOptions {
  /** Logger used for all headless output */
  logger: StructuredLogger;
  /** Iteration cap shown in progress lines (0 means unlimited) */
  maxIterations: number;
  /** Session state to track and persist as iterations complete */
  initialState: PersistedSessionState;
}

/**
 * Engine listener plus accessors for the session state it maintains.
 */
export interface HeadlessEventHandler {
  /** Engine listener that logs events and persists session state */
  handleEvent: EngineEventListener;
  /** Read the currently tracked session state */
  getState: () => PersistedSessionState;
  /** Replace the tracked session state (used by shutdown paths) */
  setState: (next: PersistedSessionState) => void;
}

/**
 * Create the headless engine event handler.
 *
 * The returned listener owns a mutable copy of the session state: it records
 * active tasks, applies iteration results, and persists after each change.
 * Callers that mutate state outside the engine loop (signal handlers, for
 * example) should go through `setState` so the tracked copy stays in sync.
 *
 * Command-specific concerns (desktop notifications, lock release, remote
 * servers) stay in the calling command; register a second engine listener for
 * those instead of extending this one.
 */
export function createHeadlessEventHandler(
  options: HeadlessEventHandlerOptions
): HeadlessEventHandler {
  const { logger, maxIterations } = options;
  let currentState = options.initialState;

  const persist = (): void => {
    savePersistedSession(currentState).catch(() => {
      // Silently continue on save errors
    });
  };

  const handleEvent: EngineEventListener = (event: EngineEvent): void => {
    switch (event.type) {
      case 'engine:started':
        logger.engineStarted(event.totalTasks);
        break;

      case 'engine:warning':
        logger.warn('engine', event.message);
        break;

      case 'iteration:started':
        // Progress update in required format
        logger.progress(event.iteration, maxIterations, event.task.id, event.task.title);
        break;

      case 'iteration:completed':
        logger.iterationComplete(
          event.result.iteration,
          event.result.task.id,
          event.result.taskCompleted,
          event.result.durationMs
        );

        // Log task completion if applicable
        if (event.result.taskCompleted) {
          logger.taskCompleted(event.result.task.id, event.result.iteration);
          // Remove from active tasks
          currentState = removeActiveTask(currentState, event.result.task.id);
        }

        // Save state after each iteration
        currentState = updateSessionAfterIteration(currentState, event.result);
        persist();
        break;

      case 'task:activated':
        // Track task as active when set to in_progress
        currentState = addActiveTask(currentState, event.task.id);
        persist();
        break;

      case 'iteration:failed':
        logger.iterationFailed(event.iteration, event.task.id, event.error, event.action);
        break;

      case 'iteration:retrying':
        logger.iterationRetrying(
          event.iteration,
          event.task.id,
          event.retryAttempt,
          event.maxRetries,
          event.delayMs
        );
        break;

      case 'iteration:skipped':
        logger.iterationSkipped(event.iteration, event.task.id, event.reason);
        break;

      case 'agent:output':
        // Stream agent output with [AGENT] prefix
        if (event.stream === 'stdout') {
          logger.agentOutput(event.data);
        } else {
          logger.agentError(event.data);
        }
        break;

      case 'task:selected':
        logger.taskSelected(event.task.id, event.task.title, event.iteration);
        break;

      case 'engine:paused':
        logger.enginePaused(event.currentIteration);
        currentState = pauseSession(currentState);
        persist();
        break;

      case 'engine:resumed':
        logger.engineResumed(event.fromIteration);
        currentState = {
          ...currentState,
          status: 'running',
          isPaused: false,
          pausedAt: undefined,
        };
        persist();
        break;

      case 'engine:stopped':
        logger.engineStopped(event.reason, event.totalIterations, event.tasksCompleted);
        break;

      case 'engine:waiting':
        logger.engineWaiting(event.reason, event.pollIntervalMs);
        break;

      case 'all:complete':
        logger.allComplete(event.totalCompleted, event.totalIterations);
        break;

      case 'task:completed':
        // Already logged in the iteration:completed handler.
        // Remove from active tasks (redundant with iteration:completed but safe)
        currentState = removeActiveTask(currentState, event.task.id);
        persist();
        break;
    }
  };

  return {
    handleEvent,
    getState: () => currentState,
    setState: (next: PersistedSessionState): void => {
      currentState = next;
    },
  };
}
