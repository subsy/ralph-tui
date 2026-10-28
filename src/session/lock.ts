/**
 * ABOUTME: Single instance lock management for Ralph TUI.
 * Prevents concurrent runs in the same git repository to avoid state corruption.
 * Provides clear user feedback for lock conflicts and stale lock handling.
 */

import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  linkSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import {
  readFile,
  link,
  unlink,
  mkdir,
  access,
  constants,
  open,
  readdir,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import { promptBoolean } from '../setup/prompts.js';
import type { LockFile } from './types.js';

/**
 * Directory for session data (relative to cwd)
 */
const SESSION_DIR = '.ralph-tui';
const LOCK_FILE = 'ralph.lock';
const LOCK_GUARD_FILE = 'ralph.lock.guard';
const GUARD_TIMEOUT_MS = 2000;
// This must exceed any guarded critical section; abandoned guards are normally
// reclaimed immediately by the dead-PID check.
const GUARD_STALE_MS = 10000;
const GUARD_MALFORMED_GRACE_MS = 250;
const GUARD_SYNC_TIMEOUT_MS = 300;
const LOCK_GUARD_TIMEOUT_MESSAGE =
  'Timed out waiting for the session lock (another ralph-tui process may be starting or exiting)';
const HARD_LINK_UNSUPPORTED_CODES = new Set([
  'EPERM',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EXDEV',
]);

interface LockGuardFile {
  pid: number;
  guardId: string;
  acquiredAt: string;
}

type GuardState =
  | { kind: 'missing' }
  | { kind: 'malformed'; mtimeMs: number }
  | { kind: 'held'; guard: LockGuardFile };

class LockGuardTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the session lock guard');
    this.name = 'LockGuardTimeoutError';
  }
}

const currentLockIds = new Map<string, string>();

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
 * Get the resolved lock path used to identify a local lock acquisition.
 */
function getResolvedLockPath(cwd: string): string {
  return resolve(getLockPath(cwd));
}

/**
 * Get the lock guard path.
 */
function getLockGuardPath(cwd: string): string {
  return join(getSessionDir(cwd), LOCK_GUARD_FILE);
}

/**
 * Get the temporary path used to publish a lock guard atomically.
 */
function getLockGuardTempPath(cwd: string, guardId: string): string {
  return join(getSessionDir(cwd), `${LOCK_GUARD_FILE}.${guardId}.tmp`);
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
 * Validate parsed lock guard contents.
 */
function isUsableLockGuard(value: unknown): value is LockGuardFile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const guard = value as Record<string, unknown>;
  return (
    typeof guard.pid === 'number' &&
    Number.isInteger(guard.pid) &&
    guard.pid > 0 &&
    typeof guard.guardId === 'string' &&
    guard.guardId.length > 0 &&
    typeof guard.acquiredAt === 'string' &&
    guard.acquiredAt.length > 0
  );
}

/**
 * Read the lock guard and preserve whether it is absent or malformed.
 */
