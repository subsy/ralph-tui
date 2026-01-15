/**
 * ABOUTME: Type definitions for the Worktree Pool Manager.
 * Defines configuration and state interfaces for git worktree management
 * with resource-aware spawning to prevent system resource exhaustion.
 */

/**
 * Configuration for the worktree pool manager.
 * Controls pool size limits and resource thresholds.
 */
export interface WorktreePoolConfig {
  /** Maximum number of concurrent worktrees (default: 4) */
  maxWorktrees: number;

  /** Minimum free memory in MB before spawning new worktrees (default: 1024) */
  minFreeMemoryMB: number;

  /** Maximum CPU utilization percentage before throttling spawns (default: 80) */
  maxCpuUtilization: number;

  /** Directory where worktrees are created (default: '.worktrees') */
  worktreeDir: string;

  /** Whether to automatically clean up worktrees after successful merge (default: true) */
  cleanupOnSuccess: boolean;
}

/**
 * Default configuration for the worktree pool.
 */
export const DEFAULT_WORKTREE_POOL_CONFIG: WorktreePoolConfig = {
  maxWorktrees: 4,
  minFreeMemoryMB: 1024,
  maxCpuUtilization: 80,
  worktreeDir: '.worktrees',
  cleanupOnSuccess: true,
};

/**
 * Current status of a worktree in the pool.
 */
export type WorktreeStatus =
  | 'creating'
  | 'ready'
  | 'in_use'
  | 'merging'
  | 'cleaning'
  | 'error';

/**
 * Represents a managed git worktree in the pool.
 */
export interface ManagedWorktree {
  /** Unique identifier for this worktree */
  id: string;

  /** Descriptive name (e.g., 'feature-auth-agent-1') */
  name: string;

  /** Absolute path to the worktree directory */
  path: string;

  /** Git branch name associated with this worktree */
  branch: string;

  /** Current status of the worktree */
  status: WorktreeStatus;

  /** Timestamp when the worktree was created */
  createdAt: Date;

  /** Timestamp of last activity */
  lastActivityAt: Date;

  /** Task ID if this worktree is assigned to a task */
  taskId?: string;

  /** Agent ID if this worktree is assigned to an agent */
  agentId?: string;
}

/**
 * System resource snapshot for resource-aware decisions.
 */
export interface SystemResources {
  /** Total system memory in MB */
  totalMemoryMB: number;

  /** Free/available memory in MB */
  freeMemoryMB: number;

  /** Current CPU utilization percentage (0-100) */
  cpuUtilization: number;

  /** Number of CPU cores available */
  cpuCores: number;

  /** Timestamp of this resource snapshot */
  timestamp: Date;
}

/**
 * Result of attempting to acquire a worktree from the pool.
 */
export type WorktreeAcquisitionResult =
  | { success: true; worktree: ManagedWorktree }
  | { success: false; reason: WorktreeAcquisitionFailureReason };

/**
 * Reasons why worktree acquisition might fail.
 */
export type WorktreeAcquisitionFailureReason =
  | 'pool_exhausted'
  | 'insufficient_memory'
  | 'high_cpu_utilization'
  | 'git_error'
  | 'filesystem_error';

/**
 * Events emitted by the worktree pool manager.
 */
export type WorktreePoolEvent =
  | { type: 'worktree_created'; worktree: ManagedWorktree }
  | { type: 'worktree_acquired'; worktree: ManagedWorktree; taskId?: string }
  | { type: 'worktree_released'; worktree: ManagedWorktree }
  | { type: 'worktree_cleaned'; worktree: ManagedWorktree }
  | { type: 'worktree_error'; worktree: ManagedWorktree; error: Error }
  | { type: 'resource_warning'; resources: SystemResources; threshold: string }
  | { type: 'pool_exhausted'; activeCount: number; maxWorktrees: number };

/**
 * Callback type for worktree pool event listeners.
 */
export type WorktreePoolEventListener = (event: WorktreePoolEvent) => void;

/**
 * Options for creating a new worktree.
 */
export interface WorktreeCreateOptions {
  /** Base name for the worktree (will be suffixed with agent ID) */
  baseName: string;

  /** Branch to create (if not provided, creates from current HEAD) */
  branch?: string;

  /** Base branch to create from (default: current branch) */
  baseBranch?: string;

  /** Task ID to associate with this worktree */
  taskId?: string;

  /** Agent ID to associate with this worktree */
  agentId?: string;
}

/**
 * Options for cleaning up worktrees.
 */
export interface WorktreeCleanupOptions {
  /** Force cleanup even if worktree has uncommitted changes */
  force?: boolean;

  /** Delete the associated branch */
  deleteBranch?: boolean;

  /** Merge the branch before cleanup */
  mergeBefore?: boolean;

  /** Target branch for merge (default: main or master) */
  mergeTarget?: string;
}
