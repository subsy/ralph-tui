/**
 * ABOUTME: Session registry for cross-directory session discovery.
 * Maintains a global registry of active sessions at ~/.config/ralph-tui/sessions.json
 * allowing users to resume sessions from any directory.
 *
 * Security: Uses restrictive file permissions (0o700 for dir, 0o600 for file).
 * Reliability: Uses file locking and atomic writes to prevent corruption.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  readFile,
  mkdir,
  access,
  constants,
  chmod,
  rename,
  unlink,
  open,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { SessionStatus } from './types.js';

/**
 * Registry file location in user's config directory
 */
const REGISTRY_DIR = join(homedir(), '.config', 'ralph-tui');
const REGISTRY_FILE = 'sessions.json';
const LOCK_FILE = 'sessions.lock';

/**
 * Restrictive permissions for security
 */
const DIR_MODE = 0o700;  // Owner read/write/execute only
const FILE_MODE = 0o600; // Owner read/write only

/**
 * Lock timeout in milliseconds
 */
const LOCK_TIMEOUT_MS = 30000; // 30 seconds
const LOCK_RETRY_DELAY_MS = 50;

/**
 * Platform detection for Windows-specific file handling.
 * Windows doesn't support Unix-style numeric file flags combined with permission modes.
 */
const IS_WINDOWS = process.platform === 'win32';

/**
 * Entry in the session registry
 */
export interface SessionRegistryEntry {
  /** Unique session identifier */
  sessionId: string;

  /** Working directory where the session was started */
  cwd: string;

  /** Current session status */
  status: SessionStatus;

  /** When the session was started (ISO 8601) */
  startedAt: string;

  /** When the session was last updated (ISO 8601) */
  updatedAt: string;

  /** Agent plugin being used */
  agentPlugin: string;

  /** Tracker plugin being used */
  trackerPlugin: string;

  /** Epic ID (for beads tracker) */
  epicId?: string;

  /** PRD path (for json tracker) */
  prdPath?: string;

  /** Whether sandbox mode was used */
  sandbox?: boolean;
}

/**
 * Session registry structure
 */
export interface SessionRegistry {
  /** Schema version for forward compatibility */
  version: 1;

  /** Map of session ID to registry entry */
  sessions: Record<string, SessionRegistryEntry>;
}

/**
 * Get the registry file path
 */
function getRegistryPath(): string {
  return join(REGISTRY_DIR, REGISTRY_FILE);
}

/**
 * Get the lock file path
 */
function getLockPath(): string {
  return join(REGISTRY_DIR, LOCK_FILE);
}

/**
 * Ensure registry directory exists with correct permissions
 */
async function ensureRegistryDir(): Promise<void> {
  try {
    await access(REGISTRY_DIR, constants.F_OK);
    // Directory exists, ensure correct permissions
    await chmod(REGISTRY_DIR, DIR_MODE);
  } catch {
    // Directory doesn't exist, create with correct permissions
    await mkdir(REGISTRY_DIR, { recursive: true, mode: DIR_MODE });
  }
}

/**
 * Acquire an exclusive lock for registry operations.
 * Uses a lockfile with O_EXCL for cross-process synchronization.
 */
async function acquireLock(): Promise<FileHandle> {
  await ensureRegistryDir();
  const lockPath = getLockPath();
  const startTime = Date.now();

  while (true) {
    try {
      // O_CREAT | O_EXCL ensures atomic creation - fails if file exists
      // Windows doesn't support numeric flags with Unix permissions, so use string flag 'wx'
      const handle = IS_WINDOWS
        ? await open(lockPath, 'wx', FILE_MODE)
        : await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, FILE_MODE);
      // Write our PID for debugging stale locks
      await handle.write(`${process.pid}\n`);
      await handle.sync();
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lock exists, check if it's stale
        if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
          // Lock timeout - force remove stale lock and retry
          try {
            await unlink(lockPath);
          } catch (unlinkError) {
            // ENOENT is fine (lock was already removed by another process)
            // Any other error means we can't remove the lock - bail out
            if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw new Error(
                `Failed to remove stale lock file at ${lockPath}: ${(unlinkError as Error).message}`
              );
            }
          }
          continue;
        }
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Release the lock
 */
