/**
 * ABOUTME: Type definitions for the ralph-tui remote listener feature.
 * Defines configuration, authentication tokens, and WebSocket message types.
 */

/**
 * Server token stored in ~/.config/ralph-tui/remote.json
 * Long-lived (default 90 days), used to authenticate and obtain connection tokens.
 */
export interface ServerToken {
  /** The server token value */
  value: string;

  /** When the token was created (ISO 8601) */
  createdAt: string;

  /** When the token expires (ISO 8601) */
  expiresAt: string;

  /** Token version for tracking rotation */
  version: number;
}

/**
 * Connection token issued to authenticated clients.
 * Short-lived (default 24 hours), auto-refreshed while connected.
 */
export interface ConnectionToken {
  /** The connection token value */
  value: string;

  /** When the token was created (ISO 8601) */
  createdAt: string;

  /** When the token expires (ISO 8601) */
  expiresAt: string;

  /** Client identifier this token was issued to */
  clientId: string;
}

/**
 * Remote listener configuration stored in ~/.config/ralph-tui/remote.json
 */
export interface RemoteConfig {
  /** Server authentication token (long-lived, 90 days default) */
  serverToken: ServerToken;

  // Legacy fields for backwards compatibility (will be migrated)
  /** @deprecated Use serverToken.value instead */
  token?: string;
  /** @deprecated Use serverToken.createdAt instead */
  tokenCreatedAt?: string;
  /** @deprecated Use serverToken.version instead */
  tokenVersion?: number;
}

/**
 * Token lifetime configuration
 */
export const TOKEN_LIFETIMES = {
  /** Server token lifetime in days (90 days default) */
  SERVER_TOKEN_DAYS: 90,
  /** Connection token lifetime in hours (24 hours default) */
  CONNECTION_TOKEN_HOURS: 24,
  /** Token refresh threshold - refresh when less than this many hours remain */
  REFRESH_THRESHOLD_HOURS: 1,
} as const;

/**
 * Options for the listen command
 */
export interface ListenOptions {
  /** Port to bind to (default: 7890) */
  port: number;

  /** Run as a background daemon */
  daemon: boolean;

  /** Rotate the authentication token */
  rotateToken: boolean;
}

/**
 * Default listen options
 */
export const DEFAULT_LISTEN_OPTIONS: ListenOptions = {
  port: 7890,
  daemon: false,
  rotateToken: false,
};

/**
 * WebSocket message base type
 */
export interface WSMessage {
  /** Message type identifier */
  type: string;

  /** Unique message ID for request/response correlation */
  id: string;

  /** Timestamp of the message (ISO 8601) */
  timestamp: string;
}

/**
 * Authentication request sent by client.
 * Supports both server token (initial auth) and connection token (re-auth).
 */
export interface AuthMessage extends WSMessage {
  type: 'auth';
  /** Token value (either server token or connection token) */
  token: string;
  /** Token type: 'server' for initial auth, 'connection' for re-auth */
  tokenType?: 'server' | 'connection';
}

/**
 * Authentication response sent by server.
 * On successful auth with server token, includes a connection token.
 */
export interface AuthResponseMessage extends WSMessage {
  type: 'auth_response';
  success: boolean;
  error?: string;
  /** Connection token issued on successful server token auth */
  connectionToken?: string;
  /** When the connection token expires (ISO 8601) */
  connectionTokenExpiresAt?: string;
}

/**
 * Token refresh request sent by client.
 * Client should request refresh when connection token is near expiration.
 */
export interface TokenRefreshMessage extends WSMessage {
  type: 'token_refresh';
  /** Current connection token (for validation) */
  connectionToken: string;
}

/**
 * Token refresh response sent by server.
 * Issues a new connection token if the current one is still valid.
 */
export interface TokenRefreshResponseMessage extends WSMessage {
  type: 'token_refresh_response';
  success: boolean;
  error?: string;
  /** New connection token */
  connectionToken?: string;
  /** When the new connection token expires (ISO 8601) */
  connectionTokenExpiresAt?: string;
}

/**
 * Server status information
 */
export interface ServerStatusMessage extends WSMessage {
  type: 'server_status';
  version: string;
  uptime: number;
  connectedClients: number;
}

/**
 * Error message sent by server
 */
export interface ErrorMessage extends WSMessage {
  type: 'error';
  code: string;
  message: string;
}

/**
 * Ping/pong for connection health check
 */
export interface PingMessage extends WSMessage {
  type: 'ping';
}

export interface PongMessage extends WSMessage {
  type: 'pong';
}

/**
 * All possible WebSocket message types
 */
