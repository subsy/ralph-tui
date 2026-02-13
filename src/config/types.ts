/**
 * ABOUTME: Type definitions for Ralph TUI configuration.
 * Defines the structure of configuration files and runtime options.
 */

import type { AgentPluginConfig } from "../plugins/agents/types.js";
import type { TrackerPluginConfig } from "../plugins/trackers/types.js";
import type {
  ErrorHandlingConfig,
  ErrorHandlingStrategy,
} from "../engine/types.js";

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
export type SubagentDetailLevel = "off" | "minimal" | "moderate" | "full";

/**
 * Sound mode for notifications.
 * - 'off': No sound (default)
 * - 'system': Use OS default notification sound
 * - 'ralph': Play random Ralph Wiggum sound clips
 */
export type NotificationSoundMode = "off" | "system" | "ralph";

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
 * Image cleanup policy for attached images.
 * - 'on_exit': Clean up images when ralph-tui exits (default)
 * - 'manual': Keep images until manually deleted
 * - 'never': Never clean up images automatically
 */
export type ImageCleanupPolicy = "on_exit" | "manual" | "never";

/**
 * Image attachment configuration.
 */
export interface ImageConfig {
  /** Whether image attachments are enabled (default: true) */
  enabled?: boolean;
  /** Cleanup policy for attached images (default: 'on_exit') */
  cleanup_policy?: ImageCleanupPolicy;
  /** Skip confirmation prompt when cleaning up images (default: false) */
  skip_cleanup_confirmation?: boolean;
  /** Maximum images allowed per message (default: 10, 0 = unlimited) */
  max_images_per_message?: number;
  /** Show hint about image paste on first text paste of session (default: true) */
  show_paste_hints?: boolean;
}

/**
 * Default image configuration
 */
export const DEFAULT_IMAGE_CONFIG: Required<ImageConfig> = {
  enabled: true,
  cleanup_policy: "on_exit",
  skip_cleanup_confirmation: false,
  max_images_per_message: 10,
  show_paste_hints: true,
};

export type SandboxMode = "auto" | "bwrap" | "sandbox-exec" | "off";

export interface SandboxConfig {
  enabled?: boolean;
  mode?: SandboxMode;
  network?: boolean;
  allowPaths?: string[];
  readOnlyPaths?: string[];
}

export const DEFAULT_SANDBOX_CONFIG: Required<
  Pick<SandboxConfig, "enabled" | "mode" | "network">
> = {
  enabled: false,
  mode: "auto",
  network: true,
};

/**
 * Configuration for parallel execution behavior.
 */
export interface ParallelConfig {
  /** Execution mode: 'auto' analyzes dependencies, 'always' forces parallel, 'never' disables */
  mode?: 'auto' | 'always' | 'never';

  /** Maximum concurrent workers (default: 3) */
  maxWorkers?: number;

  /** Directory for git worktrees relative to project root (default: '.ralph-tui/worktrees') */
  worktreeDir?: string;

  /**
   * Merge directly to the current branch instead of creating a session branch.
   * When false (default), a session branch `ralph-session/{shortId}` is created
   * and all worker changes are merged there. When true, uses the legacy behavior
   * of merging directly to the current branch.
   */
  directMerge?: boolean;
}

/**
 * Configuration for AI-powered conflict resolution during parallel execution.
 */
export interface ConflictResolutionConfig {
  /** Whether to attempt AI resolution for merge conflicts (default: true) */
  enabled?: boolean;

  /** Timeout in milliseconds for AI resolution per file (default: 120000) */
  timeoutMs?: number;

  /** Maximum files to attempt AI resolution on per conflict (default: 10) */
  maxFiles?: number;
}

/**
 * Runtime options that can be passed via CLI flags
 */
export interface RuntimeOptions {
  /** Override agent plugin */
  agent?: string;

  /** Override model for the agent */
  model?: string;

  /** Override model variant for the agent (e.g., minimal, high, max for Gemini) */
  variant?: string;

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

  sandbox?: SandboxConfig;

  /** Path to custom JSON theme file (absolute or relative to cwd) */
  themePath?: string;

  /** Force sequential execution (--serial or --sequential) */
  serial?: boolean;

  /** Enable parallel execution, optionally with worker count (--parallel [N]) */
  parallel?: number | boolean;
}

/**
 * Stored configuration (from YAML config file)
 */
export interface StoredConfig {
  /** Config version for migrations (e.g., "2.0") */
  configVersion?: string;

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

  sandbox?: SandboxConfig;

  /** Shorthand: agent plugin name */
  agent?: string;

  /** Legacy alias: agent command name */
  agentCommand?: string;

  /**
   * Custom command/executable path for the agent.
   *
   * Use this to route agent requests through wrapper tools like Claude Code Router (CCR)
   * or to specify a custom binary location.
   *
   * Precedence (highest to lowest):
   * 1. Agent-specific: [[agents]] command field
   * 2. Top-level: this field
   * 3. Plugin default: e.g., "claude" for Claude plugin
   *
   * @example "ccr code" - Route through Claude Code Router
   * @example "/opt/bin/my-claude" - Absolute path to custom binary
   */
  command?: string;

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

  /**
   * Shorthand: environment variables to exclude for the default agent.
   * Use this to prevent sensitive keys from being inherited by agent processes.
   * Supports exact names (e.g., "ANTHROPIC_API_KEY") or glob patterns (e.g., "*_API_KEY").
   */
  envExclude?: string[];

  /**
   * Shorthand: environment variables to pass through despite matching default exclusion patterns.
   * Use this to explicitly allow specific keys that are blocked by built-in defaults.
   * Supports exact names (e.g., "ANTHROPIC_API_KEY") or glob patterns.
   */
  envPassthrough?: string[];

  /** Whether to auto-commit after successful tasks */
  autoCommit?: boolean;

  /** Custom prompt template path (relative to cwd or absolute) */
  prompt_template?: string;

  skills_dir?: string;

  /** Subagent tracing detail level for controlling display verbosity */
  subagentTracingDetail?: SubagentDetailLevel;

  /** Notifications configuration */
  notifications?: NotificationsConfig;

  /** Image attachment configuration */
  images?: ImageConfig;

  /** Parallel execution configuration */
  parallel?: ParallelConfig;

  /** Conflict resolution configuration for parallel execution */
  conflictResolution?: ConflictResolutionConfig;
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

  sandbox?: SandboxConfig;

  /** Custom prompt template path (resolved) */
  promptTemplate?: string;

  /** Session ID for log file naming and tracking */
  sessionId?: string;

  /** Whether to auto-commit after successful task completion (default: false) */
  autoCommit?: boolean;

  /**
   * Optional list of task IDs to execute. When provided, only tasks with these
   * IDs will be executed, filtering out any others returned by the tracker.
   * Used for --task-range filtering.
   */
  filteredTaskIds?: string[];

  /** Conflict resolution configuration for parallel execution */
  conflictResolution?: ConflictResolutionConfig;
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
  strategy: "skip",
  maxRetries: 3,
  retryDelayMs: 5000,
  continueOnNonZeroExit: false,
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Omit<RalphConfig, "agent" | "tracker"> = {
  maxIterations: 10,
  iterationDelay: 1000,
  cwd: process.cwd(),
  outputDir: ".ralph-tui/iterations",
  progressFile: ".ralph-tui/progress.md",
  showTui: true,
  errorHandling: DEFAULT_ERROR_HANDLING,
  sandbox: DEFAULT_SANDBOX_CONFIG,
};