async function readLockGuardFile(cwd: string): Promise<GuardState> {
  const guardPath = getLockGuardPath(cwd);
  let mtimeMs: number;

  try {
    ({ mtimeMs } = await stat(guardPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing' };
    }
    return { kind: 'malformed', mtimeMs: Number.NaN };
  }

  try {
    const content = await readFile(guardPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (isUsableLockGuard(parsed)) {
      return { kind: 'held', guard: parsed };
    }
  } catch {
    // Treat an unreadable guard as malformed while retaining its timestamp.
  }

  return { kind: 'malformed', mtimeMs };
}

/**
 * Read the lock guard synchronously and preserve its state.
 */
function readLockGuardFileSync(cwd: string): GuardState {
  const guardPath = getLockGuardPath(cwd);
  let mtimeMs: number;

  try {
    ({ mtimeMs } = statSync(guardPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing' };
    }
    return { kind: 'malformed', mtimeMs: Number.NaN };
  }

  try {
    const content = readFileSync(guardPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (isUsableLockGuard(parsed)) {
      return { kind: 'held', guard: parsed };
    }
  } catch {
    // Treat an unreadable guard as malformed while retaining its timestamp.
  }

  return { kind: 'malformed', mtimeMs };
}

/**
 * Check whether a guard has been abandoned.
 */
function isGuardStale(guard: LockGuardFile): boolean {
  const acquiredAt = Date.parse(guard.acquiredAt);
  return (
    !isProcessRunning(guard.pid) ||
    Number.isNaN(acquiredAt) ||
    Date.now() - acquiredAt >= GUARD_STALE_MS
  );
}

/**
 * Remove a guard only when it still has the observed identity.
 */
async function removeGuardIfOwned(
  cwd: string,
  guardId: string
): Promise<void> {
  const state = await readLockGuardFile(cwd);
  if (state.kind !== 'held' || state.guard.guardId !== guardId) {
    return;
  }

  try {
    await unlink(getLockGuardPath(cwd));
  } catch {
    // Ignore a guard removed by another cleanup attempt.
  }
}

/**
 * Remove a guard synchronously only when it still has the observed identity.
 */
function removeGuardIfOwnedSync(cwd: string, guardId: string): void {
  const state = readLockGuardFileSync(cwd);
  if (state.kind !== 'held' || state.guard.guardId !== guardId) {
    return;
  }

  try {
    unlinkSync(getLockGuardPath(cwd));
  } catch {
    // Ignore a guard removed by another cleanup attempt.
  }
}

/**
 * Break a stale guard without removing a newer guard that replaced it.
 */
async function breakStaleGuard(
  cwd: string,
  observedGuardId: string
): Promise<void> {
  const state = await readLockGuardFile(cwd);
  if (
    state.kind !== 'held' ||
    state.guard.guardId !== observedGuardId ||
    !isGuardStale(state.guard)
  ) {
    return;
  }

  try {
    await unlink(getLockGuardPath(cwd));
  } catch {
    // Ignore a guard removed by its owner.
  }
}

/**
 * Break a stale guard synchronously without removing a newer guard.
 */
function breakStaleGuardSync(cwd: string, observedGuardId: string): void {
  const state = readLockGuardFileSync(cwd);
  if (
    state.kind !== 'held' ||
    state.guard.guardId !== observedGuardId ||
    !isGuardStale(state.guard)
  ) {
    return;
  }

  try {
    unlinkSync(getLockGuardPath(cwd));
  } catch {
    // Ignore a guard removed by its owner.
  }
}

/**
 * Reclaim a malformed guard from a legacy version, damaged filesystem, or
 * create-then-write fallback only when its observed timestamp is unchanged.
 */
async function breakMalformedGuard(
  cwd: string,
  observedMtimeMs: number
): Promise<void> {
  if (
    !Number.isFinite(observedMtimeMs) ||
    Date.now() - observedMtimeMs < GUARD_MALFORMED_GRACE_MS
  ) {
    return;
  }

  let currentMtimeMs: number;
  try {
    ({ mtimeMs: currentMtimeMs } = await stat(getLockGuardPath(cwd)));
  } catch {
    return;
  }

  if (
    currentMtimeMs !== observedMtimeMs ||
    Date.now() - currentMtimeMs < GUARD_MALFORMED_GRACE_MS
  ) {
    return;
  }

  try {
    await unlink(getLockGuardPath(cwd));
  } catch {
    // Ignore a guard removed by another cleanup attempt.
  }
}

/**
 * Break a malformed guard synchronously when its observed timestamp is unchanged.
 */
function breakMalformedGuardSync(cwd: string, observedMtimeMs: number): void {
  if (
    !Number.isFinite(observedMtimeMs) ||
    Date.now() - observedMtimeMs < GUARD_MALFORMED_GRACE_MS
  ) {
    return;
  }

  let currentMtimeMs: number;
  try {
    ({ mtimeMs: currentMtimeMs } = statSync(getLockGuardPath(cwd)));
  } catch {
    return;
  }

  if (
    currentMtimeMs !== observedMtimeMs ||
    Date.now() - currentMtimeMs < GUARD_MALFORMED_GRACE_MS
  ) {
    return;
  }

  try {
    unlinkSync(getLockGuardPath(cwd));
  } catch {
    // Ignore a guard removed by another cleanup attempt.
  }
}

/**
 * Remove abandoned guard publication files without disturbing fresh attempts.
 */
async function cleanStaleGuardTempFiles(cwd: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(getSessionDir(cwd));
  } catch {
    return;
  }

  const prefix = `${LOCK_GUARD_FILE}.`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.tmp')) {
      continue;
    }

    const path = join(getSessionDir(cwd), entry);
    try {
      const { mtimeMs } = await stat(path);
      if (Date.now() - mtimeMs >= GUARD_STALE_MS) {
        await unlink(path);
      }
    } catch {
      // Ignore files removed or made inaccessible by another process.
    }
  }
}

/**
 * Remove abandoned guard publication files synchronously.
 */
function cleanStaleGuardTempFilesSync(cwd: string): void {
  let entries: string[];
  try {
    entries = readdirSync(getSessionDir(cwd));
  } catch {
    return;
  }

  const prefix = `${LOCK_GUARD_FILE}.`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.tmp')) {
      continue;
    }

    const path = join(getSessionDir(cwd), entry);
    try {
      const { mtimeMs } = statSync(path);
      if (Date.now() - mtimeMs >= GUARD_STALE_MS) {
        unlinkSync(path);
      }
    } catch {
      // Ignore files removed or made inaccessible by another process.
    }
  }
}

