/**
 * ABOUTME: Session persistence for Ralph TUI.
 * Handles saving and loading full session state including task statuses,
 * iteration history, and tracker state to .ralph-tui/session.json.
 */

import { join, dirname } from 'node:path';
import {
  readFile,
  writeFile,
  unlink,
  access,
  constants,
  mkdir,
} from 'node:fs/promises';
import type { TrackerTask, TrackerTaskStatus } from '../plugins/trackers/types.js';
import type { IterationResult } from '../engine/types.js';
import type { SessionStatus } from './types.js';

/**
 * Session file path relative to cwd (inside .ralph-tui directory)
 */
const SESSION_FILE = '.ralph-tui/session.json';

/**
 * Task status snapshot for persistence
 */
export interface TaskStatusSnapshot {
  /** Task ID */
  id: string;
  /** Task title for display */
  title: string;
  /** Current status */
  status: TrackerTaskStatus;
  /** Whether task was completed in this session */
  completedInSession: boolean;
}

/**
 * Tracker state for persistence
 */
export interface TrackerStateSnapshot {
  /** Tracker plugin name */
  plugin: string;
  /** Epic ID if using beads */
  epicId?: string;
  /** PRD path if using json tracker */
  prdPath?: string;
  /** Total tasks at session start */
  totalTasks: number;
  /** Task statuses snapshot */
  tasks: TaskStatusSnapshot[];
}

/**
 * Persisted session state
 * Saved to .ralph-tui/session.json
 */
export interface PersistedSessionState {
  /** Schema version for forward compatibility */
  version: 1;

  /** Unique session identifier */
  sessionId: string;

  /** Current session status */
  status: SessionStatus;

  /** When the session was started (ISO 8601) */
  startedAt: string;

  /** When the session was last updated (ISO 8601) */
  updatedAt: string;

  /** When the session was paused (if paused) */
  pausedAt?: string;

  /** Current iteration number (0-based internally, 1-based for display) */
  currentIteration: number;

  /** Maximum iterations configured (0 = unlimited) */
  maxIterations: number;

  /** Tasks completed in this session */
  tasksCompleted: number;

  /** Whether the session is paused */
  isPaused: boolean;

  /** Agent plugin being used */
  agentPlugin: string;

  /** Model being used (if specified) */
  model?: string;

  /** Tracker state snapshot */
  trackerState: TrackerStateSnapshot;

  /** Completed iteration results */
  iterations: PersistedIterationResult[];

  /** Skipped task IDs (for retry/skip error handling) */
  skippedTaskIds: string[];

  /** Working directory */
  cwd: string;

  /**
   * Task IDs that this session set to in_progress and haven't completed.
   * Used for crash recovery: on graceful shutdown, reset these back to open.
   * On startup, detect stale in_progress tasks from crashed sessions.
   */
  activeTaskIds: string[];

  /**
   * Whether the subagent tree panel is visible.
   * Persisted to remember user preference across pauses/resumes.
   */
  subagentPanelVisible?: boolean;
}

/**
 * Persisted iteration result (subset of IterationResult for storage)
 */
export interface PersistedIterationResult {
  /** Iteration number (1-based) */
  iteration: number;

  /** Status of the iteration */
  status: IterationResult['status'];

  /** Task ID that was worked on */
  taskId: string;

  /** Task title for display */
  taskTitle: string;

  /** Whether the task was completed */
  taskCompleted: boolean;

  /** Whether the task was blocked by review */
  taskBlocked?: boolean;

  /** Duration in milliseconds */
  durationMs: number;

  /** Error message if failed */
  error?: string;

  /** When iteration started */
  startedAt: string;

  /** When iteration ended */
  endedAt: string;
}

/**
 * Get the session file path
 */
function getSessionFilePath(cwd: string): string {
  return join(cwd, SESSION_FILE);
}

/**
 * Check if a session file exists
 */
export async function hasPersistedSession(cwd: string): Promise<boolean> {
  const filePath = getSessionFilePath(cwd);
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a loaded session has required fields.
 * Returns null if valid, or an error message if invalid.
 */
function validateLoadedSession(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return 'Session file is not a valid object';
  }

  const session = parsed as Record<string, unknown>;

  // Required top-level fields
  if (typeof session.sessionId !== 'string') {
    return 'Missing or invalid sessionId';
  }
  if (typeof session.status !== 'string') {
    return 'Missing or invalid status';
  }

  // trackerState is required and must have required sub-fields
  if (!session.trackerState || typeof session.trackerState !== 'object') {
    return 'Missing or invalid trackerState (session may be from an older version)';
  }

  const trackerState = session.trackerState as Record<string, unknown>;
  if (typeof trackerState.plugin !== 'string') {
    return 'Missing trackerState.plugin';
  }
  if (typeof trackerState.totalTasks !== 'number') {
    return 'Missing trackerState.totalTasks';
  }
  if (!Array.isArray(trackerState.tasks)) {
    return 'Missing trackerState.tasks array';
  }

  return null;
}