async function releaseLock(handle: FileHandle): Promise<void> {
  const lockPath = getLockPath();
  try {
    await handle.close();
  } finally {
    try {
      await unlink(lockPath);
    } catch {
      // Ignore unlink errors
    }
  }
}

/**
 * Load the session registry from disk (internal, no locking)
 */
async function loadRegistryInternal(): Promise<SessionRegistry> {
  const registryPath = getRegistryPath();

  try {
    await access(registryPath, constants.F_OK);
    const content = await readFile(registryPath, 'utf-8');
    const parsed = JSON.parse(content) as SessionRegistry;

    // Validate structure: sessions must be a plain, non-null object (not an array)
    if (
      parsed.version !== 1 ||
      !parsed.sessions ||
      typeof parsed.sessions !== 'object' ||
      Array.isArray(parsed.sessions)
    ) {
      return { version: 1, sessions: {} };
    }

    return parsed;
  } catch {
    return { version: 1, sessions: {} };
  }
}

/**
 * Save the session registry to disk atomically (internal, no locking)
 * Uses write-to-temp + fsync + rename pattern for durability.
 */
async function saveRegistryInternal(registry: SessionRegistry): Promise<void> {
  await ensureRegistryDir();
  const registryPath = getRegistryPath();
  const tempPath = `${registryPath}.${process.pid}.tmp`;

  let tempHandle: FileHandle | null = null;
  try {
    // Write to temp file with restrictive permissions
    // Windows doesn't support numeric flags with Unix permissions, so use string flag 'w'
    tempHandle = IS_WINDOWS
      ? await open(tempPath, 'w', FILE_MODE)
      : await open(tempPath, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC, FILE_MODE);
    const content = JSON.stringify(registry, null, 2);
    await tempHandle.write(content);

    // Ensure data is flushed to disk
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;

    // Atomic rename over target
    await rename(tempPath, registryPath);

    // Ensure correct permissions on final file (in case it existed before)
    await chmod(registryPath, FILE_MODE);
  } catch (error) {
    // Clean up temp file on error
    if (tempHandle) {
      try {
        await tempHandle.close();
      } catch {
        // Ignore close errors
      }
    }
    try {
      await unlink(tempPath);
    } catch {
      // Ignore unlink errors
    }
    throw error;
  }
}

/**
 * Execute a registry mutation with proper locking.
 * Acquires lock, loads registry, calls mutator, saves registry, releases lock.
 */
async function withRegistryLock<T>(
  mutator: (registry: SessionRegistry) => T | Promise<T>
): Promise<T> {
  const lockHandle = await acquireLock();
  try {
    const registry = await loadRegistryInternal();
    const result = await mutator(registry);
    await saveRegistryInternal(registry);
    return result;
  } finally {
    await releaseLock(lockHandle);
  }
}

/**
 * Load the session registry from disk
 */
export async function loadRegistry(): Promise<SessionRegistry> {
  const lockHandle = await acquireLock();
  try {
    return await loadRegistryInternal();
  } finally {
    await releaseLock(lockHandle);
  }
}

/**
 * Save the session registry to disk
 */
export async function saveRegistry(registry: SessionRegistry): Promise<void> {
  const lockHandle = await acquireLock();
  try {
    await saveRegistryInternal(registry);
  } finally {
    await releaseLock(lockHandle);
  }
}

/**
 * Register a new session in the global registry
 */
export async function registerSession(entry: SessionRegistryEntry): Promise<void> {
  await withRegistryLock((registry) => {
    registry.sessions[entry.sessionId] = entry;
  });
}

/**
 * Update a session's status in the registry
 */
