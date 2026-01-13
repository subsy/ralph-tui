/**
 * ABOUTME: Type definitions for Ralph TUI configuration.
 * Defines the structure of configuration files and runtime options.
 */

import type { AgentPluginConfig } from '../plugins/agents/types.js';
import type { TrackerPluginConfig } from '../plugins/trackers/types.js';
import type { ErrorHandlingConfig, ErrorHandlingStrategy } from '../engine/types.js';
import type { BroadcastConfig } from '../worktree/broadcast-types.js';

/**
 * Rate limit handling configuration for agents.
 * Controls how ralph-tui responds when an agent hits API rate limits.
 */
export interface RateLimitHandlingConfig {
  /** Whether rate limit handling is enabled (default: true) */
  enabled?: boolean;

  /** Maximum retries before switching to fallback agent (default: 3) */
  maxRetries?: number;

  /** Base backoff time in milliseconds for exponential retry (default: 5000) */
  baseBackoffMs?: number;

  /** Whether to attempt switching back to primary agent between iterations (default: true) */
  recoverPrimaryBetweenIterations?: boolean;
}

/**
 * Default rate limit handling configuration
 */
export const DEFAULT_RATE_LIMIT_HANDLING: Required<RateLimitHandlingConfig> = {
  enabled: true,
  maxRetries: 3,
  baseBackoffMs: 5000,
  recoverPrimaryBetweenIterations: true,
};

/**
 * Subagent tracing detail level controls how much subagent information is displayed.
 * - 'off': No tracing, use raw output (current default behavior)
 * - 'minimal': Show start/complete events only
 * - 'moderate': Show events + description + duration
 * - 'full': Show events + nested output + hierarchy panel
 */
export type SubagentDetailLevel = 'off' | 'minimal' | 'moderate' | 'full';

/**
 * Resource limits configuration for parallel worktree execution.
 */
export interface ResourceLimitsConfig {
  /** Minimum free memory in MB before spawning new worktrees (default: 1024) */
  minFreeMemoryMB?: number;
  /** Maximum CPU utilization percentage before throttling spawns (default: 80) */
  maxCpuUtilization?: number;
}

/**
 * AI-powered conflict resolution configuration.
 * Controls how merge conflicts are handled during parallel worktree merges.
 */
export interface ConflictResolutionConfig {
  /** Whether to attempt AI-powered auto-resolution for merge conflicts (default: true) */
  autoResolve?: boolean;
  /** Confidence threshold (0.0-1.0) above which AI resolution is accepted (default: 0.8) */
  confidenceThreshold?: number;
  /** Maximum number of files to attempt AI resolution on per conflict (default: 10) */
  maxFilesPerConflict?: number;
  /** Timeout in milliseconds for AI resolution per file (default: 30000) */
  resolutionTimeoutMs?: number;
}

/**
 * Default conflict resolution configuration.
 */
export const DEFAULT_CONFLICT_RESOLUTION_CONFIG: Required<ConflictResolutionConfig> = {
  autoResolve: true,
  confidenceThreshold: 0.8,
  maxFilesPerConflict: 10,
  resolutionTimeoutMs: 30000,
};

/**
 * Parallel execution configuration.
 * Controls auto-parallelization of tasks using git worktrees.
 */
export interface ParallelConfig {
  /** Whether auto-parallelization is enabled (default: true) */
  enabled?: boolean;
  /** Maximum number of concurrent worktrees (default: 4) */
  maxWorktrees?: number;
  /** Resource limits for spawning worktrees */
  resourceLimits?: ResourceLimitsConfig;
  /** Directory where worktrees are created (default: '.worktrees') */
  worktreeDir?: string;
  /** Whether to automatically clean up worktrees after successful merge (default: true) */
  autoCleanup?: boolean;
  /** Prefix for backup branches created during parallel execution (default: 'backup/') */
  backupBranchPrefix?: string;
}

/**
 * Default parallel configuration.
 */
export const DEFAULT_PARALLEL_CONFIG: Required<ParallelConfig> = {
  enabled: true,
  maxWorktrees: 4,
  resourceLimits: {
    minFreeMemoryMB: 1024,
    maxCpuUtilization: 80,
  },
  worktreeDir: '.worktrees',
  autoCleanup: true,
  backupBranchPrefix: 'backup/',
};

/**
 * Sound mode for notifications.
 * - 'off': No sound (default)
 * - 'system': Use OS default notification sound
 * - 'ralph': Play random Ralph Wiggum sound clips
 */
export type NotificationSoundMode = 'off' | 'system' | 'ralph';

/**
 * Notifications configuration for desktop notifications.
 */
export interface NotificationsConfig {
  /** Whether desktop notifications are enabled (default: true) */
  enabled?: boolean;
  /** Sound mode for notifications (default: 'off') */
  sound?: NotificationSoundMode;
}

/**
 * Runtime options that can be passed via CLI flags
 */
export interface RuntimeOptions {
  /** Override agent plugin */
  agent?: string;