/**
 * Load persisted session state
 */
export async function loadPersistedSession(
  cwd: string
): Promise<PersistedSessionState | null> {
  const filePath = getSessionFilePath(cwd);

  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate required fields exist
    const validationError = validateLoadedSession(parsed);
    if (validationError) {
      const parsedRecord = parsed as Record<string, unknown>;
      if (typeof parsedRecord.id === 'string' && typeof parsedRecord.status === 'string') {
        return null;
      }
      console.warn(
        `Invalid session file: ${validationError}. ` +
          'Delete .ralph-tui/session.json to start fresh.'
      );
      return null;
    }

    const session = parsed as PersistedSessionState;

    // Validate schema version
    // Treat undefined as version 1 (backward compatible with pre-versioning files)
    const version = session.version ?? 1;
    if (version !== 1) {
      console.warn(
        `Unknown session file version: ${version}. ` +
          'Session may not load correctly.'
      );
    }

    // Ensure version field is set for future saves
    session.version = 1;

    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save persisted session state
 */
export async function savePersistedSession(
  state: PersistedSessionState
): Promise<void> {
  const filePath = getSessionFilePath(state.cwd);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Update timestamp
  const updatedState: PersistedSessionState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(filePath, JSON.stringify(updatedState, null, 2));
}

/**
 * Delete the persisted session file
 */
export async function deletePersistedSession(cwd: string): Promise<boolean> {
  const filePath = getSessionFilePath(cwd);

  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false; // File didn't exist
    }
    throw error;
  }
}

/**
 * Create a new persisted session state
 */
export function createPersistedSession(options: {
  sessionId: string;
  agentPlugin: string;
  model?: string;
  trackerPlugin: string;
  epicId?: string;
  prdPath?: string;
  maxIterations: number;
  tasks: TrackerTask[];
  cwd: string;
}): PersistedSessionState {
  const now = new Date().toISOString();

  return {
    version: 1,
    sessionId: options.sessionId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    currentIteration: 0,
    maxIterations: options.maxIterations,
    tasksCompleted: 0,
    isPaused: false,
    agentPlugin: options.agentPlugin,
    model: options.model,
    trackerState: {
      plugin: options.trackerPlugin,
      epicId: options.epicId,
      prdPath: options.prdPath,
      totalTasks: options.tasks.length,
      tasks: options.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        completedInSession: false,
      })),
    },
    iterations: [],
    skippedTaskIds: [],
    cwd: options.cwd,
    activeTaskIds: [],
    subagentPanelVisible: false,
  };
}

/**
 * Update session state after an iteration completes
 */
export function updateSessionAfterIteration(
  state: PersistedSessionState,
  result: IterationResult
): PersistedSessionState {
  const iterationRecord: PersistedIterationResult = {
    iteration: result.iteration,
    status: result.status,
    taskId: result.task.id,
    taskTitle: result.task.title,
    taskCompleted: result.taskCompleted,
    taskBlocked: result.taskBlocked,
    durationMs: result.durationMs,
    error: result.error,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
  };

  // Update task status in snapshot if completed
  const updatedTasks = state.trackerState.tasks.map((task) => {
    if (task.id === result.task.id && result.taskCompleted) {
      return {
        ...task,
        status: 'completed' as TrackerTaskStatus,
        completedInSession: true,
      };
    }
    return task;
  });

  return {
    ...state,
    currentIteration: result.iteration,
    tasksCompleted: result.taskCompleted
      ? state.tasksCompleted + 1
      : state.tasksCompleted,
    trackerState: {
      ...state.trackerState,
      tasks: updatedTasks,
    },
    iterations: [...state.iterations, iterationRecord],
  };
}

/**
 * Mark session as paused
 */
export function pauseSession(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    status: 'paused',
    isPaused: true,
    pausedAt: new Date().toISOString(),
  };
}

/**
 * Mark session as resumed
 */
export function resumePersistedSession(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    status: 'running',
    isPaused: false,
    pausedAt: undefined,
  };
}

/**
 * Mark session as completed
 */
export function completeSession(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    status: 'completed',
    isPaused: false,
  };
}

/**
 * Mark session as failed
 */
export function failSession(
  state: PersistedSessionState,
  _error?: string
): PersistedSessionState {
  return {
    ...state,
    status: 'failed',
    isPaused: false,
  };
}

/**
 * Add a skipped task ID
 */
export function addSkippedTask(
  state: PersistedSessionState,
  taskId: string
): PersistedSessionState {
  if (state.skippedTaskIds.includes(taskId)) {
    return state;
  }

  return {
    ...state,
    skippedTaskIds: [...state.skippedTaskIds, taskId],
  };
}

/**
 * Add a task to the active task list (when starting work on it).
 * These are tasks this session set to in_progress that haven't completed.
 */
export function addActiveTask(
  state: PersistedSessionState,
  taskId: string
): PersistedSessionState {
  // Handle legacy sessions that don't have activeTaskIds
  const currentActive = state.activeTaskIds ?? [];

  if (currentActive.includes(taskId)) {
    return state;
  }

  return {
    ...state,
    activeTaskIds: [...currentActive, taskId],
  };
}