/**
 * Publish a complete guard with exclusive creation when hard links are unavailable.
 */
async function tryCreateLockGuardWithoutLink(
  cwd: string,
  guard: LockGuardFile
): Promise<boolean> {
  let handle: FileHandle | null = null;

  try {
    try {
      handle = await open(getLockGuardPath(cwd), 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      throw error;
    }

    await handle.writeFile(JSON.stringify(guard), 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;
    return true;
  } finally {
    if (handle !== null) {
      await handle.close();
    }
  }
}

function tryCreateLockGuardWithoutLinkSync(
  cwd: string,
  guard: LockGuardFile
): boolean {
  let fileDescriptor: number | null = null;

  try {
    try {
      fileDescriptor = openSync(getLockGuardPath(cwd), 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      throw error;
    }

    writeFileSync(fileDescriptor, JSON.stringify(guard), 'utf-8');
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = null;
    return true;
  } finally {
    if (fileDescriptor !== null) {
      closeSync(fileDescriptor);
    }
  }
}

/**
 * Publish the guard file atomically after writing its complete contents.
 */
async function tryCreateLockGuard(
  cwd: string,
  guardId: string
): Promise<boolean> {
  const tempPath = getLockGuardTempPath(cwd, guardId);
  let handle: FileHandle | null = null;

  try {
    try {
      handle = await open(tempPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      throw error;
    }

    const guard: LockGuardFile = {
      pid: process.pid,
      guardId,
      acquiredAt: new Date().toISOString(),
    };
    await handle.writeFile(JSON.stringify(guard), 'utf-8');
    await handle.sync();

    await handle.close();
    handle = null;
    try {
      await link(tempPath, getLockGuardPath(cwd));
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        return false;
      }
      if (HARD_LINK_UNSUPPORTED_CODES.has(code ?? '')) {
        return tryCreateLockGuardWithoutLink(cwd, guard);
      }
      throw error;
    }
  } finally {
    if (handle !== null) {
      await handle.close();
    }
    try {
      await unlink(tempPath);
    } catch {
      // Best effort cleanup after publication or a failed attempt.
    }
  }
}

/**
 * Publish the guard file synchronously after writing its complete contents.
 */
function tryCreateLockGuardSync(cwd: string, guardId: string): boolean {
  const tempPath = getLockGuardTempPath(cwd, guardId);
  let fileDescriptor: number | null = null;

  try {
    try {
      fileDescriptor = openSync(tempPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      throw error;
    }

    const guard: LockGuardFile = {
      pid: process.pid,
      guardId,
      acquiredAt: new Date().toISOString(),
    };
    writeFileSync(fileDescriptor, JSON.stringify(guard), 'utf-8');
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = null;

    try {
      linkSync(tempPath, getLockGuardPath(cwd));
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        return false;
      }
      if (HARD_LINK_UNSUPPORTED_CODES.has(code ?? '')) {
        return tryCreateLockGuardWithoutLinkSync(cwd, guard);
      }
      throw error;
    }
  } finally {
    if (fileDescriptor !== null) {
      closeSync(fileDescriptor);
    }
    try {
      unlinkSync(tempPath);
    } catch {
      // Best effort cleanup after publication or a failed attempt.
    }
  }
}

/**
 * Serialize asynchronous mutations of the session lock.
 */
async function withLockGuard<T>(
  cwd: string,
  fn: () => Promise<T>
): Promise<T> {
  await ensureSessionDir(cwd);
  const guardId = randomUUID();
  const deadline = Date.now() + GUARD_TIMEOUT_MS;

  while (true) {
    if (await tryCreateLockGuard(cwd, guardId)) {
      break;
    }

    await cleanStaleGuardTempFiles(cwd);
    const guardState = await readLockGuardFile(cwd);
    if (guardState.kind === 'held' && isGuardStale(guardState.guard)) {
      await breakStaleGuard(cwd, guardState.guard.guardId);
    } else if (guardState.kind === 'malformed') {
      await breakMalformedGuard(cwd, guardState.mtimeMs);
    }

    if (Date.now() >= deadline) {
      throw new LockGuardTimeoutError();
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  try {
    return await fn();
  } finally {
    await removeGuardIfOwned(cwd, guardId);
  }
}

/**
 * Serialize synchronous mutations of the session lock.
 */
function withLockGuardSync(cwd: string, fn: () => void): void {
  try {
    mkdirSync(getSessionDir(cwd), { recursive: true });
  } catch {
    // Give up without mutating the lock; the next start recovers it as stale.
    return;
  }

  const guardId = randomUUID();
  const deadline = Date.now() + GUARD_SYNC_TIMEOUT_MS;
  const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

  while (true) {
    try {
      if (tryCreateLockGuardSync(cwd, guardId)) {
        break;
      }
    } catch {
      // Give up without mutating the lock; the next start recovers it as stale.
      return;
    }

    cleanStaleGuardTempFilesSync(cwd);
    const guardState = readLockGuardFileSync(cwd);
    if (guardState.kind === 'held' && isGuardStale(guardState.guard)) {
      breakStaleGuardSync(cwd, guardState.guard.guardId);
    } else if (guardState.kind === 'malformed') {
      breakMalformedGuardSync(cwd, guardState.mtimeMs);
    }

    if (Date.now() >= deadline) {
      // Give up without mutating the lock; the next start recovers it as stale.
      return;
    }

    Atomics.wait(sleepBuffer, 0, 0, 5);
  }

  try {
    fn();
  } finally {
    removeGuardIfOwnedSync(cwd, guardId);
  }
}

/**
 * Check whether the current process owns a lock.
 */
function isOurLock(cwd: string, lock: LockFile): boolean {
  return lock.lockId === undefined
    ? lock.pid === process.pid
    : lock.lockId === currentLockIds.get(getResolvedLockPath(cwd));
}

/**
 * Check whether the current process owns the lock without modifying it.
 */
export async function ownsLock(cwd: string): Promise<boolean> {
  const lock = await readLockFile(cwd);
  return lock !== null && isOurLock(cwd, lock);
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
    lockId: randomUUID(),
    pid: process.pid,
    sessionId,
    acquiredAt: new Date().toISOString(),
    cwd,
    hostname: hostname(),
  };

  let handle: FileHandle | null = null;
  try {
    // 'wx' enforces O_CREAT|O_EXCL so lock creation is atomic across processes.
    handle = await open(lockPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify(lock, null, 2), 'utf-8');
      await handle.sync();
      if (lock.lockId) {
        currentLockIds.set(getResolvedLockPath(cwd), lock.lockId);
      }
    } catch (error) {
      try {
        await handle.close();
      } catch {
        // Best effort close before removing partial file.
      }
      handle = null;
      try {
        await unlink(lockPath);
      } catch {
        // Best effort cleanup for partial lock file.
      }
      throw error;
    }
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

/**
 * Attempt to atomically create a lock file.
 * Returns a structured conflict result when another process wins the race.
 */
async function tryWriteLockFile(
  cwd: string,
  sessionId: string
): Promise<LockAcquisitionResult> {
  try {
    await writeLockFile(cwd, sessionId);
    return { acquired: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const refreshed = await checkLock(cwd);
      const existingPid = refreshed.lock?.pid;
      return {
        acquired: false,
        error: existingPid
          ? `Ralph already running in this repo (PID: ${existingPid})`
          : 'Ralph lock already exists in this repo',
        existingPid,
      };
    }
    throw error;
  }
}

/**
 * Remove the lock file
 */
async function deleteLockFile(cwd: string): Promise<boolean> {
  const lockPath = getLockPath(cwd);
  try {
    await unlink(lockPath);
    return true;
  } catch {
    // Ignore if lock doesn't exist
    return false;
  }
}

/**
 * Return the standard conflict result for an existing lock.
 */
function lockConflictResult(lock: LockFile): LockAcquisitionResult {
  return {
    acquired: false,
    error: `Ralph already running in this repo (PID: ${lock.pid})`,
    existingPid: lock.pid,
  };
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
    { default: true }
  );

  return shouldClean;
}

/**
 * Re-read and replace the lock while holding the mutation guard.
 */
async function replaceLockUnderGuard(
  cwd: string,
  sessionId: string,
  force: boolean
): Promise<LockAcquisitionResult> {
  try {
    return await withLockGuard(cwd, async () => {
      const refreshed = await checkLock(cwd);
      if (refreshed.lock) {
        if (force || refreshed.isStale) {
          await deleteLockFile(cwd);
        } else {
          return lockConflictResult(refreshed.lock);
        }
      }
      return tryWriteLockFile(cwd, sessionId);
    });
  } catch (error) {
    if (error instanceof LockGuardTimeoutError) {
      return {
        acquired: false,
        error: LOCK_GUARD_TIMEOUT_MESSAGE,
      };
    }
    throw error;
  }
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
  } = {}
): Promise<LockAcquisitionResult> {
  const { force = false, nonInteractive = false } = options;

  // Check current lock status
  const lockStatus = await checkLock(cwd);

  // No lock exists - acquire immediately
  if (!lockStatus.lock) {
    return replaceLockUnderGuard(cwd, sessionId, force);
  }

  // Lock exists and is held by a running process
  if (lockStatus.isLocked && !force) {
    return lockConflictResult(lockStatus.lock);
  }

  // Lock exists but process is not running (stale lock)
  if (lockStatus.isStale) {
    if (nonInteractive) {
      // In non-interactive mode, warn and auto-clean
      console.log(`Warning: Removing stale lock (PID: ${lockStatus.lock.pid})`);
      return replaceLockUnderGuard(cwd, sessionId, force);
    }

    // Interactive mode - prompt user
    const shouldClean = await promptCleanStaleLock(lockStatus.lock);

    if (!shouldClean) {
      return {
        acquired: false,
        error: 'Stale lock cleanup declined by user',
      };
    }

    return replaceLockUnderGuard(cwd, sessionId, force);
  }

  // Force flag set - override the lock
  if (force) {
    console.log(`Warning: Forcing lock acquisition (previous PID: ${lockStatus.lock.pid})`);
    return replaceLockUnderGuard(cwd, sessionId, force);
  }

  // Should not reach here, but handle gracefully
  return {
    acquired: false,
    error: 'Unexpected lock state',
  };
}

/**
 * Acquire a lock only when no lock file exists.
 *
 * This is the legacy session API used by resume flows. Stale locks are
 * intentionally left for cleanStaleLock to remove first.
 */
export async function acquireLockExclusiveResult(
  cwd: string,
  sessionId: string
): Promise<LockAcquisitionResult> {
  try {
    return await withLockGuard(cwd, async () => {
      const lock = await readLockFile(cwd);
      if (lock) {
        return lockConflictResult(lock);
      }

      return tryWriteLockFile(cwd, sessionId);
    });
  } catch (error) {
    if (error instanceof LockGuardTimeoutError) {
      return {
        acquired: false,
        error: LOCK_GUARD_TIMEOUT_MESSAGE,
      };
    }
    throw error;
  }
}

/**
 * Acquire a lock only when no lock file exists.
 */
export async function acquireLockExclusive(
  cwd: string,
  sessionId: string
): Promise<boolean> {
  return (await acquireLockExclusiveResult(cwd, sessionId)).acquired;
}

/**
 * Remove a stale lock while holding the session lock guard.
 */
export async function cleanStaleLock(cwd: string): Promise<boolean> {
  try {
    return await withLockGuard(cwd, async () => {
      const lock = await readLockFile(cwd);
      if (!lock || isProcessRunning(lock.pid)) {
        return false;
      }

      await deleteLockFile(cwd);
      return true;
    });
  } catch (error) {
    if (error instanceof LockGuardTimeoutError) {
      return false;
    }
    throw error;
  }
}

/**
 * Release the lock for the current session.
 * Should be called on clean exit, or during crash recovery.
 */
export async function releaseLock(cwd: string): Promise<void> {
  const releaseOwnedLock = async (): Promise<void> => {
    const lock = await readLockFile(cwd);
    if (lock && isOurLock(cwd, lock)) {
      if (await deleteLockFile(cwd)) {
        currentLockIds.delete(getResolvedLockPath(cwd));
      }
    }
  };

  try {
    await withLockGuard(cwd, releaseOwnedLock);
  } catch (error) {
    if (error instanceof LockGuardTimeoutError) {
      // Leave the lock for the next start to recover as stale.
      return;
    }
    throw error;
  }
}

/**
 * Release the lock synchronously when the current process owns it.
 */
export function releaseLockSync(cwd: string): void {
  withLockGuardSync(cwd, () => {
    const lockPath = getLockPath(cwd);

    try {
      const content = readFileSync(lockPath, 'utf-8');
      const lock = JSON.parse(content) as LockFile;

      if (isOurLock(cwd, lock)) {
        unlinkSync(lockPath);
        currentLockIds.delete(getResolvedLockPath(cwd));
      }
    } catch {
      // Best effort cleanup for missing or corrupt lock files.
    }
  });
}

/**
 * Register cleanup handlers to ensure lock is released on exit.
 *
 * This should be called once after acquiring the lock. It registers
 * handlers for:
 * - Normal exit (process.on('exit'))
 * - SIGTERM and SIGINT (graceful shutdown)
 * - Uncaught exceptions
 * - Unhandled promise rejections
 *
 * @param cwd - Working directory
 * @returns Cleanup function to remove the handlers
 */
export function registerLockCleanupHandlers(cwd: string): () => void {
  // Synchronous cleanup for exit event
  const handleExit = (): void => {
    releaseLockSync(cwd);
  };

  // While this is the only listener, nothing else can shut down the process,
  // so the lock layer terminates with the conventional signal exit code.
  // Once the run command or parallel mode installs its own listener, this
  // handler becomes a no-op and the application owns the signal entirely.
  const handleSignal = (signal: 'SIGTERM' | 'SIGINT') => (): void => {
    if (process.listenerCount(signal) > 1) {
      return;
    }
    releaseLockSync(cwd);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const handleSigterm = handleSignal('SIGTERM');
  const handleSigint = handleSignal('SIGINT');

  // Handle uncaught errors
  const handleUncaughtError = async (): Promise<void> => {
    await releaseLock(cwd);
    // Don't exit here - let Node's default behavior happen
  };

  process.on('exit', handleExit);
  process.on('SIGTERM', handleSigterm);
  process.on('SIGINT', handleSigint);
  process.on('uncaughtException', handleUncaughtError);
  process.on('unhandledRejection', handleUncaughtError);

  // Return cleanup function
  return () => {
    process.off('exit', handleExit);
    process.off('SIGTERM', handleSigterm);
    process.off('SIGINT', handleSigint);
    process.off('uncaughtException', handleUncaughtError);
    process.off('unhandledRejection', handleUncaughtError);
  };
}
