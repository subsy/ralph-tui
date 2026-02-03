/**
 * ABOUTME: WebSocket client for connecting to remote ralph-tui instances.
 * Manages connection lifecycle, authentication, and auto-reconnection with exponential backoff.
 * US-4: Extended with full remote control capabilities (pause, resume, cancel, state queries).
 * US-5: Extended with connection resilience (auto-reconnect, latency tracking, connection duration).
 */

import type {
  AuthMessage,
  AuthResponseMessage,
  PingMessage,
  WSMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  GetStateMessage,
  GetTasksMessage,
  PauseMessage,
  ResumeMessage,
  InterruptMessage,
  RefreshTasksMessage,
  AddIterationsMessage,
  RemoveIterationsMessage,
  ContinueMessage,
  StateResponseMessage,
  TasksResponseMessage,
  OperationResultMessage,
  EngineEventMessage,
  RemoteEngineState,
  TokenRefreshMessage,
  TokenRefreshResponseMessage,
  GetPromptPreviewMessage,
  PromptPreviewResponseMessage,
  GetIterationOutputMessage,
  IterationOutputResponseMessage,
  CheckConfigMessage,
  CheckConfigResponseMessage,
  PushConfigMessage,
  PushConfigResponseMessage,
  // Orchestration types
  OrchestrateStartMessage,
  OrchestrateStartResponseMessage,
  OrchestratePauseMessage,
  OrchestrateResumeMessage,
  OrchestrateStopMessage,
  OrchestrateGetStateMessage,
  OrchestrateStateResponseMessage,
  ParallelEventMessage,
  RemoteOrchestrationState,
} from './types.js';
import { TOKEN_LIFETIMES } from './types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { EngineEvent } from '../engine/types.js';
import type { ParallelEvent } from '../parallel/events.js';

/**
 * Connection status for a remote instance.
 * State machine: disconnected -> connecting -> connected -> reconnecting -> connected
 *                                                        -> disconnected (on max retries)
 * - disconnected: Not connected, no reconnection in progress
 * - connecting: Initial connection attempt
 * - connected: Successfully connected and authenticated
 * - reconnecting: Connection lost, attempting to reconnect with exponential backoff
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Configuration for exponential backoff reconnection.
 */
export interface ReconnectConfig {
  /** Initial delay before first reconnect attempt (ms). Default: 1000 */
  initialDelayMs: number;
  /** Maximum delay between reconnect attempts (ms). Default: 30000 */
  maxDelayMs: number;
  /** Multiplier for exponential backoff. Default: 2 */
  backoffMultiplier: number;
  /** Maximum number of retry attempts before giving up. Default: 10 */
  maxRetries: number;
  /** Number of silent retries before alerting user. Default: 3 */
  silentRetryThreshold: number;
}

/**
 * Default reconnection configuration.
 */
export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  maxRetries: 10,
  silentRetryThreshold: 3,
};

/**
 * Connection metrics for monitoring connection health.
 */
export interface ConnectionMetrics {
  /** Round-trip latency from last ping/pong (ms) */
  latencyMs: number | null;
  /** Timestamp when connection was established (ISO 8601) */
  connectedAt: string | null;
  /** Connection duration in seconds (computed from connectedAt) */
  connectionDurationSecs: number;
  /** Number of reconnection attempts since last successful connection */
  reconnectAttempts: number;
  /** Whether currently reconnecting */
  isReconnecting: boolean;
}

/**
 * Represents a tab for an instance (local or remote)
 */
export interface InstanceTab {
  /** Unique identifier for the tab */
  id: string;

  /** Display label (alias for remotes, "Local" for local) */
  label: string;

  /** Whether this is the local instance */
  isLocal: boolean;

  /** Connection status (always 'connected' for local) */
  status: ConnectionStatus;

  /** Remote alias (undefined for local) */
  alias?: string;

  /** Host for remote connections */
  host?: string;

  /** Port for remote connections */
  port?: number;

  /** Last error message (if status is disconnected due to error) */
  lastError?: string;

