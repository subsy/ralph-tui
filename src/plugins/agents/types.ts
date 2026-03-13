/**
 * ABOUTME: Type definitions for the agent plugin system.
 * Defines interfaces and types for AI agent CLI integrations
 * (Claude Code, OpenCode, Cursor, etc.)
 */

import type { SandboxConfig } from '../../sandbox/types.js';
import type { FormattedSegment } from './output-formatting.js';

/**
 * Result of detecting whether an agent CLI is available.
 */
export interface AgentDetectResult {
  /** Whether the agent CLI is available and functional */
  available: boolean;

  /** Version of the agent CLI if detected */
  version?: string;

  /** Path to the agent executable if found */
  executablePath?: string;

  /** Error message if detection failed */
  error?: string;
}

/**
 * Result of a preflight check to verify the agent is fully operational.
 * Preflight goes beyond detection by actually running a test prompt.
 */
export interface AgentPreflightResult {
  /** Whether the agent successfully responded to a test prompt */
  success: boolean;

  /** Error message if preflight failed */
  error?: string;

  /** Helpful suggestion for resolving the issue */
  suggestion?: string;

  /** How long the preflight check took in milliseconds */
  durationMs?: number;

  /** Exit code from the preflight execution (for diagnostics) */
  exitCode?: number;

  /** Stderr output from the preflight execution (for diagnostics) */
  stderr?: string;

  /** Stdout output from the preflight execution (for diagnostics) */
  stdout?: string;
}

/**
 * File context to pass to the agent for execution.
 */
export interface AgentFileContext {
  /** Absolute path to the file */
  path: string;

  /** Optional line number to focus on */
  line?: number;

  /** Optional column number */
  column?: number;

  /** Optional selection range (start line, end line) */
  selection?: [number, number];
}

/**
 * Status of an agent execution.
 */
export type AgentExecutionStatus =
  | 'running'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'timeout';

/**
 * Result of executing an agent with a prompt.
 */
export interface AgentExecutionResult {
  /** Unique identifier for this execution */
  executionId: string;

  /** Status of the execution */
  status: AgentExecutionStatus;

  /** Exit code of the agent process (if completed) */
  exitCode?: number;

  /** Standard output from the agent */
  stdout: string;

  /** Standard error from the agent */
  stderr: string;

  /** Duration of execution in milliseconds */
  durationMs: number;

  /** Error message if execution failed */
  error?: string;

  /** Whether the execution was interrupted by user */
  interrupted: boolean;

  /** Timestamp when execution started (ISO 8601) */
  startedAt: string;

  /** Timestamp when execution ended (ISO 8601) */
  endedAt: string;
}

/**
 * Options for agent execution.
 */
export interface AgentExecuteOptions {
  /** Working directory for the agent process */
  cwd?: string;

  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;

  /** Environment variables to pass to the agent */
  env?: Record<string, string>;

  /** Additional CLI flags to pass to the agent */
  flags?: string[];

  sandbox?: SandboxConfig;

  /** Callback for streaming stdout (legacy string format) */
  onStdout?: (data: string) => void;

  /** Callback for streaming stdout as TUI-native segments */
  onStdoutSegments?: (segments: FormattedSegment[]) => void;

  /** Callback for streaming stderr */
  onStderr?: (data: string) => void;

  /** Callback when execution starts */
  onStart?: (executionId: string) => void;

  /** Callback when execution ends */
  onEnd?: (result: AgentExecutionResult) => void;

  /** Enable subagent tracing for structured output (JSONL format for Claude) */
  subagentTracing?: boolean;

  /**
   * Callback for raw JSONL messages parsed by the agent.
   * Used by the engine to track subagent activity without re-parsing output.
   * The message object is the raw parsed JSON from the agent's JSONL output.
   */
  onJsonlMessage?: (message: Record<string, unknown>) => void;
}

/**
 * A setup question for configuring an agent plugin.
 */
export interface AgentSetupQuestion {
  /** Unique identifier for this question */
  id: string;

  /** The question prompt to display */
  prompt: string;

  /** Type of input expected */
  type: 'text' | 'password' | 'boolean' | 'select' | 'path';

  /** Available choices for select type */
  choices?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;

  /** Default value if user doesn't provide one */
  default?: string | boolean;

  /** Whether this question is required */
  required?: boolean;

  /** Validation pattern (regex) for text inputs */
  pattern?: string;

  /** Help text to display alongside the question */
  help?: string;
}

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
 * Configuration for an agent plugin instance.
 * Stored in YAML config files.
 */
export interface AgentPluginConfig {
  /** Unique name for this agent instance */
  name: string;

  /** Plugin type identifier (e.g., 'claude', 'opencode') */
  plugin: string;

  /** Whether this is the default agent */
  default?: boolean;

  /** Path to the agent executable (overrides auto-detection) */
  command?: string;

  /** Default CLI flags to pass to the agent */
  defaultFlags?: string[];

  /** Default timeout in milliseconds */
  timeout?: number;

  /** Plugin-specific configuration options */
  options: Record<string, unknown>;

  /**
   * Ordered list of fallback agent names to use when this agent hits rate limits.
   * Names refer to other configured agent names or plugin IDs.
   * Order determines priority (first fallback tried first).
   */
  fallbackAgents?: string[];

  /** Rate limit handling configuration for this agent */
  rateLimitHandling?: RateLimitHandlingConfig;

  /**
   * Environment variables to exclude when spawning the agent process.
   * Use this to prevent sensitive keys from being inherited by the agent.
   * Supports exact names (e.g., "ANTHROPIC_API_KEY") or glob patterns (e.g., "*_API_KEY").
   *
   * @example ["ANTHROPIC_API_KEY"] - Exclude specific key
   * @example ["*_API_KEY", "*_SECRET"] - Exclude all API keys and secrets
   */
  envExclude?: string[];