export async function updateRegistryStatus(
  sessionId: string,
  status: SessionStatus
): Promise<void> {
  await withRegistryLock((registry) => {
    const entry = registry.sessions[sessionId];
    if (entry) {
      entry.status = status;
      entry.updatedAt = new Date().toISOString();
    }
  });
}

/**
 * Remove a session from the registry (on completion or explicit cleanup)
 */
export async function unregisterSession(sessionId: string): Promise<void> {
  await withRegistryLock((registry) => {
    delete registry.sessions[sessionId];
  });
}

/**
 * Get a session entry by ID
 */
export async function getSessionById(
  sessionId: string
): Promise<SessionRegistryEntry | null> {
  const registry = await loadRegistry();
  return registry.sessions[sessionId] ?? null;
}

/**
 * Get a session entry by working directory
 */
export async function getSessionByCwd(
  cwd: string
): Promise<SessionRegistryEntry | null> {
  const registry = await loadRegistry();

  for (const entry of Object.values(registry.sessions)) {
    if (entry.cwd === cwd) {
      return entry;
    }
  }

  return null;
}

/**
 * List all resumable sessions (paused, running, or interrupted)
 */
export async function listResumableSessions(): Promise<SessionRegistryEntry[]> {
  const registry = await loadRegistry();
  const resumableStatuses: SessionStatus[] = ['paused', 'running', 'interrupted'];

  return Object.values(registry.sessions).filter((entry) =>
    resumableStatuses.includes(entry.status)
  );
}

/**
 * List all sessions (including completed/failed for history)
 */
export async function listAllSessions(): Promise<SessionRegistryEntry[]> {
  const registry = await loadRegistry();
  return Object.values(registry.sessions);
}

/**
 * Clean up stale sessions from the registry.
 * Removes entries for sessions that no longer have a session file.
 *
 * Uses a two-phase approach to avoid holding the lock during potentially
 * slow I/O checks: snapshots entries under lock, runs checks without lock,
 * then reacquires lock to delete stale entries (with race-safety checks).
 */
export async function cleanupStaleRegistryEntries(
  checkSessionExists: (cwd: string) => Promise<boolean>
): Promise<number> {
  // Phase 1: Snapshot registry entries under lock
  const snapshot: Array<{ sessionId: string; cwd: string }> = [];
  const registry = await loadRegistry();
  for (const [sessionId, entry] of Object.entries(registry.sessions)) {
    snapshot.push({ sessionId, cwd: entry.cwd });
  }

  if (snapshot.length === 0) {
    return 0;
  }

  // Phase 2: Check each session without holding the lock
  const staleIds: string[] = [];
  for (const { sessionId, cwd } of snapshot) {
    const exists = await checkSessionExists(cwd);
    if (!exists) {
      staleIds.push(sessionId);
    }
  }

  if (staleIds.length === 0) {
    return 0;
  }

  // Phase 3: Reacquire lock and delete stale entries (with race-safety)
  let cleaned = 0;
  await withRegistryLock((currentRegistry) => {
    for (const sessionId of staleIds) {
      const entry = currentRegistry.sessions[sessionId];
      // Only delete if the entry still exists and cwd hasn't changed (race safety)
      const originalCwd = snapshot.find(s => s.sessionId === sessionId)?.cwd;
      if (entry && entry.cwd === originalCwd) {
        delete currentRegistry.sessions[sessionId];
        cleaned++;
      }
    }
  });

  return cleaned;
}

/**
 * Find sessions matching a partial session ID prefix
 */
export async function findSessionsByPrefix(
  prefix: string
): Promise<SessionRegistryEntry[]> {
  const registry = await loadRegistry();

  return Object.entries(registry.sessions)
    .filter(([id]) => id.startsWith(prefix))
    .map(([, entry]) => entry);
}

/**
 * Get the registry file path (exposed for testing/diagnostics)
 */
export function getRegistryFilePath(): string {
  return getRegistryPath();
}