  /** Connection metrics (latency, duration, reconnect attempts) */
  metrics?: ConnectionMetrics;
}

/**
 * Events emitted by RemoteClient
 */
export type RemoteClientEvent =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'disconnected'; error?: string }
  | { type: 'reconnecting'; attempt: number; maxRetries: number; nextDelayMs: number }
  | { type: 'reconnected'; totalAttempts: number }
  | { type: 'reconnect_failed'; attempts: number; error: string }
  | { type: 'metrics_updated'; metrics: ConnectionMetrics }
  | { type: 'message'; message: WSMessage }
  | { type: 'engine_event'; event: EngineEvent }
  | { type: 'token_refreshed'; expiresAt: string }
  | { type: 'parallel_event'; orchestrationId: string; event: ParallelEvent };

/**
 * Callback for remote client events
 */
export type RemoteClientEventHandler = (event: RemoteClientEvent) => void;

/**
 * Pending request waiting for a response.
 */
interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket client for connecting to a remote ralph-tui instance.
 * Handles authentication, message passing, and full remote control.
 * US-4: Extended with request/response correlation and engine control methods.
 * US-5: Extended with auto-reconnect and connection metrics.
 * US-6: Extended with two-tier token system (server token for initial auth, connection token for session).
 */
export class RemoteClient {
  private ws: WebSocket | null = null;
  private host: string;
  private port: number;
  /** Server token for initial authentication (long-lived, 90 days) */
  private serverToken: string;
  private eventHandler: RemoteClientEventHandler;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _status: ConnectionStatus = 'disconnected';
  /** Pending requests waiting for responses, keyed by message ID */
  private pendingRequests: Map<string, PendingRequest<unknown>> = new Map();
  /** Whether subscribed to engine events */
  private _subscribed = false;
  /** Request timeout in milliseconds */
  private requestTimeout = 30000;

  // US-6: Connection token management
  /** Connection token issued by server (short-lived, 24 hours) */
  private connectionToken: string | null = null;
  /** When the connection token expires (ISO 8601) */
  private connectionTokenExpiresAt: string | null = null;
  /** Timer for proactive token refresh */
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // US-5: Reconnection state
  private reconnectConfig: ReconnectConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false; // Track if disconnect was intentional