  /**
   * Environment variables to pass through despite matching default exclusion patterns.
   * Use this to explicitly allow specific keys that are blocked by the built-in
   * defaults (*_API_KEY, *_SECRET_KEY, *_SECRET).
   * Supports exact names (e.g., "ANTHROPIC_API_KEY") or glob patterns.
   *
   * @example ["ANTHROPIC_API_KEY"] - Allow this specific key through
   * @example ["MY_*"] - Allow all MY_* vars through even if they match *_API_KEY
   */
  envPassthrough?: string[];
}

export interface AgentSandboxRequirements {
  authPaths: string[];
  binaryPaths: string[];
  runtimePaths: string[];
  requiresNetwork: boolean;
}

/**
 * Paths where an agent stores skills/plugins.
 * Each agent has its own conventions for where skills are installed.
 */
export interface AgentSkillsPaths {
  /**
   * Personal/global skills directory (e.g., ~/.claude/skills/).
   * Skills installed here are available across all projects.
   * Path may use ~ for home directory.
   */
  personal: string;

  /**
   * Repository-local skills directory (e.g., .claude/skills/).
   * Relative path from project root.
   * Skills installed here are only available in the specific project.
   */
  repo: string;
}

/**
 * Metadata about an agent plugin.
 */
export interface AgentPluginMeta {
  /** Unique identifier for the plugin */
  id: string;

  /** Human-readable name */
  name: string;

  /** Short description of the plugin */
  description: string;

  /** Plugin version */
  version: string;

  /** Plugin author */
  author?: string;

  /** Default command name for the agent CLI */
  defaultCommand: string;

  /** Optional alternate command names used for auto-detection */
  commandAliases?: string[];

  /** Whether the agent supports streaming output */
  supportsStreaming: boolean;

  /** Whether the agent supports interruption */
  supportsInterrupt: boolean;

  /** Whether the agent supports file context */
  supportsFileContext: boolean;

  /** Whether the agent supports subagent tracing (structured output for tracking spawned subagents) */
  supportsSubagentTracing: boolean;

  /** Format of structured output when supportsSubagentTracing is true */
  structuredOutputFormat?: 'json' | 'jsonl';

  /**
   * Paths where this agent stores skills.
   * If undefined, the agent does not support skill installation.
   */
  skillsPaths?: AgentSkillsPaths;

}

/**
 * Handle to a running agent execution for control.
 */
export interface AgentExecutionHandle {
  /** Unique identifier for this execution */
  executionId: string;

  /** Promise that resolves when execution completes */
  promise: Promise<AgentExecutionResult>;

  /** Interrupt the running execution */
  interrupt(): void;

  /** Check if the execution is still running */
  isRunning(): boolean;
}

/**
 * The main agent plugin interface that all plugins must implement.
 * Provides methods for detecting, executing, and controlling AI agents.
 */
export interface AgentPlugin {
  /** Metadata about this plugin */
  readonly meta: AgentPluginMeta;

  /**
   * Initialize the plugin with configuration.
   * Called once when the plugin is loaded.
   * @param config Plugin-specific configuration options
   */
  initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Check if the plugin is properly configured and ready to use.
   * @returns true if the plugin is ready, false otherwise
   */
  isReady(): Promise<boolean>;

  /**
   * Detect if the agent CLI is available on the system.
   * Checks for the executable in PATH or at configured location.
   * @returns Detection result with availability and version info
   */
  detect(): Promise<AgentDetectResult>;

  getSandboxRequirements(): AgentSandboxRequirements;

  /**
   * Execute the agent with a prompt and optional file context.
   * @param prompt The prompt/instruction to send to the agent
   * @param files Optional file context to pass to the agent
   * @param options Execution options (timeout, env, callbacks)
   * @returns Handle to the running execution
   */
  execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle;

  /**
   * Interrupt a running execution.
   * @param executionId The execution ID to interrupt
   * @returns true if the execution was interrupted, false if not found
   */
  interrupt(executionId: string): boolean;

  /**
   * Interrupt all running executions.
   */
  interruptAll(): void;

  /**
   * Get the current execution if any.
   * @returns The current execution handle or undefined
   */
  getCurrentExecution(): AgentExecutionHandle | undefined;

  /**
   * Get setup questions for configuring this plugin.
   * Used by the setup wizard to collect configuration.
   * @returns Array of questions to ask during setup
   */
  getSetupQuestions(): AgentSetupQuestion[];

  /**
   * Validate configuration answers before saving.
   * @param answers User's answers to setup questions
   * @returns null if valid, or an error message string if invalid
   */
  validateSetup(answers: Record<string, unknown>): Promise<string | null>;

  /**
   * Validate a model name for this agent.
   * Called when --model CLI flag is provided to check compatibility.
   * @param model The model name to validate (may be empty string)
   * @returns null if valid, or an error message string if invalid
   */
  validateModel(model: string): string | null;

  /**
   * Run a preflight check to verify the agent is fully operational.
   * This goes beyond detect() by actually running a minimal test prompt
   * to verify the agent can process requests (e.g., has a valid model configured).
   *
   * @param options Optional configuration for the preflight check
   * @returns Preflight result with success status and any error/suggestion
   */
  preflight(options?: { timeout?: number }): Promise<AgentPreflightResult>;

  /**
   * Clean up resources when the plugin is unloaded.
   * Called when Ralph TUI shuts down. Should interrupt any running executions.
   */
  dispose(): Promise<void>;
}

/**
 * Factory function type for creating agent plugin instances.
 * Plugins export this function as their default export.
 */
export type AgentPluginFactory = () => AgentPlugin;
