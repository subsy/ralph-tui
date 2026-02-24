/**
 * ABOUTME: Type definitions for Ralph TUI session management.
 * Defines session state, lock files, and related structures.
 */

/**
 * Session status
 */
export type SessionStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'interrupted';

/**
 * Lock file contents
 */
export interface LockFile {
  /** Process ID that holds the lock */
  pid: number;

  /** Session ID */
  sessionId: string;

  /** When the lock was acquired (ISO 8601) */
  acquiredAt: string;

  /** Working directory */
  cwd: string;

  /** Host name */
  hostname: string;
}

/**
 * Session metadata (persisted to disk)
 */
export interface SessionMetadata {
  /** Unique session identifier */
  id: string;

  /** Current status */
  status: SessionStatus;

  /** When the session was started (ISO 8601) */
  startedAt: string;

  /** When the session was last updated (ISO 8601) */
  updatedAt: string;

  /** When the session ended (if finished) */
  endedAt?: string;

  /** Agent plugin used */
  agentPlugin: string;

  /** Tracker plugin used */
  trackerPlugin: string;

  /** Epic ID (if using beads) */
  epicId?: string;

  /** PRD path (if using json tracker) */
  prdPath?: string;

  /** Current iteration number */
  currentIteration: number;

  /** Maximum iterations configured */
  maxIterations: number;

  /** Total tasks at session start */
  totalTasks: number;

  /** Tasks completed in this session */
  tasksCompleted: number;

  /** Working directory */
  cwd: string;
}

/**
 * Result of checking for existing session
 */
export interface SessionCheckResult {
  /** Whether an active session exists */
  hasSession: boolean;

  /** The session metadata if found */
  session?: SessionMetadata;

  /** Whether a lock is held by another process */
  isLocked: boolean;

  /** The lock details if locked */
  lock?: LockFile;

  /** Whether the lock is stale (process no longer running) */
  isStale: boolean;
}

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
  /** Optional pre-generated session identifier */
  sessionId?: string;

  /** Agent plugin being used */
  agentPlugin: string;

  /** Tracker plugin being used */
  trackerPlugin: string;

  /** Epic ID (if using beads) */
  epicId?: string;

  /** PRD path (if using json tracker) */
  prdPath?: string;

  /** Maximum iterations */
  maxIterations: number;

  /** Total tasks available */
  totalTasks: number;

  /** Working directory */
  cwd: string;

  /**
   * Skip lock acquisition inside createSession.
   * Used when lock was already acquired by a higher-level orchestrator.
   */
  lockAlreadyAcquired?: boolean;
}