/**
 * Remove a task from the active task list (when task is completed).
 */
export function removeActiveTask(
  state: PersistedSessionState,
  taskId: string
): PersistedSessionState {
  // Handle legacy sessions that don't have activeTaskIds
  const currentActive = state.activeTaskIds ?? [];

  return {
    ...state,
    activeTaskIds: currentActive.filter((id) => id !== taskId),
  };
}

/**
 * Clear all active tasks (used during graceful shutdown).
 */
export function clearActiveTasks(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    activeTaskIds: [],
  };
}

/**
 * Get the list of active task IDs for this session.
 * Returns empty array for legacy sessions without this field.
 */
export function getActiveTasks(state: PersistedSessionState): string[] {
  return state.activeTaskIds ?? [];
}

/**
 * Update subagent panel visibility in session state.
 */
export function setSubagentPanelVisible(
  state: PersistedSessionState,
  visible: boolean
): PersistedSessionState {
  return {
    ...state,
    subagentPanelVisible: visible,
  };
}

/**
 * Check if a session is resumable
 */
export function isSessionResumable(state: PersistedSessionState): boolean {
  // Can resume if paused, running (crashed), or interrupted
  return (
    state.status === 'paused' ||
    state.status === 'running' ||
    state.status === 'interrupted'
  );
}

/**
 * Result of stale session detection and recovery
 */
export interface StaleSessionRecoveryResult {
  /** Whether a stale session was detected */
  wasStale: boolean;
  /** Number of active task IDs that were cleared */
  clearedTaskCount: number;
  /** Previous status before recovery */
  previousStatus?: SessionStatus;
}

/**
 * Detect and recover from a stale session.
 *
 * A session is considered stale if:
 * 1. It has status 'running' (indicating it was active)
 * 2. But the lock file is stale (process no longer running) or missing
 *
 * Recovery actions:
 * 1. Clear activeTaskIds (tasks that were being worked on)
 * 2. Set status to 'interrupted' (so it can be resumed)
 * 3. Save the recovered session
 *
 * This should be called early in both run and resume commands,
 * BEFORE any prompts or session decisions are made.
 *
 * @param cwd Working directory
 * @param checkLock Function to check lock status (passed in to avoid circular deps)
 * @returns Recovery result
 */
export async function detectAndRecoverStaleSession(
  cwd: string,
  checkLock: (cwd: string) => Promise<{ isLocked: boolean; isStale: boolean }>
): Promise<StaleSessionRecoveryResult> {
  const result: StaleSessionRecoveryResult = {
    wasStale: false,
    clearedTaskCount: 0,
  };

  // Check if session file exists
  const hasSession = await hasPersistedSession(cwd);
  if (!hasSession) {
    return result;
  }

  // Load session
  const session = await loadPersistedSession(cwd);
  if (!session) {
    return result;
  }

  // Only recover if status is 'running' - this indicates an ungraceful exit
  if (session.status !== 'running') {
    return result;
  }

  // Check if lock is stale (process no longer running)
  const lockStatus = await checkLock(cwd);

  // If lock is valid (held by running process), don't recover
  if (lockStatus.isLocked && !lockStatus.isStale) {
    return result;
  }

  // Session is stale - recover it
  result.wasStale = true;
  result.previousStatus = session.status;
  result.clearedTaskCount = session.activeTaskIds?.length ?? 0;

  // Clear active tasks and set status to interrupted
  const recoveredSession: PersistedSessionState = {
    ...session,
    status: 'interrupted',
    activeTaskIds: [],
    updatedAt: new Date().toISOString(),
  };

  // Save recovered session
  await savePersistedSession(recoveredSession);

  return result;
}

/**
 * Get session summary for display
 */
export function getSessionSummary(state: PersistedSessionState): {
  sessionId: string;
  status: SessionStatus;
  startedAt: string;
  updatedAt: string;
  currentIteration: number;
  maxIterations: number;
  tasksCompleted: number;
  totalTasks: number;
  isPaused: boolean;
  isResumable: boolean;
  agentPlugin: string;
  trackerPlugin: string;
  epicId?: string;
  prdPath?: string;
} {
  // Defensive: handle missing trackerState (corrupted/old session files)
  const trackerState = state.trackerState ?? {
    plugin: 'unknown',
    totalTasks: 0,
    tasks: [],
  };

  return {
    sessionId: state.sessionId,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    currentIteration: state.currentIteration,
    maxIterations: state.maxIterations,
    tasksCompleted: state.tasksCompleted,
    totalTasks: trackerState.totalTasks ?? 0,
    isPaused: state.isPaused,
    isResumable: isSessionResumable(state),
    agentPlugin: state.agentPlugin,
    trackerPlugin: trackerState.plugin ?? 'unknown',
    epicId: trackerState.epicId,
    prdPath: trackerState.prdPath,
  };
}
