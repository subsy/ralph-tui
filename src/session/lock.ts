/**
 * ABOUTME: Single instance lock management for Ralph TUI.
 * Prevents concurrent runs in the same git repository to avoid state corruption.
 * Provides clear user feedback for lock conflicts and stale lock handling.
 */

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
import { promptBoolean } from '../setup/prompts.js';
import type { LockFile } from './types.js';

/**
 * Directory for session data (relative to cwd)
 */
const SESSION_DIR = '.ralph-tui';
const LOCK_FILE = 'ralph.lock';

/**
 * Result of checking the lock status
 */
export interface LockCheckResult {
  /** Whether a valid lock exists (another process is running) */
  isLocked: boolean;

  /** Whether the lock is stale (process no longer running) */
  isStale: boolean;

  /** The lock file contents if a lock exists */
  lock?: LockFile;
}

/**
 * Result of attempting to acquire a lock
 */
export interface LockAcquisitionResult {
  /** Whether the lock was successfully acquired */
  acquired: boolean;

  /** Error message if acquisition failed */
  error?: string;

  /** PID of the existing lock holder if blocked */
  existingPid?: number;
}

/**
 * Check if a process is running by sending signal 0
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
 * Check if a file exists
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
 * Read the lock file if it exists
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
    // Corrupt lock file, treat as no lock
    return null;
  }
}

/**
 * Check the current lock status without modifying anything
 */
export async function checkLock(cwd: string): Promise<LockCheckResult> {
  const lock = await readLockFile(cwd);

  if (!lock) {
    return { isLocked: false, isStale: false };
  }

  const isRunning = isProcessRunning(lock.pid);

  return {
    isLocked: isRunning,
    isStale: !isRunning,
    lock,
  };
}

/**
 * Create a new lock file
 */
async function writeLockFile(cwd: string, sessionId: string): Promise<void> {
  await ensureSessionDir(cwd);
  const lockPath = getLockPath(cwd);

  const lock: LockFile = {
    pid: process.pid,
    sessionId,
    acquiredAt: new Date().toISOString(),
    cwd,
    hostname: hostname(),
  };

  await writeFile(lockPath, JSON.stringify(lock, null, 2));
}

/**
 * Remove the lock file
 */
async function deleteLockFile(cwd: string): Promise<void> {
  const lockPath = getLockPath(cwd);
  try {
    await unlink(lockPath);
  } catch {
    // Ignore if lock doesn't exist
  }
}

/**
 * Format the stale lock warning message
 */
function formatStaleLockWarning(lock: LockFile): string {
  const startTime = new Date(lock.acquiredAt).toLocaleString();
  return `
⚠️  Stale lock detected

A previous Ralph session did not exit cleanly:
  PID:      ${lock.pid} (no longer running)
  Started:  ${startTime}
  Host:     ${lock.hostname}

This may happen if Ralph was terminated unexpectedly (crash, kill -9, etc.).
`;
}

/**
 * Prompt user to clean stale lock
 */
async function promptCleanStaleLock(lock: LockFile): Promise<boolean> {
  console.log(formatStaleLockWarning(lock));

  const shouldClean = await promptBoolean(
    'Remove the stale lock and continue?',
    { default: true },
  );

  return shouldClean;
}

/**
 * Attempt to acquire the lock for starting a new session.
 *
 * This is the main entry point for lock management. It handles:
 * 1. Checking for existing locks
 * 2. Detecting stale locks and prompting for cleanup
 * 3. Blocking if another instance is running
 * 4. Creating a new lock file
 *
 * @param cwd - Working directory
 * @param sessionId - Session ID for the new lock
 * @param options - Configuration options
 * @returns Result indicating success or failure with details
 */
export async function acquireLockWithPrompt(
  cwd: string,
  sessionId: string,
  options: {
    /** Force acquisition even if locked (for --force flag) */
    force?: boolean;
    /** Skip interactive prompt for stale lock cleanup */
    nonInteractive?: boolean;
  } = {},
): Promise<LockAcquisitionResult> {
  const { force = false, nonInteractive = false } = options;

  // Check current lock status
  const lockStatus = await checkLock(cwd);

  // No lock exists - acquire immediately
  if (!lockStatus.lock) {
    await writeLockFile(cwd, sessionId);
    return { acquired: true };
  }

  // Lock exists and is held by a running process
  if (lockStatus.isLocked && !force) {
    const pid = lockStatus.lock.pid;
    return {
      acquired: false,
      error: `Ralph already running in this repo (PID: ${pid})`,
      existingPid: pid,
    };
  }

  // Lock exists but process is not running (stale lock)
  if (lockStatus.isStale) {
    if (nonInteractive) {
      // In non-interactive mode, warn and auto-clean
      console.log(`Warning: Removing stale lock (PID: ${lockStatus.lock.pid})`);
      await deleteLockFile(cwd);
      await writeLockFile(cwd, sessionId);
      return { acquired: true };
    }

    // Interactive mode - prompt user
    const shouldClean = await promptCleanStaleLock(lockStatus.lock);

    if (!shouldClean) {
      return {
        acquired: false,
        error: 'Stale lock cleanup declined by user',
      };
    }

    await deleteLockFile(cwd);
    await writeLockFile(cwd, sessionId);
    return { acquired: true };
  }

  // Force flag set - override the lock
  if (force) {
    console.log(
      `Warning: Forcing lock acquisition (previous PID: ${lockStatus.lock.pid})`,
    );
    await deleteLockFile(cwd);
    await writeLockFile(cwd, sessionId);
    return { acquired: true };
  }

  // Should not reach here, but handle gracefully
  return {
    acquired: false,
    error: 'Unexpected lock state',
  };
}

/**
 * Release the lock for the current session.
 * Should be called on clean exit, or during crash recovery.
 */
export async function releaseLock(cwd: string): Promise<void> {
  await deleteLockFile(cwd);
}

/**
 * Register cleanup handlers to ensure lock is released on exit.
 *
 * This should be called once after acquiring the lock. It registers
 * handlers for:
 * - Normal exit (process.on('exit'))
 * - SIGTERM (graceful shutdown)
 * - SIGINT (Ctrl+C) - handled separately by the run command
 * - Uncaught exceptions
 * - Unhandled promise rejections
 *
 * @param cwd - Working directory
 * @returns Cleanup function to remove the handlers
 */
export function registerLockCleanupHandlers(cwd: string): () => void {
  // Synchronous cleanup for exit event
  const handleExit = (): void => {
    // Note: Can only do sync operations in 'exit' handler
    // The async releaseLock() may not complete, so we rely on
    // stale lock detection as a fallback
  };

  // Async cleanup for signals
  const handleTermination = async (): Promise<void> => {
    await releaseLock(cwd);
    // Don't call process.exit() here - let the calling code handle that
  };

  // Handle uncaught errors
  const handleUncaughtError = async (): Promise<void> => {
    await releaseLock(cwd);
    // Don't exit here - let Node's default behavior happen
  };

  process.on('exit', handleExit);
  process.on('SIGTERM', handleTermination);
  process.on('uncaughtException', handleUncaughtError);
  process.on('unhandledRejection', handleUncaughtError);

  // Return cleanup function
  return () => {
    process.off('exit', handleExit);
    process.off('SIGTERM', handleTermination);
    process.off('uncaughtException', handleUncaughtError);
    process.off('unhandledRejection', handleUncaughtError);
  };
}