  /** Override model for the agent */
  model?: string;

  /** Override tracker plugin */
  tracker?: string;

  /** Epic ID for beads-based trackers */
  epicId?: string;

  /** PRD file path for json tracker */
  prdPath?: string;

  /** Maximum iterations to run */
  iterations?: number;

  /** Delay between iterations in milliseconds */
  iterationDelay?: number;

  /** Working directory for execution */
  cwd?: string;

  /** Whether to resume existing session */
  resume?: boolean;

  /** Force start even if lock exists */
  force?: boolean;

  /** Run in headless mode (no TUI) */
  headless?: boolean;

  /** Error handling strategy override */
  onError?: ErrorHandlingStrategy;

  /** Maximum retries for error handling */
  maxRetries?: number;

  /** Custom prompt file path (overrides config and defaults) */
  promptPath?: string;

  /** Output directory for iteration logs (overrides config) */
  outputDir?: string;

  /** Progress file path for cross-iteration context */
  progressFile?: string;

  /** Override notifications enabled state (--notify or --no-notify CLI flags) */
  notify?: boolean;

  /** Override parallel enabled state (--no-parallel CLI flag) */
  noParallel?: boolean;
}

/**
 * Stored configuration (from YAML config file)
 */
export interface StoredConfig {
  /** Default agent to use */
  defaultAgent?: string;

  /** Default tracker to use */
  defaultTracker?: string;

  /** Default maximum iterations */
  maxIterations?: number;

  /** Default iteration delay in milliseconds */
  iterationDelay?: number;

  /** Configured agent plugins */
  agents?: AgentPluginConfig[];

  /** Configured tracker plugins */
  trackers?: TrackerPluginConfig[];

  /** Output directory for iteration logs */
  outputDir?: string;

  /** Progress file path for cross-iteration context */
  progressFile?: string;

  /** Error handling configuration */
  errorHandling?: Partial<ErrorHandlingConfig>;

  /** Shorthand: agent plugin name */
  agent?: string;

  /** Shorthand: tracker plugin name */
  tracker?: string;

  /** Shorthand: agent-specific options */
  agentOptions?: Record<string, unknown>;

  /** Shorthand: tracker-specific options */
  trackerOptions?: Record<string, unknown>;

  /**
   * Shorthand: fallback agents for the default agent.
   * Ordered list of agent names/plugins to try when the primary agent hits rate limits.
   */
  fallbackAgents?: string[];

  /** Shorthand: rate limit handling configuration for the default agent */
  rateLimitHandling?: RateLimitHandlingConfig;

  /** Whether to auto-commit after successful tasks */
  autoCommit?: boolean;

  /** Custom prompt template path (relative to cwd or absolute) */
  prompt_template?: string;

  /** Subagent tracing detail level for controlling display verbosity */
  subagentTracingDetail?: SubagentDetailLevel;

  /** Notifications configuration */
  notifications?: NotificationsConfig;

  /** Parallel execution configuration */
  parallel?: ParallelConfig;

  /** AI-powered conflict resolution configuration */
  conflictResolution?: ConflictResolutionConfig;

  /** Agent broadcast system configuration */
  broadcast?: Partial<BroadcastConfig>;
}

/**
 * Merged runtime configuration (stored config + CLI options)
 */
export interface RalphConfig {
  /** Active agent configuration */
  agent: AgentPluginConfig;

  /** Active tracker configuration */
  tracker: TrackerPluginConfig;

  /** Maximum iterations (0 = unlimited) */
  maxIterations: number;

  /** Delay between iterations in milliseconds */
  iterationDelay: number;

  /** Working directory */
  cwd: string;

  /** Output directory for iteration logs */
  outputDir: string;

  /** Progress file path for cross-iteration context */
  progressFile: string;

  /** Epic ID (for beads trackers) */
  epicId?: string;

  /** PRD path (for json tracker) */
  prdPath?: string;

  /** Model override for agent */
  model?: string;

  /** Whether to show TUI */
  showTui: boolean;

  /** Error handling configuration */
  errorHandling: ErrorHandlingConfig;

  /** Custom prompt template path (resolved) */
  promptTemplate?: string;
}

/**
 * Validation result for configuration
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;

  /** Error messages if invalid */
  errors: string[];

  /** Warning messages (non-fatal) */
  warnings: string[];
}

/**
 * Default error handling configuration
 */
export const DEFAULT_ERROR_HANDLING: ErrorHandlingConfig = {
  strategy: 'skip',
  maxRetries: 3,
  retryDelayMs: 5000,
  continueOnNonZeroExit: false,
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Omit<RalphConfig, 'agent' | 'tracker'> = {
  maxIterations: 10,
  iterationDelay: 1000,
  cwd: process.cwd(),
  outputDir: '.ralph-tui/iterations',
  progressFile: '.ralph-tui/progress.md',
  showTui: true,
  errorHandling: DEFAULT_ERROR_HANDLING,
};
