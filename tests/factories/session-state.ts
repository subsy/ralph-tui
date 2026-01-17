/**
 * ABOUTME: Factory functions for creating SessionMetadata and related test objects.
 * Provides type-safe builders with sensible defaults.
 */

import type {
  SessionMetadata,
  SessionStatus,
  LockFile,
  SessionCheckResult,
  CreateSessionOptions,
} from '../../src/session/types.js';

/**
 * Default values for SessionMetadata
 */
export const DEFAULT_SESSION_METADATA: SessionMetadata = {
  id: 'test-session-001',
  status: 'running',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  agentPlugin: 'claude',
  trackerPlugin: 'json',
  currentIteration: 1,
  maxIterations: 10,
  totalTasks: 5,
  tasksCompleted: 0,
  cwd: process.cwd(),
};

/**
 * Create a SessionMetadata with optional overrides
 */
export function createSessionMetadata(
  overrides: Partial<SessionMetadata> = {},
): SessionMetadata {
  return {
    ...DEFAULT_SESSION_METADATA,
    ...overrides,
  };
}

/**
 * Create a running session
 */
export function createRunningSession(
  overrides: Partial<SessionMetadata> = {},
): SessionMetadata {
  return createSessionMetadata({
    status: 'running',
    ...overrides,
  });
}

/**
 * Create a paused session
 */
export function createPausedSession(
  overrides: Partial<SessionMetadata> = {},
): SessionMetadata {
  return createSessionMetadata({
    status: 'paused',
    ...overrides,
  });
}

/**
 * Create a completed session
 */
export function createCompletedSession(
  overrides: Partial<SessionMetadata> = {},
): SessionMetadata {
  return createSessionMetadata({
    status: 'completed',
    endedAt: new Date().toISOString(),
    tasksCompleted: 5,
    ...overrides,
  });
}

/**
 * Create a failed session
 */
export function createFailedSession(
  overrides: Partial<SessionMetadata> = {},
): SessionMetadata {
  return createSessionMetadata({
    status: 'failed',
    endedAt: new Date().toISOString(),
    ...overrides,
  });
}

/**
 * Default values for LockFile
 */
export const DEFAULT_LOCK_FILE: LockFile = {
  pid: process.pid,
  sessionId: 'test-session-001',
  acquiredAt: new Date().toISOString(),
  cwd: process.cwd(),
  hostname: 'test-host',
};

/**
 * Create a LockFile with optional overrides
 */
export function createLockFile(overrides: Partial<LockFile> = {}): LockFile {
  return {
    ...DEFAULT_LOCK_FILE,
    ...overrides,
  };
}

/**
 * Create a SessionCheckResult with optional overrides
 */
export function createSessionCheckResult(
  overrides: Partial<SessionCheckResult> = {},
): SessionCheckResult {
  return {
    hasSession: false,
    isLocked: false,
    isStale: false,
    ...overrides,
  };
}

/**
 * Create a SessionCheckResult for an active locked session
 */
export function createActiveSessionCheckResult(
  session: Partial<SessionMetadata> = {},
  lock: Partial<LockFile> = {},
): SessionCheckResult {
  return createSessionCheckResult({
    hasSession: true,
    session: createSessionMetadata(session),
    isLocked: true,
    lock: createLockFile(lock),
    isStale: false,
  });
}

/**
 * Create a SessionCheckResult for a stale session
 */
export function createStaleSessionCheckResult(
  session: Partial<SessionMetadata> = {},
  lock: Partial<LockFile> = {},
): SessionCheckResult {
  return createSessionCheckResult({
    hasSession: true,
    session: createSessionMetadata({ ...session, status: 'failed' }),
    isLocked: true,
    lock: createLockFile({ ...lock, pid: 99999 }),
    isStale: true,
  });
}

/**
 * Create CreateSessionOptions with optional overrides
 */
export function createSessionOptions(
  overrides: Partial<CreateSessionOptions> = {},
): CreateSessionOptions {
  return {
    agentPlugin: 'claude',
    trackerPlugin: 'json',
    maxIterations: 10,
    totalTasks: 5,
    cwd: process.cwd(),
    ...overrides,
  };
}