export type WSMessageType =
  | AuthMessage
  | AuthResponseMessage
  | TokenRefreshMessage
  | TokenRefreshResponseMessage
  | ServerStatusMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;

/**
 * Audit log entry for remote actions
 */
export interface AuditLogEntry {
  /** Timestamp of the action (ISO 8601) */
  timestamp: string;

  /** Client identifier (IP address or identifier) */
  clientId: string;

  /** Action that was performed */
  action: string;

  /** Additional details about the action */
  details?: Record<string, unknown>;

  /** Whether the action succeeded */
  success: boolean;

  /** Error message if action failed */
  error?: string;
}

/**
 * Remote server state
 */
export interface RemoteServerState {
  /** Whether the server is running */
  running: boolean;

  /** Port the server is bound to */
  port: number;

  /** Host the server is bound to */
  host: string;

  /** When the server started (ISO 8601) */
  startedAt: string;

  /** Number of currently connected clients */
  connectedClients: number;

  /** PID of the server process (for daemon mode) */
  pid?: number;
}

// ============================================================================
// US-4: Full Remote Control Message Types
// ============================================================================

import type { TrackerTask } from '../plugins/trackers/types.js';
import type {
  EngineEvent,
  EngineStatus,
  IterationResult,
  ActiveAgentState,
  RateLimitState,
  SubagentTreeNode,
} from '../engine/types.js';

/**
 * Subscribe to engine events from remote instance.
 * After subscribing, the server will forward all engine events to the client.
 */
export interface SubscribeMessage extends WSMessage {
  type: 'subscribe';
  /** Optional filter for specific event types (if empty, subscribes to all) */
  eventTypes?: string[];
}

/**
 * Unsubscribe from engine events.
 */
export interface UnsubscribeMessage extends WSMessage {
  type: 'unsubscribe';
}

/**
 * Engine event forwarded from server to subscribed clients.
 * Wraps the original engine event with message metadata.
 */
export interface EngineEventMessage extends WSMessage {
  type: 'engine_event';
  /** The original engine event */
  event: EngineEvent;
}

/**
 * Request current engine state snapshot.
 */
export interface GetStateMessage extends WSMessage {
  type: 'get_state';
}

/**
 * Response with engine state snapshot.
 */
export interface StateResponseMessage extends WSMessage {
  type: 'state_response';
  /** Engine state snapshot */
  state: RemoteEngineState;
}

/**
 * Serializable engine state for remote transport.
 * Based on EngineState but with Map converted to array for JSON serialization.
 */
/**
 * Sandbox configuration for remote display
 */
export interface RemoteSandboxConfig {
  enabled: boolean;
  mode?: 'auto' | 'bwrap' | 'sandbox-exec' | 'off';
  network?: boolean;
}

/**
 * Git repository information for remote display
 */
export interface RemoteGitInfo {
  /** Repository name (e.g., "ralph-tui") */
  repoName?: string;
  /** Current branch name */
  branch?: string;
  /** Whether there are uncommitted changes */
  isDirty?: boolean;
  /** Short commit hash of HEAD */
  commitHash?: string;
}

export interface RemoteEngineState {
  status: EngineStatus;
  currentIteration: number;
  currentTask: TrackerTask | null;
  totalTasks: number;
  tasksCompleted: number;
  iterations: IterationResult[];
  startedAt: string | null;
  currentOutput: string;
  currentStderr: string;
  activeAgent: ActiveAgentState | null;
  rateLimitState: RateLimitState | null;
  maxIterations: number;
  /** Tasks list (replaces tracker access) */
  tasks: TrackerTask[];
  /** Agent plugin name (e.g., "claude", "opencode") */
  agentName?: string;
  /** Tracker plugin name (e.g., "beads", "json") */
  trackerName?: string;
  /** Current model being used (provider/model format) */
  currentModel?: string;
  /** Subagent tree for current iteration (for TUI rendering) */
  subagentTree?: SubagentTreeNode[];
  /** Whether auto-commit is enabled on the remote */
  autoCommit?: boolean;
  /** Sandbox configuration for display */
  sandboxConfig?: RemoteSandboxConfig;
  /** Resolved sandbox mode (when mode is 'auto') */
  resolvedSandboxMode?: 'bwrap' | 'sandbox-exec' | 'off';
  /** Git repository information */
  gitInfo?: RemoteGitInfo;
  /** Current working directory */
  cwd?: string;
}

/**
 * Request to get all tasks from the tracker.
 */
export interface GetTasksMessage extends WSMessage {
  type: 'get_tasks';
}

/**
 * Response with task list.
 */
