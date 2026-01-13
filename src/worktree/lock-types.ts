/**
 * ABOUTME: Type definitions for the Resource Lock Manager.
 * Defines interfaces for managing locks on shared resources like build caches
 * and lock files to prevent parallel agents from corrupting shared state.
 */

/**
 * Lock mode for resource access.
 * - 'read': Shared read-only access (multiple readers allowed)
 * - 'write': Exclusive write access (blocks all other access)
 */
export type LockMode = 'read' | 'write';

/**
 * Resource categories for lock classification.
 */
export type ResourceCategory =
  | 'build_cache'
  | 'lock_file'
  | 'node_modules'
  | 'git_index'
  | 'temp_directory'
  | 'shared_state'
  | 'custom';

/**
 * Represents a lock on a specific resource.
 * Tracks ownership, mode, and timing for lock management.
 */
export interface ResourceLock {
  /** Unique identifier for this lock instance */
  id: string;

  /** Name of the resource being locked (e.g., 'build-cache', 'package-lock.json') */
  resourceName: string;

  /** Category of the resource for grouping and policies */
  category: ResourceCategory;

  /** ID of the agent holding this lock */
  holderAgentId: string;

  /** Lock mode (read or write) */
  mode: LockMode;

  /** Timestamp when the lock was acquired */
  acquiredAt: Date;

  /** Timeout duration in milliseconds (0 = no timeout) */
  timeoutMs: number;

  /** Timestamp when the lock will expire (if timeoutMs > 0) */
  expiresAt?: Date;

  /** Optional worktree ID if lock is worktree-specific */
  worktreeId?: string;

  /** Optional metadata for extensibility */
  metadata?: Record<string, unknown>;
}

/**
 * Result of attempting to acquire a lock.
 */
export type LockAcquisitionResult =
  | { success: true; lock: ResourceLock }
  | { success: false; reason: LockAcquisitionFailureReason; waitingBehind?: string[] };

/**
 * Reasons why lock acquisition might fail.
 */
export type LockAcquisitionFailureReason =
  | 'resource_locked_exclusive'
  | 'write_lock_blocked_by_readers'
  | 'timeout_waiting'
  | 'agent_not_registered'
  | 'invalid_resource';

/**
 * Options for acquiring a lock.
 */
export interface LockAcquisitionOptions {
  /** Lock mode (default: 'write') */
  mode?: LockMode;

  /** Timeout for the lock itself in milliseconds (0 = no timeout, default: 30000) */
  lockTimeoutMs?: number;

  /** Maximum time to wait for lock acquisition in milliseconds (0 = no wait, default: 0) */
  waitTimeoutMs?: number;

  /** Worktree ID for worktree-specific locks */
  worktreeId?: string;

  /** Resource category for classification */
  category?: ResourceCategory;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Represents a pending lock request in the queue.
 */
export interface PendingLockRequest {
  id: string;
  resourceName: string;
  agentId: string;
  mode: LockMode;
  requestedAt: Date;
  resolve: (result: LockAcquisitionResult) => void;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  lockTimeoutMs: number;
  category: ResourceCategory;
  worktreeId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Cache isolation mode for worktrees.
 * Implements shared read-only cache with isolated writes pattern.
 */
export interface CacheIsolationConfig {
  /** Path to the shared read-only cache directory */
  sharedCachePath: string;

  /** Base path for worktree-specific cache directories */
  worktreeCacheBasePath: string;

  /** Whether to copy-on-write from shared cache */
  copyOnWrite: boolean;

  /** Maximum size of the shared cache in MB */
  maxSharedCacheSizeMB: number;

  /** Whether to sync worktree caches back to shared on successful merge */
  syncOnMerge: boolean;
}

/**
 * Default cache isolation configuration.
 */
export const DEFAULT_CACHE_ISOLATION_CONFIG: CacheIsolationConfig = {
  sharedCachePath: '.ralph-tui/shared-cache',
  worktreeCacheBasePath: '.worktrees',
  copyOnWrite: true,
  maxSharedCacheSizeMB: 1024,
  syncOnMerge: true,
};

/**
 * Configuration for the Resource Lock Manager.
 */
export interface ResourceLockManagerConfig {
  /** Default lock timeout in milliseconds (default: 30000) */
  defaultLockTimeoutMs: number;

  /** Maximum locks per agent (default: 10) */
  maxLocksPerAgent: number;

  /** Interval for checking expired locks in milliseconds (default: 5000) */
  lockCheckIntervalMs: number;

  /** Whether to enable deadlock detection (default: true) */
  enableDeadlockDetection: boolean;

  /** Maximum wait queue size per resource (default: 50) */
  maxWaitQueueSize: number;

  /** Cache isolation configuration */
  cacheIsolation: CacheIsolationConfig;
}

/**
 * Default configuration for the Resource Lock Manager.
 */
export const DEFAULT_RESOURCE_LOCK_MANAGER_CONFIG: ResourceLockManagerConfig = {
  defaultLockTimeoutMs: 30000,
  maxLocksPerAgent: 10,
  lockCheckIntervalMs: 5000,
  enableDeadlockDetection: true,
  maxWaitQueueSize: 50,
  cacheIsolation: DEFAULT_CACHE_ISOLATION_CONFIG,
};

/**
 * Events emitted by the Resource Lock Manager.
 */
export type ResourceLockEvent =
  | { type: 'lock_acquired'; lock: ResourceLock }
  | { type: 'lock_released'; lock: ResourceLock }
  | { type: 'lock_expired'; lock: ResourceLock }
  | { type: 'lock_wait_started'; agentId: string; resourceName: string; mode: LockMode }
  | { type: 'lock_wait_timeout'; agentId: string; resourceName: string }
  | { type: 'deadlock_detected'; cycle: string[] }
  | { type: 'resources_exhausted'; blockedAgents: string[]; heldResources: string[] }
  | { type: 'worktree_creation_paused'; reason: string };

/**
 * Callback type for Resource Lock Manager event listeners.
 */
export type ResourceLockEventListener = (event: ResourceLockEvent) => void;

/**
 * Statistics about the Resource Lock Manager's current state.
 */
export interface ResourceLockManagerStats {
  /** Total number of active locks */
  activeLocks: number;

  /** Number of locks by mode */
  locksByMode: Record<LockMode, number>;

  /** Number of locks by category */
  locksByCategory: Record<ResourceCategory, number>;

  /** Total pending requests in wait queues */
  pendingRequests: number;

  /** Number of locks that have expired */
  expiredLocks: number;

  /** Number of deadlocks detected since start */
  deadlocksDetected: number;

  /** Agents with most locks held */
  topLockHolders: { agentId: string; count: number }[];

  /** Most contested resources */
  mostContestedResources: { resourceName: string; waitQueueSize: number }[];

  /** Timestamp when the manager was started */
  startedAt: Date;
}

/**
 * Worktree cache state for isolation tracking.
 */
export interface WorktreeCacheState {
  /** Worktree ID */
  worktreeId: string;

  /** Path to worktree-specific cache */
  cachePath: string;

  /** Whether cache has been initialized from shared cache */
  initialized: boolean;

  /** Resources modified in this worktree's cache */
  modifiedResources: string[];

  /** Timestamp of last modification */
  lastModifiedAt?: Date;

  /** Size of worktree cache in bytes */
  sizeBytes: number;
}