  // US-5: Connection metrics
  private _connectedAt: string | null = null;
  private _latencyMs: number | null = null;
  private lastPingTime: number | null = null;
  private metricsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    host: string,
    port: number,
    token: string,
    eventHandler: RemoteClientEventHandler,
    reconnectConfig: Partial<ReconnectConfig> = {}
  ) {
    this.host = host;
    this.port = port;
    this.serverToken = token;
    this.eventHandler = eventHandler;
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
  }

  /**
   * Current connection status
   */
  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Get current connection metrics.
   */
  get metrics(): ConnectionMetrics {
    let connectionDurationSecs = 0;
    if (this._connectedAt) {
      connectionDurationSecs = Math.floor(
        (Date.now() - new Date(this._connectedAt).getTime()) / 1000
      );
    }
    return {
      latencyMs: this._latencyMs,
      connectedAt: this._connectedAt,
      connectionDurationSecs,
      reconnectAttempts: this.reconnectAttempts,
      isReconnecting: this._status === 'reconnecting',
    };
  }

  /**
   * Connect to the remote instance.
   * Authenticates immediately after connection.
   * On unexpected disconnect, automatically attempts reconnection with exponential backoff.
   */
  async connect(): Promise<void> {
    if (this._status === 'connecting' || this._status === 'connected') {
      return;
    }

    // Clear any pending reconnect timer
    this.clearReconnectTimer();
    this.intentionalDisconnect = false;

    this._status = 'connecting';
    this.eventHandler({ type: 'connecting' });

    return new Promise<void>((resolve, reject) => {
      try {
        const url = `ws://${this.host}:${this.port}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.authenticate();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data as string) as WSMessage;
            this.handleMessage(message, resolve, reject);
          } catch {
            // Ignore invalid messages
          }
        };

        this.ws.onerror = () => {
          // Don't immediately reject - let onclose handle it for reconnection logic
          if (this._status === 'connecting') {
            this._status = 'disconnected';
            this.eventHandler({ type: 'disconnected', error: 'Connection error' });
            reject(new Error('Connection error'));
          }
        };

        this.ws.onclose = () => {
          const wasConnected = this._status === 'connected';
          this.cleanupConnection();

          if (wasConnected && !this.intentionalDisconnect) {
            // Connection was lost unexpectedly - attempt auto-reconnect
            this.scheduleReconnect();
          } else if (this._status !== 'reconnecting') {
            this._status = 'disconnected';
            this.eventHandler({ type: 'disconnected', error: 'Connection closed' });
          }
        };
      } catch (error) {
        this._status = 'disconnected';
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.eventHandler({ type: 'disconnected', error: errorMessage });
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the remote instance.
   * This is an intentional disconnect - no auto-reconnect will be attempted.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.cleanup();
    this._status = 'disconnected';
    this.eventHandler({ type: 'disconnected' });
  }

  /**
   * Send a message to the remote instance.
   */
  send(message: WSMessage): void {
    if (this.ws && this._status === 'connected') {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send authentication message.
   * Uses connection token if available (for re-auth), otherwise uses server token.
   */
  private authenticate(): void {
    const useConnectionToken = this.connectionToken !== null;
    const authMessage: AuthMessage = {
      type: 'auth',
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      token: useConnectionToken ? this.connectionToken! : this.serverToken,
      tokenType: useConnectionToken ? 'connection' : 'server',
    };
    this.ws?.send(JSON.stringify(authMessage));
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(
    message: WSMessage,
    resolveConnect: () => void,
    rejectConnect: (error: Error) => void
  ): void {
    // Check if this is a response to a pending request
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      pending.resolve(message);
      return;
    }

    switch (message.type) {
      case 'auth_response': {
        const authResponse = message as AuthResponseMessage;
        if (authResponse.success) {
          const wasReconnecting = this._status === 'reconnecting';
          this._status = 'connected';

          // US-6: Store connection token if provided (server token auth response)
          if (authResponse.connectionToken && authResponse.connectionTokenExpiresAt) {
            this.connectionToken = authResponse.connectionToken;
            this.connectionTokenExpiresAt = authResponse.connectionTokenExpiresAt;
            this.scheduleTokenRefresh();
          }

          // Track connection metrics
          this._connectedAt = new Date().toISOString();
          this.startMetricsInterval();

          if (wasReconnecting) {
            // This was a successful reconnection
            this.eventHandler({ type: 'reconnected', totalAttempts: this.reconnectAttempts });
            this.reconnectAttempts = 0;
          } else {
            this.eventHandler({ type: 'connected' });
          }

          this.startPingInterval();
          resolveConnect();
        } else {
          // Auth failed - if using connection token, it may have expired
          // Clear it so next attempt uses server token
          if (this.connectionToken) {
            this.connectionToken = null;
            this.connectionTokenExpiresAt = null;
          }
          this._status = 'disconnected';
          const error = authResponse.error ?? 'Authentication failed';
          this.eventHandler({ type: 'disconnected', error });
          this.cleanup();
          rejectConnect(new Error(error));
        }
        break;
      }

      case 'token_refresh_response': {
        // US-6: Handle token refresh response
        const refreshResponse = message as TokenRefreshResponseMessage;
        if (refreshResponse.success && refreshResponse.connectionToken) {
          this.connectionToken = refreshResponse.connectionToken;
          this.connectionTokenExpiresAt = refreshResponse.connectionTokenExpiresAt ?? null;
          this.scheduleTokenRefresh();
          this.eventHandler({
            type: 'token_refreshed',
            expiresAt: refreshResponse.connectionTokenExpiresAt ?? '',
          });
        }
        // If refresh fails, we'll continue with the current token until it expires
        // Then reconnect with server token
        break;
      }

      case 'pong': {
        // Heartbeat acknowledged - calculate latency
        if (this.lastPingTime !== null) {
          this._latencyMs = Date.now() - this.lastPingTime;
          this.eventHandler({ type: 'metrics_updated', metrics: this.metrics });
        }
        break;
      }

      case 'engine_event': {
        // Forward engine events to the event handler
        const engineEventMsg = message as EngineEventMessage;
        this.eventHandler({ type: 'engine_event', event: engineEventMsg.event });
        break;
      }

      case 'parallel_event': {
        // Forward parallel events to the event handler
        const parallelEventMsg = message as ParallelEventMessage;
        this.eventHandler({
          type: 'parallel_event',
          orchestrationId: parallelEventMsg.orchestrationId,
          event: parallelEventMsg.event,
        });
        break;
      }

      default: {
        this.eventHandler({ type: 'message', message });
      }
    }
  }

  // ============================================================================
  // US-4: Remote Control Methods
  // ============================================================================

  /**
   * Send a request and wait for a response.
   * Uses message ID correlation to match responses to requests.
   */
  private async request<T extends WSMessage>(message: Omit<T, 'id' | 'timestamp'>): Promise<WSMessage> {
    if (this._status !== 'connected' || !this.ws) {
      throw new Error('Not connected');
    }

    const id = crypto.randomUUID();
    const fullMessage: WSMessage = {
      ...message,
      id,
      timestamp: new Date().toISOString(),
    } as WSMessage;

    return new Promise<WSMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.requestTimeout);

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.ws!.send(JSON.stringify(fullMessage));
    });
  }

  /**
   * Subscribe to engine events from the remote instance.
   * After subscribing, engine events will be forwarded via the event handler.
   */
  async subscribe(eventTypes?: string[]): Promise<void> {
    const message: Omit<SubscribeMessage, 'id' | 'timestamp'> = {
      type: 'subscribe',
      eventTypes,
    };
    const response = await this.request<SubscribeMessage>(message);
    if (response.type === 'operation_result') {
      const result = response as OperationResultMessage;
      if (!result.success) {
        throw new Error(result.error ?? 'Subscribe failed');
      }
    }
    this._subscribed = true;
  }

  /**
   * Unsubscribe from engine events.
   */
  async unsubscribe(): Promise<void> {
    const message: Omit<UnsubscribeMessage, 'id' | 'timestamp'> = {
      type: 'unsubscribe',
    };
    await this.request<UnsubscribeMessage>(message);
    this._subscribed = false;
  }

  /**
   * Get the current engine state from the remote instance.
   */
  async getState(): Promise<RemoteEngineState> {
    const message: Omit<GetStateMessage, 'id' | 'timestamp'> = {
      type: 'get_state',
    };
    const response = await this.request<GetStateMessage>(message);
    if (response.type !== 'state_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as StateResponseMessage).state;
  }

  /**
   * Get tasks from the remote instance's tracker.
   */
  async getTasks(): Promise<TrackerTask[]> {
    const message: Omit<GetTasksMessage, 'id' | 'timestamp'> = {
      type: 'get_tasks',
    };
    const response = await this.request<GetTasksMessage>(message);
    if (response.type !== 'tasks_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as TasksResponseMessage).tasks;
  }

  /**
   * Pause the remote engine.
   */
  async pause(): Promise<boolean> {
    const message: Omit<PauseMessage, 'id' | 'timestamp'> = {
      type: 'pause',
    };
    const response = await this.request<PauseMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Resume the remote engine.
   */
  async resume(): Promise<boolean> {
    const message: Omit<ResumeMessage, 'id' | 'timestamp'> = {
      type: 'resume',
    };
    const response = await this.request<ResumeMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Interrupt/cancel the current iteration on the remote engine.
   */
  async interrupt(): Promise<boolean> {
    const message: Omit<InterruptMessage, 'id' | 'timestamp'> = {
      type: 'interrupt',
    };
    const response = await this.request<InterruptMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Refresh task list from the remote tracker.
   */
  async refreshTasks(): Promise<boolean> {
    const message: Omit<RefreshTasksMessage, 'id' | 'timestamp'> = {
      type: 'refresh_tasks',
    };
    const response = await this.request<RefreshTasksMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Add iterations to the remote engine.
   */
  async addIterations(count: number): Promise<boolean> {
    const message: Omit<AddIterationsMessage, 'id' | 'timestamp'> = {
      type: 'add_iterations',
      count,
    };
    const response = await this.request<AddIterationsMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Remove iterations from the remote engine.
   */
  async removeIterations(count: number): Promise<boolean> {
    const message: Omit<RemoveIterationsMessage, 'id' | 'timestamp'> = {
      type: 'remove_iterations',
      count,
    };
    const response = await this.request<RemoveIterationsMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Continue execution on the remote engine.
   */
  async continueExecution(): Promise<boolean> {
    const message: Omit<ContinueMessage, 'id' | 'timestamp'> = {
      type: 'continue',
    };
    const response = await this.request<ContinueMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Get a prompt preview for a task on the remote instance.
   * Returns the rendered prompt that would be sent to the agent.
   */
  async getPromptPreview(
    taskId: string
  ): Promise<{ success: true; prompt: string; source: string } | { success: false; error: string }> {
    const message: Omit<GetPromptPreviewMessage, 'id' | 'timestamp'> = {
      type: 'get_prompt_preview',
      taskId,
    };
    const response = await this.request<GetPromptPreviewMessage>(message);
    if (response.type !== 'prompt_preview_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    const previewResponse = response as PromptPreviewResponseMessage;
    if (previewResponse.success) {
      return {
        success: true,
        prompt: previewResponse.prompt!,
        source: previewResponse.source!,
      };
    }
    return {
      success: false,
      error: previewResponse.error ?? 'Unknown error',
    };
  }

  /**
   * Get iteration output for a specific task on the remote instance.
   * Returns the output from the most recent iteration of the task.
   */
  async getIterationOutput(taskId: string): Promise<{
    success: boolean;
    taskId: string;
    iteration?: number;
    output?: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    isRunning?: boolean;
    error?: string;
  }> {
    const message: Omit<GetIterationOutputMessage, 'id' | 'timestamp'> = {
      type: 'get_iteration_output',
      taskId,
    };
    const response = await this.request<GetIterationOutputMessage>(message);
    if (response.type !== 'iteration_output_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    const outputResponse = response as IterationOutputResponseMessage;
    return {
      success: outputResponse.success,
      taskId: outputResponse.taskId,
      iteration: outputResponse.iteration,
      output: outputResponse.output,
      startedAt: outputResponse.startedAt,
      endedAt: outputResponse.endedAt,
      durationMs: outputResponse.durationMs,
      isRunning: outputResponse.isRunning,
      error: outputResponse.error,
    };
  }

  // ============================================================================
  // Config Push Methods
  // ============================================================================

  /**
   * Check what configuration exists on the remote instance.
   * Returns info about global and project config existence and content (for preview/diff).
   */
  async checkConfig(): Promise<{
    globalExists: boolean;
    projectExists: boolean;
    globalPath?: string;
    projectPath?: string;
    globalContent?: string;
    projectContent?: string;
    remoteCwd?: string;
  }> {
    const message: Omit<CheckConfigMessage, 'id' | 'timestamp'> = {
      type: 'check_config',
    };
    const response = await this.request<CheckConfigMessage>(message);
    if (response.type !== 'check_config_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    const configResponse = response as CheckConfigResponseMessage;
    return {
      globalExists: configResponse.globalExists,
      projectExists: configResponse.projectExists,
      globalPath: configResponse.globalPath,
      projectPath: configResponse.projectPath,
      globalContent: configResponse.globalContent,
      projectContent: configResponse.projectContent,
      remoteCwd: configResponse.remoteCwd,
    };
  }

  /**
   * Push configuration to the remote instance.
   * @param scope - 'global' for ~/.config/ralph-tui or 'project' for .ralph-tui
   * @param configContent - TOML configuration content
   * @param overwrite - If true, backup and overwrite existing config. If false, fail if exists.
   */
  async pushConfig(
    scope: 'global' | 'project',
    configContent: string,
    overwrite = false
  ): Promise<{
    success: boolean;
    error?: string;
    configPath?: string;
    backupPath?: string;
    migrationTriggered?: boolean;
    requiresRestart?: boolean;
  }> {
    const message: Omit<PushConfigMessage, 'id' | 'timestamp'> = {
      type: 'push_config',
      scope,
      configContent,
      overwrite,
    };
    const response = await this.request<PushConfigMessage>(message);
    if (response.type !== 'push_config_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    const pushResponse = response as PushConfigResponseMessage;
    return {
      success: pushResponse.success,
      error: pushResponse.error,
      configPath: pushResponse.configPath,
      backupPath: pushResponse.backupPath,
      migrationTriggered: pushResponse.migrationTriggered,
      requiresRestart: pushResponse.requiresRestart,
    };
  }

  // ============================================================================
  // Remote Orchestration Methods
  // ============================================================================

  /**
   * Start parallel orchestration on the remote instance.
   * Returns orchestration session info on success.
   */
  async startOrchestration(options: {
    prdPath?: string;
    epicId?: string;
    maxWorkers?: number;
    maxIterations?: number;
    directMerge?: boolean;
  } = {}): Promise<{
    success: boolean;
    error?: string;
    orchestrationId?: string;
    totalTasks?: number;
    totalGroups?: number;
    maxParallelism?: number;
  }> {
    const message: Omit<OrchestrateStartMessage, 'id' | 'timestamp'> = {
      type: 'orchestrate:start',
      ...options,
    };
    const response = await this.request<OrchestrateStartMessage>(message);
    if (response.type !== 'orchestrate:start_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    const startResponse = response as OrchestrateStartResponseMessage;
    return {
      success: startResponse.success,
      error: startResponse.error,
      orchestrationId: startResponse.orchestrationId,
      totalTasks: startResponse.totalTasks,
      totalGroups: startResponse.totalGroups,
      maxParallelism: startResponse.maxParallelism,
    };
  }

  /**
   * Pause orchestration on the remote instance.
   */
  async pauseOrchestration(orchestrationId: string): Promise<boolean> {
    const message: Omit<OrchestratePauseMessage, 'id' | 'timestamp'> = {
      type: 'orchestrate:pause',
      orchestrationId,
    };
    const response = await this.request<OrchestratePauseMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Resume paused orchestration on the remote instance.
   */
  async resumeOrchestration(orchestrationId: string): Promise<boolean> {
    const message: Omit<OrchestrateResumeMessage, 'id' | 'timestamp'> = {
      type: 'orchestrate:resume',
      orchestrationId,
    };
    const response = await this.request<OrchestrateResumeMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Stop orchestration on the remote instance.
   */
  async stopOrchestration(orchestrationId: string): Promise<boolean> {
    const message: Omit<OrchestrateStopMessage, 'id' | 'timestamp'> = {
      type: 'orchestrate:stop',
      orchestrationId,
    };
    const response = await this.request<OrchestrateStopMessage>(message);
    if (response.type !== 'operation_result') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return (response as OperationResultMessage).success;
  }

  /**
   * Get current orchestration state from the remote instance.
   */
  async getOrchestrationState(orchestrationId: string): Promise<{
    success: boolean;
    error?: string;
    state?: RemoteOrchestrationState;
  }> {
    const message: Omit<OrchestrateGetStateMessage, 'id' | 'timestamp'> = {
      type: 'orchestrate:get_state',
      orchestrationId,
    };
    const response = await this.request<OrchestrateGetStateMessage>(message);
    if (response.type !== 'orchestrate:state_response') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    const stateResponse = response as OrchestrateStateResponseMessage;
    return {
      success: stateResponse.success,
      error: stateResponse.error,
      state: stateResponse.state,
    };
  }

  /**
   * Whether currently subscribed to engine events.
   */
  get subscribed(): boolean {
    return this._subscribed;
  }

  /**
   * Start sending periodic ping messages for keepalive and latency measurement.
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this._status === 'connected' && this.ws) {
        // Track when ping was sent for latency calculation
        this.lastPingTime = Date.now();
        const pingMessage: PingMessage = {
          type: 'ping',
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        };
        this.ws.send(JSON.stringify(pingMessage));
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop the ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ============================================================================
  // US-6: Token Refresh Methods
  // ============================================================================

  /**
   * Schedule proactive token refresh before expiration.
   * Refreshes when REFRESH_THRESHOLD_HOURS remain before expiration.
   */
  private scheduleTokenRefresh(): void {
    this.clearTokenRefreshTimer();

    if (!this.connectionTokenExpiresAt) {
      return;
    }

    const expiresAt = new Date(this.connectionTokenExpiresAt).getTime();
    const refreshThreshold = TOKEN_LIFETIMES.REFRESH_THRESHOLD_HOURS * 60 * 60 * 1000;
    const refreshTime = expiresAt - refreshThreshold;
    const delay = Math.max(0, refreshTime - Date.now());

    // Only schedule if expiration is in the future
    if (expiresAt > Date.now()) {
      this.tokenRefreshTimer = setTimeout(() => {
        this.requestTokenRefresh();
      }, delay);
    }
  }

  /**
   * Request a token refresh from the server.
   */
  private requestTokenRefresh(): void {
    if (!this.connectionToken || this._status !== 'connected' || !this.ws) {
      return;
    }

    const refreshMessage: TokenRefreshMessage = {
      type: 'token_refresh',
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      connectionToken: this.connectionToken,
    };

    this.ws.send(JSON.stringify(refreshMessage));
  }

  /**
   * Clear the token refresh timer.
   */
  private clearTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  /**
   * Clean up resources (full cleanup including reconnection state).
   */
  private cleanup(): void {
    this.cleanupConnection();
    this.clearReconnectTimer();
    this.clearTokenRefreshTimer();
    this.stopMetricsInterval();
    this.reconnectAttempts = 0;
    this._connectedAt = null;
    this._latencyMs = null;
    // Keep connection token for potential reconnect attempts
  }

  /**
   * Clean up connection resources without resetting reconnection state.
   * Used when preparing for a reconnection attempt.
   */
  private cleanupConnection(): void {
    this.stopPingInterval();
    this.clearTokenRefreshTimer();
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }
    this._subscribed = false;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }

  // ============================================================================
  // US-5: Connection Resilience Methods
  // ============================================================================

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Called automatically when an established connection is lost unexpectedly.
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.reconnectConfig.maxRetries) {
      // Max retries exceeded - give up
      this._status = 'disconnected';
      this.eventHandler({
        type: 'reconnect_failed',
        attempts: this.reconnectAttempts,
        error: `Failed to reconnect after ${this.reconnectAttempts} attempts`,
      });
      this.reconnectAttempts = 0;
      return;
    }

    this._status = 'reconnecting';
    this.reconnectAttempts++;

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectConfig.initialDelayMs *
        Math.pow(this.reconnectConfig.backoffMultiplier, this.reconnectAttempts - 1),
      this.reconnectConfig.maxDelayMs
    );

    // Emit reconnecting event (silent if under threshold)
    this.eventHandler({
      type: 'reconnecting',
      attempt: this.reconnectAttempts,
      maxRetries: this.reconnectConfig.maxRetries,
      nextDelayMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnect();
    }, delay);
  }

  /**
   * Attempt to reconnect to the remote instance.
   */
  private async attemptReconnect(): Promise<void> {
    try {
      const url = `ws://${this.host}:${this.port}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.authenticate();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as WSMessage;
          // For reconnection, we handle auth_response specially
          if (message.type === 'auth_response') {
            const authResponse = message as AuthResponseMessage;
            if (authResponse.success) {
              // Store connection token if provided (for future reconnections)
              if (authResponse.connectionToken && authResponse.connectionTokenExpiresAt) {
                this.connectionToken = authResponse.connectionToken;
                this.connectionTokenExpiresAt = authResponse.connectionTokenExpiresAt;
                this.scheduleTokenRefresh();
              }
              this._status = 'connected';
              this._connectedAt = new Date().toISOString();
              this.startMetricsInterval();
              this.eventHandler({ type: 'reconnected', totalAttempts: this.reconnectAttempts });
              this.reconnectAttempts = 0;
              this.startPingInterval();
            } else {
              // Auth failed during reconnect - clear connection token and retry with server token
              // This handles the case where server restarted and our connection token is no longer valid
              this.connectionToken = null;
              this.connectionTokenExpiresAt = null;
              this.cleanupConnection();
              this.scheduleReconnect();
            }
          } else if (message.type === 'pong') {
            if (this.lastPingTime !== null) {
              this._latencyMs = Date.now() - this.lastPingTime;
              this.eventHandler({ type: 'metrics_updated', metrics: this.metrics });
            }
          } else if (message.type === 'engine_event') {
            const engineEventMsg = message as EngineEventMessage;
            this.eventHandler({ type: 'engine_event', event: engineEventMsg.event });
          } else if (message.type === 'parallel_event') {
            // Forward parallel events during reconnect (same as primary handler)
            const parallelEventMsg = message as ParallelEventMessage;
            this.eventHandler({
              type: 'parallel_event',
              orchestrationId: parallelEventMsg.orchestrationId,
              event: parallelEventMsg.event,
            });
          } else {
            // Check for pending request responses
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(message.id);
              pending.resolve(message);
            } else {
              this.eventHandler({ type: 'message', message });
            }
          }
        } catch {
          // Ignore invalid messages
        }
      };

      this.ws.onerror = () => {
        // Connection error during reconnect - onclose will also fire, let it handle scheduling
        // Don't schedule here to avoid double-incrementing reconnectAttempts
      };

      this.ws.onclose = () => {
        if (this._status === 'connected' && !this.intentionalDisconnect) {
          // Connection lost again - try to reconnect
          this.cleanupConnection();
          this.scheduleReconnect();
        } else if (this._status === 'reconnecting') {
          // Reconnect attempt failed - schedule next attempt
          this.cleanupConnection();
          this.scheduleReconnect();
        }
      };
    } catch {
      // Failed to create WebSocket - schedule another attempt
      this.cleanupConnection();
      this.scheduleReconnect();
    }
  }

  /**
   * Clear any pending reconnection timer.
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start interval for updating connection duration metrics.
   */
  private startMetricsInterval(): void {
    this.stopMetricsInterval();
    // Emit metrics periodically (every 10 seconds) so UI can update connection duration
    this.metricsInterval = setInterval(() => {
      if (this._status === 'connected') {
        this.eventHandler({ type: 'metrics_updated', metrics: this.metrics });
      }
    }, 10000);
  }

  /**
   * Stop the metrics update interval.
   */
  private stopMetricsInterval(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * Check if reconnection attempts have exceeded the silent retry threshold.
   * Used by consumers to decide whether to show alerts.
   */
  shouldAlertOnReconnect(): boolean {
    return this.reconnectAttempts > this.reconnectConfig.silentRetryThreshold;
  }
}

/**
 * Create the local instance tab
 */
export function createLocalTab(): InstanceTab {
  return {
    id: 'local',
    label: 'Local',
    isLocal: true,
    status: 'connected',
  };
}

/**
 * Create a remote instance tab from configuration
 */
export function createRemoteTab(
  alias: string,
  host: string,
  port: number
): InstanceTab {
  return {
    id: `remote-${alias}`,
    label: alias,
    isLocal: false,
    status: 'disconnected',
    alias,
    host,
    port,
  };
}