export interface TasksResponseMessage extends WSMessage {
  type: 'tasks_response';
  tasks: TrackerTask[];
}

/**
 * Request to pause the engine.
 */
export interface PauseMessage extends WSMessage {
  type: 'pause';
}

/**
 * Request to resume the engine.
 */
export interface ResumeMessage extends WSMessage {
  type: 'resume';
}

/**
 * Request to interrupt/cancel the current iteration.
 */
export interface InterruptMessage extends WSMessage {
  type: 'interrupt';
}

/**
 * Request to refresh task list from tracker.
 */
export interface RefreshTasksMessage extends WSMessage {
  type: 'refresh_tasks';
}

/**
 * Request to add iterations to the engine.
 */
export interface AddIterationsMessage extends WSMessage {
  type: 'add_iterations';
  count: number;
}

/**
 * Request to remove iterations from the engine.
 */
export interface RemoveIterationsMessage extends WSMessage {
  type: 'remove_iterations';
  count: number;
}

/**
 * Request to continue execution (after pause or stop).
 */
export interface ContinueMessage extends WSMessage {
  type: 'continue';
}

/**
 * Generic operation result response.
 */
export interface OperationResultMessage extends WSMessage {
  type: 'operation_result';
  /** The operation that was requested */
  operation: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Additional result data */
  data?: unknown;
}

// ============================================================================
// Config Push Messages (for pushing configuration to remote instances)
// ============================================================================

/**
 * Check what configuration exists on the remote before pushing.
 * Used to determine scope options and enable preview/diff functionality.
 */
export interface CheckConfigMessage extends WSMessage {
  type: 'check_config';
}

/**
 * Response with information about existing configs on the remote.
 */
export interface CheckConfigResponseMessage extends WSMessage {
  type: 'check_config_response';
  /** Whether global config (~/.config/ralph-tui/config.toml) exists */
  globalExists: boolean;
  /** Whether project config (.ralph-tui/config.toml) exists */
  projectExists: boolean;
  /** Path to global config (if exists) */
  globalPath?: string;
  /** Path to project config (if exists) */
  projectPath?: string;
  /** Content of global config (for preview/diff, if exists) */
  globalContent?: string;
  /** Content of project config (for preview/diff, if exists) */
  projectContent?: string;
  /** Current working directory on the remote */
  remoteCwd?: string;
}

/**
 * Push configuration to the remote instance.
 */
export interface PushConfigMessage extends WSMessage {
  type: 'push_config';
  /** Scope: 'global' for ~/.config/ralph-tui, 'project' for .ralph-tui */
  scope: 'global' | 'project';
  /** The TOML configuration content to push */
  configContent: string;
  /** If false and config exists, return error. If true, create backup and overwrite. */
  overwrite: boolean;
}

/**
 * Response from pushing configuration.
 */
export interface PushConfigResponseMessage extends WSMessage {
  type: 'push_config_response';
  /** Whether the push succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Path to backup file (if existing config was backed up) */
  backupPath?: string;
  /** Whether auto-migration was triggered */
  migrationTriggered?: boolean;
  /** If engine is running and needs restart for changes to take effect */
  requiresRestart?: boolean;
  /** Path where config was written */
  configPath?: string;
}

// ============================================================================
// Prompt Preview Messages (for viewing prompt that would be sent to agent)
// ============================================================================

/**
 * Request to generate a prompt preview for a task.
 */
export interface GetPromptPreviewMessage extends WSMessage {
  type: 'get_prompt_preview';
  /** Task ID to generate prompt for */
  taskId: string;
}

/**
 * Response with prompt preview content.
 */
