/**
 * ABOUTME: Session and lock management for Ralph TUI.
 * Handles session persistence, lock files, and resume functionality.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  readFile,
  writeFile,
  unlink,
  mkdir,
  access,
  constants,
} from 'node:fs/promises';
import type {
  LockFile,
  SessionMetadata,
  SessionCheckResult,
  CreateSessionOptions,
  SessionStatus,
} from './types.js';

/**
 * Directory for session data (relative to cwd)
 */
const SESSION_DIR = '.ralph-tui';
const LOCK_FILE = 'ralph.lock';
const SESSION_FILE = 'session.json';

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the session directory path
 */
function getSessionDir(cwd: string): string {
  return join(cwd, SESSION_DIR);
}

/**
 * Get the lock file path
 */
function getLockPath(cwd: string): string {
  return join(getSessionDir(cwd), LOCK_FILE);
}

/**
 * Get the session file path
 */
function getSessionPath(cwd: string): string {
  return join(getSessionDir(cwd), SESSION_FILE);
}

/**
 * Ensure session directory exists
 */
async function ensureSessionDir(cwd: string): Promise<void> {
  const dir = getSessionDir(cwd);
  try {
    await access(dir, constants.F_OK);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Check if file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read lock file if it exists
 */
async function readLockFile(cwd: string): Promise<LockFile | null> {
  const lockPath = getLockPath(cwd);
  if (!(await fileExists(lockPath))) {
    return null;
  }

  try {
    const content = await readFile(lockPath, 'utf-8');
    return JSON.parse(content) as LockFile;
  } catch {
    return null;
  }
}

/**
 * Read session metadata if it exists
 */
async function readSessionMetadata(
  cwd: string
): Promise<SessionMetadata | null> {
  const sessionPath = getSessionPath(cwd);
  if (!(await fileExists(sessionPath))) {
    return null;
  }

  try {
    const content = await readFile(sessionPath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch {
    return null;
  }
}

/**
 * Check for existing session and lock status
 */
export async function checkSession(cwd: string): Promise<SessionCheckResult> {
  const lock = await readLockFile(cwd);
  const session = await readSessionMetadata(cwd);

  if (!lock) {
    return {
      hasSession: session !== null && session.status !== 'completed',
      session: session ?? undefined,
      isLocked: false,
      isStale: false,
    };
  }

  // Check if the lock holder is still running
  const isRunning = isProcessRunning(lock.pid);
  const isStale = !isRunning;

  return {
    hasSession: session !== null && session.status !== 'completed',
    session: session ?? undefined,
    isLocked: !isStale,
    lock,
    isStale,
  };
}

/**
 * Acquire lock for a new session
 */
export async function acquireLock(
  cwd: string,
  sessionId: string
): Promise<boolean> {
  await ensureSessionDir(cwd);
  const lockPath = getLockPath(cwd);

  // Check for existing lock
  const existingLock = await readLockFile(cwd);
  if (existingLock && isProcessRunning(existingLock.pid)) {
    return false;
  }

  // Write our lock file
  const lock: LockFile = {
    pid: process.pid,
    sessionId,
    acquiredAt: new Date().toISOString(),
    cwd,
    hostname: hostname(),
  };

  await writeFile(lockPath, JSON.stringify(lock, null, 2));
  return true;
}

/**
 * Release the lock
 */
export async function releaseLock(cwd: string): Promise<void> {
  const lockPath = getLockPath(cwd);
  try {
    await unlink(lockPath);
  } catch {
    // Ignore if lock doesn't exist
  }
}

/**
 * Clean up stale lock (when process is no longer running)
 */
export async function cleanStaleLock(cwd: string): Promise<boolean> {
  const lock = await readLockFile(cwd);
  if (!lock) {
    return false;
  }

  if (!isProcessRunning(lock.pid)) {
    await releaseLock(cwd);
    return true;
  }

  return false;
}

/**
 * Create a new session
 */
export async function createSession(
  options: CreateSessionOptions
): Promise<SessionMetadata> {
  await ensureSessionDir(options.cwd);

  const now = new Date().toISOString();
  const session: SessionMetadata = {
    id: randomUUID(),
    status: 'running',
    startedAt: now,
    updatedAt: now,
    agentPlugin: options.agentPlugin,
    trackerPlugin: options.trackerPlugin,
    epicId: options.epicId,
    prdPath: options.prdPath,
    currentIteration: 0,
    maxIterations: options.maxIterations,
    totalTasks: options.totalTasks,
    tasksCompleted: 0,
    cwd: options.cwd,
  };

  await saveSession(session);

  // Acquire lock
  await acquireLock(options.cwd, session.id);

  return session;
}

/**
 * Save session metadata to disk
 */
export async function saveSession(session: SessionMetadata): Promise<void> {
  await ensureSessionDir(session.cwd);
  const sessionPath = getSessionPath(session.cwd);

  const updated: SessionMetadata = {
    ...session,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(sessionPath, JSON.stringify(updated, null, 2));
}

/**
 * Update session status
 */
export async function updateSessionStatus(
  cwd: string,
  status: SessionStatus
): Promise<SessionMetadata | null> {
  const session = await readSessionMetadata(cwd);
  if (!session) {
    return null;
  }

  session.status = status;
  if (status === 'completed' || status === 'failed' || status === 'interrupted') {
    session.endedAt = new Date().toISOString();
  }

  await saveSession(session);
  return session;
}

/**
 * Update session iteration
 */
export async function updateSessionIteration(
  cwd: string,
  iteration: number,
  tasksCompleted?: number
): Promise<SessionMetadata | null> {
  const session = await readSessionMetadata(cwd);
  if (!session) {
    return null;
  }

  session.currentIteration = iteration;
  if (tasksCompleted !== undefined) {
    session.tasksCompleted = tasksCompleted;
  }

  await saveSession(session);
  return session;
}

/**
 * End a session (release lock and update status)
 */
export async function endSession(
  cwd: string,
  status: SessionStatus = 'completed'
): Promise<void> {
  await updateSessionStatus(cwd, status);
  await releaseLock(cwd);
}

/**
 * Resume an existing session
 */
export async function resumeSession(
  cwd: string
): Promise<SessionMetadata | null> {
  const session = await readSessionMetadata(cwd);
  if (!session) {
    return null;
  }

  // Clean up stale lock if present
  await cleanStaleLock(cwd);

  // Acquire new lock
  const acquired = await acquireLock(cwd, session.id);
  if (!acquired) {
    return null;
  }

  // Update status to running
  session.status = 'running';
  await saveSession(session);

  return session;
}

export type {
  SessionMetadata,
  SessionCheckResult,
  CreateSessionOptions,
  SessionStatus,
} from './types.js';

// Re-export persistence module
export {
  hasPersistedSession,
  loadPersistedSession,
  savePersistedSession,
  deletePersistedSession,
  createPersistedSession,
  updateSessionAfterIteration,
  pauseSession,
  resumePersistedSession,
  completeSession,
  failSession,
  addSkippedTask,
  addActiveTask,
  removeActiveTask,
  clearActiveTasks,
  getActiveTasks,
  setSubagentPanelVisible,
  isSessionResumable,
  getSessionSummary,
  detectAndRecoverStaleSession,
} from './persistence.js';

export type {
  TaskStatusSnapshot,
  TrackerStateSnapshot,
  PersistedSessionState,
  PersistedIterationResult,
  StaleSessionRecoveryResult,
} from './persistence.js';

// Re-export lock module with single instance support
export {
  checkLock,
  acquireLockWithPrompt,
  releaseLock as releaseLockNew,
  registerLockCleanupHandlers,
  acquireParallelModeLock,
  updateLockParallelMode,
  isParallelModeLock,
  type LockCheckResult,
  type LockAcquisitionResult,
} from './lock.js';

export type { LockFile } from './types.js';

export {
  hasParallelSession,
  loadParallelSession,
  saveParallelSession,
  deleteParallelSession,
  createParallelSession,
  addAgentToSession,
  completeAgentTask,
  removeAgentFromSession,
  pauseParallelSession,
  resumeParallelSessionState,
  completeParallelSession,
  failParallelSession,
  isParallelSessionResumable,
  detectOrphanedWorktrees,
  detectAndRecoverStaleParallelSession,
  getResumableTasks,
  getParallelSessionSummary,
  type PersistedAgentState,
  type PersistedWorktreeState,
  type PersistedParallelSessionState,
  type OrphanedWorktreeInfo,
  type ParallelSessionRecoveryResult,
} from './parallel-session.js';