export interface PromptPreviewResponseMessage extends WSMessage {
  type: 'prompt_preview_response';
  /** Whether the preview was generated successfully */
  success: boolean;
  /** The rendered prompt content */
  prompt?: string;
  /** Template source (e.g., 'tracker', 'default') */
  source?: string;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Iteration Output Messages (for viewing historical iteration output)
// ============================================================================

/**
 * Request to get iteration output for a specific task.
 * Returns the most recent iteration result for the task.
 */
export interface GetIterationOutputMessage extends WSMessage {
  type: 'get_iteration_output';
  /** Task ID to get iteration output for */
  taskId: string;
}

/**
 * Response with iteration output data.
 */
export interface IterationOutputResponseMessage extends WSMessage {
  type: 'iteration_output_response';
  /** Whether the iteration was found */
  success: boolean;
  /** Task ID this output is for */
  taskId: string;
  /** Iteration number */
  iteration?: number;
  /** Agent stdout output */
  output?: string;
  /** When the iteration started (ISO 8601) */
  startedAt?: string;
  /** When the iteration ended (ISO 8601) */
  endedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Whether the iteration is still running */
  isRunning?: boolean;
  /** Error message if not found or failed */
  error?: string;
}

// ============================================================================
// Remote Orchestration Message Types
// ============================================================================

import type { ParallelEvent } from '../parallel/events.js';
import type {
  WorkerDisplayState,
  MergeOperation,
} from '../parallel/types.js';

/**
 * Request to start parallel orchestration on remote.
 */
export interface OrchestrateStartMessage extends WSMessage {
  type: 'orchestrate:start';
  /** Path to PRD JSON file (for json tracker) */
  prdPath?: string;
  /** Epic ID (for beads/beads-rust tracker) */
  epicId?: string;
  /** Maximum workers (default: 3) */
  maxWorkers?: number;
  /** Maximum iterations per worker */
  maxIterations?: number;
  /** Merge directly to current branch instead of session branch */
  directMerge?: boolean;
}

/**
 * Response to orchestration start request.
 */
export interface OrchestrateStartResponseMessage extends WSMessage {
  type: 'orchestrate:start_response';
  /** Whether orchestration started successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Unique orchestration session ID */
  orchestrationId?: string;
  /** Total number of tasks to execute */
  totalTasks?: number;
  /** Number of parallel groups */
  totalGroups?: number;
  /** Maximum parallelism achievable */
  maxParallelism?: number;
}

/**
 * Request to pause orchestration.
 */
export interface OrchestratePauseMessage extends WSMessage {
  type: 'orchestrate:pause';
  orchestrationId: string;
}

/**
 * Request to resume paused orchestration.
 */
export interface OrchestrateResumeMessage extends WSMessage {
  type: 'orchestrate:resume';
  orchestrationId: string;
}

/**
 * Request to stop/cancel orchestration.
 */
export interface OrchestrateStopMessage extends WSMessage {
  type: 'orchestrate:stop';
  orchestrationId: string;
}

/**
 * Request current orchestration state.
 */
export interface OrchestrateGetStateMessage extends WSMessage {
  type: 'orchestrate:get_state';
  orchestrationId: string;
}

/**
 * Serializable orchestration state for remote transport.
 */
export interface RemoteOrchestrationState {
  /** Orchestration session ID */
  orchestrationId: string;
  /** Current status */
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  /** Current group index being executed */
  currentGroupIndex: number;
  /** Total number of parallel groups */
  totalGroups: number;
  /** Active worker states */
  workers: WorkerDisplayState[];
  /** Pending merge operations */
  mergeQueue: MergeOperation[];
  /** Number of tasks completed */
  totalTasksCompleted: number;
  /** Total number of tasks */
  totalTasks: number;
  /** When orchestration started (ISO 8601) */
  startedAt: string | null;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Session branch name (if not using directMerge) */
  sessionBranch?: string;
  /** Original branch name (if not using directMerge) */
  originalBranch?: string;
}

/**
 * Response with orchestration state.
 */
export interface OrchestrateStateResponseMessage extends WSMessage {
  type: 'orchestrate:state_response';
  /** Whether the state was retrieved successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Orchestration state */
  state?: RemoteOrchestrationState;
}

/**
 * Parallel event forwarded to subscribed clients.
 */
export interface ParallelEventMessage extends WSMessage {
  type: 'parallel_event';
  /** Orchestration session ID */
  orchestrationId: string;
  /** The parallel event */
  event: ParallelEvent;
}

/**
 * All possible remote control message types (extending base types).
 */
export type RemoteWSMessageType =
  | WSMessageType
  | SubscribeMessage
  | UnsubscribeMessage
  | EngineEventMessage
  | GetStateMessage
  | StateResponseMessage
  | GetTasksMessage
  | TasksResponseMessage
  | PauseMessage
  | ResumeMessage
  | InterruptMessage
  | RefreshTasksMessage
  | AddIterationsMessage
  | RemoveIterationsMessage
  | ContinueMessage
  | OperationResultMessage
  | GetPromptPreviewMessage
  | PromptPreviewResponseMessage
  | GetIterationOutputMessage
  | IterationOutputResponseMessage
  | CheckConfigMessage
  | CheckConfigResponseMessage
  | PushConfigMessage
  | PushConfigResponseMessage
  // Orchestration messages
  | OrchestrateStartMessage
  | OrchestrateStartResponseMessage
  | OrchestratePauseMessage
  | OrchestrateResumeMessage
  | OrchestrateStopMessage
  | OrchestrateGetStateMessage
  | OrchestrateStateResponseMessage
  | ParallelEventMessage;
