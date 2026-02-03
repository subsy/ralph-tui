/**
 * ABOUTME: WebSocket server for remote ralph-tui control.
 * Handles client connections, authentication, and message routing.
 * Binds to localhost if no token configured, all interfaces if token is set.
 * US-4: Extended with full remote control (pause, resume, cancel, state queries, subscriptions).
 */

import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';
import type {
  WSMessage,
  AuthMessage,
  AuthResponseMessage,
  ErrorMessage,
  PongMessage,
  ServerStatusMessage,
  RemoteServerState,
  RemoteEngineState,
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
import {
  validateServerToken,
  validateConnectionToken,
  issueConnectionToken,
  refreshConnectionToken,
  revokeClientTokens,
  cleanupExpiredTokens,
  getOrCreateServerToken,
} from './token.js';
import { createAuditLogger, type AuditLogger } from './audit.js';
import type { ExecutionEngine, EngineEvent } from '../engine/index.js';
import type { TrackerPlugin } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';
import { ParallelExecutor, analyzeTaskGraph, shouldRunParallel } from '../parallel/index.js';
import type { ParallelEvent } from '../parallel/events.js';

/**
 * WebSocket data attached to each connection
 */
interface WebSocketData {
  ip: string;
}

/**
 * Connected client state
 */
interface ClientState {
  /** Unique client identifier */
  id: string;

  /** Client IP address */
  ip: string;

  /** Whether the client has authenticated */
  authenticated: boolean;

  /** When the client connected (ISO 8601) */
  connectedAt: string;

  /** Whether the client is subscribed to engine events */
  subscribed: boolean;

  /** Event types to forward (empty means all) */
  subscribedEventTypes?: string[];

  /** US-6: Connection token issued to this client */
  connectionToken?: string;

  /** US-6: When the connection token expires (ISO 8601) */
  connectionTokenExpiresAt?: string;

  /** Whether the client is subscribed to parallel events */
  subscribedToParallel?: boolean;
}

/**
 * Orchestration session state for tracking active parallel execution.
 */
interface OrchestrationSession {
  /** Unique session ID */
  id: string;
  /** ParallelExecutor instance */
  executor: ParallelExecutor;
  /** Client ID that started the orchestration */
  clientId: string;
  /** Unsubscribe function for parallel events */
  unsubscribe: () => void;
  /** When the orchestration started */
  startedAt: string;
  /** Base config used to create the executor */
  baseConfig: RalphConfig;
  /** Status of the orchestration */
  status: 'running' | 'paused' | 'completed' | 'failed';
}

/**
 * Server options
 */
export interface RemoteServerOptions {
  /** Port to bind to (will try subsequent ports if in use) */
  port: number;

  /** Maximum number of ports to try if initial port is in use (default: 10) */
  maxPortRetries?: number;

  /** Whether a token is configured (determines bind host) */
  hasToken: boolean;

  /** Callback when server starts */
  onStart?: (state: RemoteServerState) => void;

  /** Callback when server stops */
  onStop?: () => void;

  /** Callback when a client connects */
  onConnect?: (clientId: string) => void;

  /** Callback when a client disconnects */
  onDisconnect?: (clientId: string) => void;

  /** Execution engine for remote control (US-4) */
  engine?: ExecutionEngine;

  /** Tracker plugin for task queries (US-4) */
  tracker?: TrackerPlugin;

  /** Agent plugin name (e.g., "claude", "opencode") */
  agentName?: string;

  /** Tracker plugin name (e.g., "beads", "json") */
  trackerName?: string;

  /** Current model being used (provider/model format) */
  currentModel?: string;

  /** Whether auto-commit is enabled */
  autoCommit?: boolean;

  /** Sandbox configuration for display */
  sandboxConfig?: {
    enabled: boolean;
    mode?: 'auto' | 'bwrap' | 'sandbox-exec' | 'off';
    network?: boolean;
  };

  /** Resolved sandbox mode (when mode is 'auto') */
  resolvedSandboxMode?: 'bwrap' | 'sandbox-exec' | 'off';

  /** Git repository information */
  gitInfo?: {
    repoName?: string;
    branch?: string;
    isDirty?: boolean;
    commitHash?: string;
  };

  /** Current working directory */
  cwd?: string;

  /** Base config for parallel orchestration (required for orchestrate:start) */
  baseConfig?: RalphConfig;
}

/**
 * Generate a unique client ID
 */
function generateClientId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Create a WebSocket message with common fields
 */
function createMessage<T extends WSMessage>(type: T['type'], data: Omit<T, 'type' | 'id' | 'timestamp'>): T {
  return {
    type,
    id: generateMessageId(),
    timestamp: new Date().toISOString(),
    ...data,
  } as T;
}

/**
 * RemoteServer class for handling WebSocket connections.
 * US-4: Supports full remote control via engine integration.
 * US-6: Manages connection token lifecycle (issue, refresh, revoke, cleanup).
 */
export class RemoteServer {
  private server: Server<WebSocketData> | null = null;
  private clients: Map<ServerWebSocket<WebSocketData>, ClientState> = new Map();
  private options: RemoteServerOptions;
  private auditLogger: AuditLogger;
  private startedAt: string | null = null;
  /** Engine event listener unsubscribe function */
  private engineUnsubscribe: (() => void) | null = null;
  /** Token cleanup interval */
  private tokenCleanupInterval: ReturnType<typeof setInterval> | null = null;
  /** The actual port the server bound to (may differ from requested if port was in use) */
  private _actualPort: number | null = null;
  /** Active parallel orchestration session (only one at a time) */
  private orchestrationSession: OrchestrationSession | null = null;
  /** Guard flag to prevent race conditions during orchestration startup */
  private orchestrationStarting: boolean = false;

  constructor(options: RemoteServerOptions) {
    this.options = options;
    this.auditLogger = createAuditLogger();
    // Subscribe to engine events if engine is provided
    if (this.options.engine) {
      this.setupEngineSubscription();
    }
  }

  /**
   * Set the execution engine for remote control.
   * Can be called after construction to attach an engine.
   */
  setEngine(engine: ExecutionEngine): void {
    // Unsubscribe from old engine if present
    if (this.engineUnsubscribe) {
      this.engineUnsubscribe();
      this.engineUnsubscribe = null;
    }
    this.options.engine = engine;
    this.setupEngineSubscription();
  }

  /**
   * Set the tracker plugin for task queries.
   */
  setTracker(tracker: TrackerPlugin): void {
    this.options.tracker = tracker;
  }

  /**
   * Set the parallel config for orchestration.
   * Must be called before orchestrate:start can be used.
   */
  setParallelConfig(config: { baseConfig: RalphConfig; tracker: TrackerPlugin }): void {
    this.options.baseConfig = config.baseConfig;
    this.options.tracker = config.tracker;
  }

  /**
   * Get the actual port the server is bound to.
   * May differ from requested port if that port was in use.
   */
  get actualPort(): number | null {
    return this._actualPort;
  }

  /**
   * Subscribe to engine events and forward to subscribed clients.
   */
  private setupEngineSubscription(): void {
    if (!this.options.engine) return;

    this.engineUnsubscribe = this.options.engine.on((event: EngineEvent) => {
      this.broadcastEngineEvent(event);
    });
  }

  /**
   * Broadcast an engine event to all subscribed clients.
   */
  private broadcastEngineEvent(event: EngineEvent): void {
    for (const [ws, clientState] of this.clients) {
      if (!clientState.authenticated || !clientState.subscribed) continue;

      // Filter by event types if specified
      if (
        clientState.subscribedEventTypes &&
        clientState.subscribedEventTypes.length > 0 &&
        !clientState.subscribedEventTypes.includes(event.type)
      ) {
        continue;
      }

      const message = createMessage<EngineEventMessage>('engine_event', {
        event,
      });
      this.send(ws, message);
    }
  }

  /**
   * Start the WebSocket server.
   * If the requested port is in use, tries subsequent ports up to maxPortRetries.
   */
  async start(): Promise<RemoteServerState> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    // Determine host based on token configuration
    // If no token is configured, bind only to localhost for security
    // If token is configured, bind to all interfaces for remote access
    const host = this.options.hasToken ? '0.0.0.0' : '127.0.0.1';

    // Store reference to this for use in websocket handlers
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    // Create WebSocket handler
    const websocketHandler: WebSocketHandler<WebSocketData> = {
      open(ws: ServerWebSocket<WebSocketData>) {
        const clientId = generateClientId();
        const clientIp = ws.data?.ip ?? 'unknown';

        const state: ClientState = {
          id: clientId,
          ip: clientIp,
          authenticated: false,
          connectedAt: new Date().toISOString(),
          subscribed: false,
        };

        self.clients.set(ws, state);
        self.auditLogger.logConnection(`${clientId}@${clientIp}`, 'connect');
        self.options.onConnect?.(clientId);
      },

      message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
        const clientState = self.clients.get(ws);
        if (!clientState) {
          return;
        }

        self.handleMessage(ws, clientState, message.toString());
      },

      async close(ws: ServerWebSocket<WebSocketData>) {
        const clientState = self.clients.get(ws);
        if (clientState) {
          // Revoke any connection tokens for this client
          const clientId = `${clientState.id}@${clientState.ip}`;
          revokeClientTokens(clientId);

          // Stop orchestration if this client started it (prevent resource leak)
          if (self.orchestrationSession?.clientId === clientId) {
            // Await stop() to ensure cleanup completes before unsubscribing
            // (matches the handleOrchestrateStop pattern)
            await self.orchestrationSession.executor.stop().catch(() => {
              // Ignore errors during cleanup
            });
            self.orchestrationSession.unsubscribe();
            self.orchestrationSession = null;
          }

          self.auditLogger.logConnection(clientId, 'disconnect');
          self.options.onDisconnect?.(clientState.id);
          self.clients.delete(ws);
        }
      },
    };

    // Try binding to port, incrementing if in use
    const maxRetries = this.options.maxPortRetries ?? 10;
    let boundPort = this.options.port;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const tryPort = this.options.port + attempt;
      try {
        this.server = Bun.serve<WebSocketData>({
          port: tryPort,
          hostname: host,

          fetch(req, server) {
            // Upgrade HTTP request to WebSocket
            const clientIp = server.requestIP(req)?.address ?? 'unknown';

            if (server.upgrade(req, { data: { ip: clientIp } })) {
              return; // Upgrade successful
            }

            // Non-WebSocket request - return simple info
            return new Response(JSON.stringify({
              service: 'ralph-tui-remote',
              version: '0.2.1',
              websocket: true,
            }), {
              headers: { 'Content-Type': 'application/json' },
            });
          },

          websocket: websocketHandler,
        });

        // Success - record the port we bound to
        boundPort = tryPort;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Check if error is "address in use" - try next port
        // Bun's error has code property "EADDRINUSE" and message "Failed to start server. Is port X in use?"
        const errorMessage = lastError.message.toLowerCase();
        const errorCode = (error as { code?: string })?.code?.toLowerCase() ?? '';
        if (
          errorCode === 'eaddrinuse' ||
          errorMessage.includes('eaddrinuse') ||
          errorMessage.includes('address already in use') ||
          errorMessage.includes('address in use') ||
          errorMessage.includes('is port')
        ) {
          continue;
        }
        // Different error - rethrow
        throw lastError;
      }
    }

    // If we still don't have a server after all retries, throw
    if (!this.server) {
      throw lastError ?? new Error(`Failed to bind to any port in range ${this.options.port}-${this.options.port + maxRetries - 1}`);
    }

    // Store the actual port we bound to
    this._actualPort = boundPort;
    this.startedAt = new Date().toISOString();

    const state: RemoteServerState = {
      running: true,
      port: boundPort,
      host,
      startedAt: this.startedAt,
      connectedClients: 0,
      pid: process.pid,
    };

    await this.auditLogger.logServerEvent('start', {
      port: boundPort,
      host,
      pid: process.pid,
      requestedPort: this.options.port !== boundPort ? this.options.port : undefined,
    });

    // Start periodic cleanup of expired connection tokens (every 5 minutes)
    this.tokenCleanupInterval = setInterval(() => {
      cleanupExpiredTokens();
    }, 5 * 60 * 1000);

    this.options.onStart?.(state);
    return state;
  }

  /**
   * Stop the WebSocket server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Stop token cleanup interval
    if (this.tokenCleanupInterval) {
      clearInterval(this.tokenCleanupInterval);
      this.tokenCleanupInterval = null;
    }

    // Unsubscribe from engine events
    if (this.engineUnsubscribe) {
      this.engineUnsubscribe();
      this.engineUnsubscribe = null;
    }

    // Close all client connections
    for (const [ws] of this.clients) {
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();

    this.server.stop();
    this.server = null;

    await this.auditLogger.logServerEvent('stop');
    this.options.onStop?.();
  }

  /**
   * Get current server state.
   */
  getState(): RemoteServerState | null {
    if (!this.server || !this.startedAt) {
      return null;
    }

    return {
      running: true,
      port: this._actualPort ?? this.options.port,
      host: this.options.hasToken ? '0.0.0.0' : '127.0.0.1',
      startedAt: this.startedAt,
      connectedClients: this.clients.size,
      pid: process.pid,
    };
  }

  /**
   * Handle an incoming WebSocket message.
   */
  private async handleMessage(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    rawMessage: string
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;
    let message: WSMessage;

    try {
      message = JSON.parse(rawMessage) as WSMessage;
    } catch {
      this.sendError(ws, 'INVALID_JSON', 'Invalid JSON message');
      await this.auditLogger.logFailure(clientId, 'message_parse', 'Invalid JSON');
      return;
    }

    // Handle authentication
    if (message.type === 'auth') {
      await this.handleAuth(ws, clientState, message as AuthMessage);
      return;
    }

    // Handle ping (allowed without auth for connection health checks)
    if (message.type === 'ping') {
      this.sendPong(ws, message.id);
      return;
    }

    // All other messages require authentication
    if (!clientState.authenticated) {
      this.sendError(ws, 'NOT_AUTHENTICATED', 'Authentication required');
      await this.auditLogger.logFailure(
        clientId,
        'unauthorized_message',
        'Not authenticated',
        { messageType: message.type }
      );
      return;
    }

    // Handle authenticated messages
    switch (message.type) {
      case 'status':
        this.sendStatus(ws);
        break;

      // US-4: Subscription management
      case 'subscribe':
        this.handleSubscribe(ws, clientState, message as SubscribeMessage);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(ws, clientState, message as UnsubscribeMessage);
        break;

      // US-4: State queries
      case 'get_state':
        this.handleGetState(ws, message as GetStateMessage);
        break;
      case 'get_tasks':
        await this.handleGetTasks(ws, message as GetTasksMessage);
        break;

      // US-4: Engine control operations
      case 'pause':
        this.handlePause(ws, message as PauseMessage);
        break;
      case 'resume':
        this.handleResume(ws, message as ResumeMessage);
        break;
      case 'interrupt':
        this.handleInterrupt(ws, message as InterruptMessage);
        break;
      case 'refresh_tasks':
        this.handleRefreshTasks(ws, message as RefreshTasksMessage);
        break;
      case 'add_iterations':
        await this.handleAddIterations(ws, message as AddIterationsMessage);
        break;
      case 'remove_iterations':
        await this.handleRemoveIterations(ws, message as RemoveIterationsMessage);
        break;
      case 'continue':
        this.handleContinue(ws, message as ContinueMessage);
        break;

      // US-6: Token management
      case 'token_refresh':
        this.handleTokenRefresh(ws, clientState, message as TokenRefreshMessage);
        break;

      // Prompt preview and iteration output queries
      case 'get_prompt_preview':
        await this.handleGetPromptPreview(ws, message as GetPromptPreviewMessage);
        break;
      case 'get_iteration_output':
        this.handleGetIterationOutput(ws, message as GetIterationOutputMessage);
        break;

      // Config push operations
      case 'check_config':
        await this.handleCheckConfig(ws, message as CheckConfigMessage);
        break;
      case 'push_config':
        await this.handlePushConfig(ws, clientState, message as PushConfigMessage);
        break;

      // Parallel orchestration operations
      case 'orchestrate:start':
        await this.handleOrchestrateStart(ws, clientState, message as OrchestrateStartMessage);
        break;
      case 'orchestrate:pause':
        this.handleOrchestratePause(ws, message as OrchestratePauseMessage);
        break;
      case 'orchestrate:resume':
        this.handleOrchestrateResume(ws, message as OrchestrateResumeMessage);
        break;
      case 'orchestrate:stop':
        await this.handleOrchestrateStop(ws, message as OrchestrateStopMessage);
        break;
      case 'orchestrate:get_state':
        this.handleOrchestrateGetState(ws, message as OrchestrateGetStateMessage);
        break;

      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`);
    }
  }

  // ============================================================================
  // US-4: Remote Control Message Handlers
  // ============================================================================

  /**
   * Handle subscribe request - start forwarding engine events to client.
   */
  private handleSubscribe(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: SubscribeMessage
  ): void {
    clientState.subscribed = true;
    clientState.subscribedEventTypes = message.eventTypes;

    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'subscribe',
      success: true,
    });
    response.id = message.id; // Correlate response with request
    this.send(ws, response);
  }

  /**
   * Handle unsubscribe request - stop forwarding engine events.
   */
  private handleUnsubscribe(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: UnsubscribeMessage
  ): void {
    clientState.subscribed = false;
    clientState.subscribedEventTypes = undefined;

    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'unsubscribe',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle get_state request - return current engine state.
   */
  private handleGetState(ws: ServerWebSocket<WebSocketData>, message: GetStateMessage): void {
    if (!this.options.engine) {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'get_state',
        success: false,
        error: 'No engine attached to server',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    const engineState = this.options.engine.getState();
    const iterationInfo = this.options.engine.getIterationInfo();

    // Convert to remote-serializable state
    const remoteState: RemoteEngineState = {
      status: engineState.status,
      currentIteration: engineState.currentIteration,
      currentTask: engineState.currentTask,
      totalTasks: engineState.totalTasks,
      tasksCompleted: engineState.tasksCompleted,
      iterations: engineState.iterations,
      startedAt: engineState.startedAt,
      currentOutput: engineState.currentOutput,
      currentStderr: engineState.currentStderr,
      activeAgent: engineState.activeAgent,
      rateLimitState: engineState.rateLimitState,
      maxIterations: iterationInfo.maxIterations,
      tasks: [], // Will be populated by get_tasks
      // Include config info for remote TUI display
      agentName: this.options.agentName,
      trackerName: this.options.trackerName,
      currentModel: this.options.currentModel,
      // Include subagent tree for TUI rendering
      subagentTree: this.options.engine.getSubagentTree(),
      // Include config settings for TUI display
      autoCommit: this.options.autoCommit,
      // Include sandbox info for TUI display
      sandboxConfig: this.options.sandboxConfig,
      resolvedSandboxMode: this.options.resolvedSandboxMode,
      // Include git info for TUI display
      gitInfo: this.options.gitInfo,
      // Include cwd for TUI display
      cwd: this.options.cwd,
    };

    const response = createMessage<StateResponseMessage>('state_response', {
      state: remoteState,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle get_tasks request - return task list from tracker.
   */
  private async handleGetTasks(ws: ServerWebSocket<WebSocketData>, message: GetTasksMessage): Promise<void> {
    if (!this.options.tracker) {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'get_tasks',
        success: false,
        error: 'No tracker attached to server',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    try {
      const tasks = await this.options.tracker.getTasks();
      const response = createMessage<TasksResponseMessage>('tasks_response', {
        tasks,
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'get_tasks',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get tasks',
      });
      response.id = message.id;
      this.send(ws, response);
    }
  }

  /**
   * Handle pause request - pause the engine.
   */
  private handlePause(ws: ServerWebSocket<WebSocketData>, message: PauseMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'pause', 'No engine attached');
      return;
    }

    this.options.engine.pause();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'pause',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle resume request - resume the engine.
   */
  private handleResume(ws: ServerWebSocket<WebSocketData>, message: ResumeMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'resume', 'No engine attached');
      return;
    }

    this.options.engine.resume();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'resume',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle interrupt request - interrupt/cancel current iteration.
   * Uses engine.stop() which interrupts the current execution.
   */
  private handleInterrupt(ws: ServerWebSocket<WebSocketData>, message: InterruptMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'interrupt', 'No engine attached');
      return;
    }

    // stop() interrupts the current execution and emits engine:stopped with reason: 'interrupted'
    this.options.engine.stop().then(() => {
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'interrupt',
        success: true,
      });
      response.id = message.id;
      this.send(ws, response);
    }).catch((error) => {
      this.sendOperationError(
        ws,
        message.id,
        'interrupt',
        error instanceof Error ? error.message : 'Failed to interrupt'
      );
    });
  }

  /**
   * Handle refresh_tasks request - refresh task list from tracker.
   */
  private handleRefreshTasks(ws: ServerWebSocket<WebSocketData>, message: RefreshTasksMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'refresh_tasks', 'No engine attached');
      return;
    }

    this.options.engine.refreshTasks();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'refresh_tasks',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle add_iterations request - add iterations to engine.
   */
  private async handleAddIterations(
    ws: ServerWebSocket<WebSocketData>,
    message: AddIterationsMessage
  ): Promise<void> {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'add_iterations', 'No engine attached');
      return;
    }

    // Validate iteration count
    if (typeof message.count !== 'number' || !Number.isInteger(message.count) || message.count <= 0) {
      this.sendOperationError(ws, message.id, 'add_iterations', 'Invalid iteration count');
      return;
    }

    try {
      const shouldContinue = await this.options.engine.addIterations(message.count);
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'add_iterations',
        success: true,
        data: { shouldContinue },
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      this.sendOperationError(
        ws,
        message.id,
        'add_iterations',
        error instanceof Error ? error.message : 'Failed to add iterations'
      );
    }
  }

  /**
   * Handle remove_iterations request - remove iterations from engine.
   */
  private async handleRemoveIterations(
    ws: ServerWebSocket<WebSocketData>,
    message: RemoveIterationsMessage
  ): Promise<void> {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'remove_iterations', 'No engine attached');
      return;
    }

    // Validate iteration count
    if (typeof message.count !== 'number' || !Number.isInteger(message.count) || message.count <= 0) {
      this.sendOperationError(ws, message.id, 'remove_iterations', 'Invalid iteration count');
      return;
    }

    try {
      const success = await this.options.engine.removeIterations(message.count);
      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'remove_iterations',
        success,
        error: success ? undefined : 'Cannot reduce below current iteration or minimum',
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      this.sendOperationError(
        ws,
        message.id,
        'remove_iterations',
        error instanceof Error ? error.message : 'Failed to remove iterations'
      );
    }
  }

  /**
   * Handle continue request - continue execution after pause/stop.
   */
  private handleContinue(ws: ServerWebSocket<WebSocketData>, message: ContinueMessage): void {
    if (!this.options.engine) {
      this.sendOperationError(ws, message.id, 'continue', 'No engine attached');
      return;
    }

    this.options.engine.continueExecution();
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'continue',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle get_prompt_preview request - generate a prompt preview for a task.
   */
  private async handleGetPromptPreview(
    ws: ServerWebSocket<WebSocketData>,
    message: GetPromptPreviewMessage
  ): Promise<void> {
    if (!this.options.engine) {
      const response = createMessage<PromptPreviewResponseMessage>('prompt_preview_response', {
        success: false,
        error: 'No engine attached to server',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    try {
      const result = await this.options.engine.generatePromptPreview(message.taskId);
      const response = createMessage<PromptPreviewResponseMessage>('prompt_preview_response', {
        success: result.success,
        prompt: result.success ? result.prompt : undefined,
        source: result.success ? result.source : undefined,
        error: result.success ? undefined : result.error,
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      const response = createMessage<PromptPreviewResponseMessage>('prompt_preview_response', {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate prompt preview',
      });
      response.id = message.id;
      this.send(ws, response);
    }
  }

  /**
   * Handle get_iteration_output request - get iteration output for a task.
   * Checks both in-memory iterations and current execution state.
   */
  private handleGetIterationOutput(
    ws: ServerWebSocket<WebSocketData>,
    message: GetIterationOutputMessage
  ): void {
    if (!this.options.engine) {
      const response = createMessage<IterationOutputResponseMessage>('iteration_output_response', {
        success: false,
        taskId: message.taskId,
        error: 'No engine attached to server',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    const engineState = this.options.engine.getState();
    const taskId = message.taskId;

    // Check if this is the currently executing task
    if (engineState.currentTask?.id === taskId && engineState.status === 'running') {
      const response = createMessage<IterationOutputResponseMessage>('iteration_output_response', {
        success: true,
        taskId,
        iteration: engineState.currentIteration,
        output: engineState.currentOutput,
        isRunning: true,
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    // Check in-memory completed iterations (most recent first)
    const taskIteration = [...engineState.iterations].reverse().find((iter) => iter.task.id === taskId);
    if (taskIteration) {
      const response = createMessage<IterationOutputResponseMessage>('iteration_output_response', {
        success: true,
        taskId,
        iteration: taskIteration.iteration,
        output: taskIteration.agentResult?.stdout ?? '',
        startedAt: taskIteration.startedAt,
        endedAt: taskIteration.endedAt,
        durationMs: taskIteration.durationMs,
        isRunning: taskIteration.status === 'running',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    // No iteration found for this task
    const response = createMessage<IterationOutputResponseMessage>('iteration_output_response', {
      success: false,
      taskId,
      error: 'No iteration found for this task',
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Helper to send an operation error response.
   */
  private sendOperationError(
    ws: ServerWebSocket<WebSocketData>,
    requestId: string,
    operation: string,
    error: string
  ): void {
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation,
      success: false,
      error,
    });
    response.id = requestId;
    this.send(ws, response);
  }

  // ============================================================================
  // Config Push Handlers
  // ============================================================================

  /**
   * Handle check_config request - check what config exists on this remote.
   * Returns info about global and project config existence and content.
   */
  private async handleCheckConfig(
    ws: ServerWebSocket<WebSocketData>,
    message: CheckConfigMessage
  ): Promise<void> {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { access, readFile, constants } = await import('node:fs/promises');

    const globalPath = join(homedir(), '.config', 'ralph-tui', 'config.toml');
    const cwd = process.cwd();
    const projectPath = join(cwd, '.ralph-tui', 'config.toml');

    let globalExists = false;
    let projectExists = false;
    let globalContent: string | undefined;
    let projectContent: string | undefined;

    // Check global config
    try {
      await access(globalPath, constants.R_OK);
      globalExists = true;
      globalContent = await readFile(globalPath, 'utf-8');
    } catch {
      // Global config doesn't exist or isn't readable
    }

    // Check project config
    try {
      await access(projectPath, constants.R_OK);
      projectExists = true;
      projectContent = await readFile(projectPath, 'utf-8');
    } catch {
      // Project config doesn't exist or isn't readable
    }

    const response = createMessage<CheckConfigResponseMessage>('check_config_response', {
      globalExists,
      projectExists,
      globalPath: globalExists ? globalPath : undefined,
      projectPath: projectExists ? projectPath : undefined,
      globalContent,
      projectContent,
      remoteCwd: cwd,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle push_config request - write config to the remote.
   * Creates backup if overwriting, validates TOML, and optionally triggers migration.
   */
  private async handlePushConfig(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: PushConfigMessage
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;
    const { homedir } = await import('node:os');
    const { join, dirname } = await import('node:path');
    const { access, readFile, writeFile, mkdir, constants } = await import('node:fs/promises');
    const { parse: parseToml } = await import('smol-toml');

    const cwd = process.cwd();
    let configPath: string;

    if (message.scope === 'global') {
      configPath = join(homedir(), '.config', 'ralph-tui', 'config.toml');
    } else {
      configPath = join(cwd, '.ralph-tui', 'config.toml');
    }

    // Validate TOML syntax
    try {
      parseToml(message.configContent);
    } catch (error) {
      const response = createMessage<PushConfigResponseMessage>('push_config_response', {
        success: false,
        error: `Invalid TOML: ${error instanceof Error ? error.message : 'Parse error'}`,
      });
      response.id = message.id;
      this.send(ws, response);
      await this.auditLogger.logFailure(clientId, 'push_config', 'Invalid TOML', {
        scope: message.scope,
      });
      return;
    }

    // Check if config exists
    let configExists = false;
    try {
      await access(configPath, constants.R_OK);
      configExists = true;
    } catch {
      // Config doesn't exist
    }

    // If config exists and overwrite not allowed, return error
    if (configExists && !message.overwrite) {
      const response = createMessage<PushConfigResponseMessage>('push_config_response', {
        success: false,
        error: `Config already exists at ${configPath}. Use overwrite=true to replace.`,
        configPath,
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    let backupPath: string | undefined;

    // Create backup if overwriting existing config
    if (configExists && message.overwrite) {
      try {
        const existingContent = await readFile(configPath, 'utf-8');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = `${configPath}.backup.${timestamp}`;
        await writeFile(backupPath, existingContent, 'utf-8');
      } catch (error) {
        const response = createMessage<PushConfigResponseMessage>('push_config_response', {
          success: false,
          error: `Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
        response.id = message.id;
        this.send(ws, response);
        await this.auditLogger.logFailure(clientId, 'push_config', 'Backup failed', {
          scope: message.scope,
        });
        return;
      }
    }

    // Ensure directory exists
    try {
      await mkdir(dirname(configPath), { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Write the new config
    try {
      await writeFile(configPath, message.configContent, 'utf-8');
    } catch (error) {
      const response = createMessage<PushConfigResponseMessage>('push_config_response', {
        success: false,
        error: `Failed to write config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      response.id = message.id;
      this.send(ws, response);
      await this.auditLogger.logFailure(clientId, 'push_config', 'Write failed', {
        scope: message.scope,
        configPath,
      });
      return;
    }

    // Check if engine is running (requires restart for changes to take effect)
    const requiresRestart = this.options.engine !== undefined &&
      this.options.engine.getState().status !== 'idle';

    // Trigger auto-migration in background (don't wait for it)
    let migrationTriggered = false;
    try {
      const { checkAndMigrate } = await import('../setup/migration.js');
      // Run migration in background - don't await
      checkAndMigrate(cwd, { quiet: true }).then((result) => {
        if (result?.migrated) {
          // Migration was performed
        }
      }).catch(() => {
        // Migration failed, but config was still written successfully
      });
      migrationTriggered = true;
    } catch {
      // Migration module not available
    }

    // Log the action
    await this.auditLogger.logAction(clientId, 'push_config', true, undefined, {
      scope: message.scope,
      configPath,
      backupPath,
      overwrite: message.overwrite,
    });

    const response = createMessage<PushConfigResponseMessage>('push_config_response', {
      success: true,
      configPath,
      backupPath,
      migrationTriggered,
      requiresRestart,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  // ============================================================================
  // Parallel Orchestration Handlers
  // ============================================================================

  /**
   * Handle orchestrate:start request - start parallel execution.
   */
  private async handleOrchestrateStart(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: OrchestrateStartMessage
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;

    // Check if orchestration is already running or starting (prevents race conditions)
    if (this.orchestrationSession || this.orchestrationStarting) {
      const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
        success: false,
        error: 'Orchestration already in progress',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    // Set the starting guard before any async operations to prevent concurrent starts
    this.orchestrationStarting = true;

    // Check if we have the required config
    if (!this.options.baseConfig || !this.options.tracker) {
      this.orchestrationStarting = false;
      const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
        success: false,
        error: 'Parallel config not set. Call setParallelConfig() first.',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    try {
      // Check if filteredTaskIds is explicitly an empty array (no tasks match filter)
      const filteredTaskIds = this.options.baseConfig.filteredTaskIds;
      if (filteredTaskIds !== undefined && filteredTaskIds.length === 0) {
        this.orchestrationStarting = false;
        const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
          success: false,
          error: 'No tasks match the specified filter',
        });
        response.id = message.id;
        this.send(ws, response);
        return;
      }

      // Fetch tasks from tracker
      let tasks = await this.options.tracker.getTasks({ status: ['open', 'in_progress'] });

      // Apply filteredTaskIds filter if specified in baseConfig (non-empty array)
      if (filteredTaskIds && filteredTaskIds.length > 0) {
        const allowedIds = new Set(filteredTaskIds);
        tasks = tasks.filter((t) => allowedIds.has(t.id));
      }

      if (tasks.length === 0) {
        this.orchestrationStarting = false;
        const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
          success: false,
          error: filteredTaskIds?.length ? 'No tasks match the specified filter' : 'No actionable tasks found',
        });
        response.id = message.id;
        this.send(ws, response);
        return;
      }

      // Analyze task graph (using filtered tasks)
      const analysis = analyzeTaskGraph(tasks);

      if (!shouldRunParallel(analysis)) {
        this.orchestrationStarting = false;
        const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
          success: false,
          error: 'Tasks not suitable for parallel execution (too few tasks or too many dependencies)',
        });
        response.id = message.id;
        this.send(ws, response);
        return;
      }

      // Create orchestration ID
      const orchestrationId = `orch-${Date.now().toString(36)}`;

      // Validate and determine maxWorkers (must be a positive integer)
      let maxWorkers = message.maxWorkers ?? 3;
      if (typeof maxWorkers !== 'number' || !Number.isInteger(maxWorkers) || maxWorkers < 1) {
        this.orchestrationStarting = false;
        const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
          success: false,
          error: `Invalid maxWorkers value: ${message.maxWorkers}. Must be a positive integer.`,
        });
        response.id = message.id;
        this.send(ws, response);
        return;
      }

      // Create ParallelExecutor with validated options
      // Pass filteredTaskIds so executor only schedules those tasks
      const executor = new ParallelExecutor(
        this.options.baseConfig,
        this.options.tracker,
        {
          maxWorkers,
          directMerge: message.directMerge ?? false,
          maxIterationsPerWorker: message.maxIterations ?? this.options.baseConfig.maxIterations,
          filteredTaskIds: filteredTaskIds?.length ? filteredTaskIds : undefined,
        }
      );

      // Subscribe to parallel events and forward to clients
      const unsubscribe = executor.on((event: ParallelEvent) => {
        this.broadcastParallelEvent(orchestrationId, event);

        // Update session status based on event type
        if (this.orchestrationSession) {
          if (event.type === 'parallel:completed') {
            this.orchestrationSession.status = 'completed';
          } else if (event.type === 'parallel:failed') {
            this.orchestrationSession.status = 'failed';
          }
        }
      });

      // Store session
      //
      // Design note: The orchestrationSession intentionally persists after execution
      // completes (status changes to 'completed' or 'failed'). This is because:
      //
      // 1. The executor subscription above (executor.on -> unsubscribe) only forwards
      //    events via broadcastParallelEvent and updates orchestrationSession.status.
      //    It does NOT clean up the session on completion.
      //
      // 2. Keeping the session object allows clients to call "orchestrate:get_state"
      //    to inspect the final state (completed/failed status, worker states, etc.)
      //    after execution finishes.
      //
      // 3. Actual cleanup happens in the close() handler when the originating client
      //    disconnects - that handler stops the executor and clears orchestrationSession.
      //    Clients can also explicitly stop via "orchestrate:stop".
      //
      this.orchestrationSession = {
        id: orchestrationId,
        executor,
        clientId,
        unsubscribe,
        startedAt: new Date().toISOString(),
        baseConfig: this.options.baseConfig,
        status: 'running',
      };

      // Clear the starting guard now that session is established
      this.orchestrationStarting = false;

      // Mark requesting client as subscribed to parallel events
      clientState.subscribedToParallel = true;

      // Send success response before starting execution
      const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
        success: true,
        orchestrationId,
        totalTasks: analysis.actionableTaskCount,
        totalGroups: analysis.groups.length,
        maxParallelism: analysis.maxParallelism,
      });
      response.id = message.id;
      this.send(ws, response);

      // Log the action
      await this.auditLogger.logAction(clientId, 'orchestrate:start', true, undefined, {
        orchestrationId,
        totalTasks: analysis.actionableTaskCount,
        maxWorkers,
      });

      // Start execution asynchronously (don't await - it runs in background)
      executor.execute().catch(async (error) => {
        if (this.orchestrationSession?.id === orchestrationId) {
          this.orchestrationSession.status = 'failed';
        }
        await this.auditLogger.logFailure(clientId, 'orchestrate:execute', error.message);
      });

    } catch (error) {
      this.orchestrationStarting = false;
      const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start orchestration',
      });
      response.id = message.id;
      this.send(ws, response);
      await this.auditLogger.logFailure(clientId, 'orchestrate:start', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Handle orchestrate:pause request - pause parallel execution.
   */
  private handleOrchestratePause(
    ws: ServerWebSocket<WebSocketData>,
    message: OrchestratePauseMessage
  ): void {
    if (!this.orchestrationSession || this.orchestrationSession.id !== message.orchestrationId) {
      this.sendOperationError(ws, message.id, 'orchestrate:pause', 'No matching orchestration session');
      return;
    }

    this.orchestrationSession.executor.pause();
    this.orchestrationSession.status = 'paused';

    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'orchestrate:pause',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle orchestrate:resume request - resume paused parallel execution.
   */
  private handleOrchestrateResume(
    ws: ServerWebSocket<WebSocketData>,
    message: OrchestrateResumeMessage
  ): void {
    if (!this.orchestrationSession || this.orchestrationSession.id !== message.orchestrationId) {
      this.sendOperationError(ws, message.id, 'orchestrate:resume', 'No matching orchestration session');
      return;
    }

    this.orchestrationSession.executor.resume();
    this.orchestrationSession.status = 'running';

    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'orchestrate:resume',
      success: true,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Handle orchestrate:stop request - stop parallel execution.
   */
  private async handleOrchestrateStop(
    ws: ServerWebSocket<WebSocketData>,
    message: OrchestrateStopMessage
  ): Promise<void> {
    if (!this.orchestrationSession || this.orchestrationSession.id !== message.orchestrationId) {
      this.sendOperationError(ws, message.id, 'orchestrate:stop', 'No matching orchestration session');
      return;
    }

    try {
      await this.orchestrationSession.executor.stop();
      this.orchestrationSession.unsubscribe();
      this.orchestrationSession = null;

      const response = createMessage<OperationResultMessage>('operation_result', {
        operation: 'orchestrate:stop',
        success: true,
      });
      response.id = message.id;
      this.send(ws, response);
    } catch (error) {
      this.sendOperationError(
        ws,
        message.id,
        'orchestrate:stop',
        error instanceof Error ? error.message : 'Failed to stop orchestration'
      );
    }
  }

  /**
   * Handle orchestrate:get_state request - get current orchestration state.
   */
  private handleOrchestrateGetState(
    ws: ServerWebSocket<WebSocketData>,
    message: OrchestrateGetStateMessage
  ): void {
    if (!this.orchestrationSession || this.orchestrationSession.id !== message.orchestrationId) {
      const response = createMessage<OrchestrateStateResponseMessage>('orchestrate:state_response', {
        success: false,
        error: 'No matching orchestration session',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    const executorState = this.orchestrationSession.executor.getState();

    const state: RemoteOrchestrationState = {
      orchestrationId: this.orchestrationSession.id,
      status: this.orchestrationSession.status,
      currentGroupIndex: executorState.currentGroupIndex,
      totalGroups: executorState.totalGroups,
      workers: executorState.workers,
      mergeQueue: executorState.mergeQueue,
      totalTasksCompleted: executorState.totalTasksCompleted,
      totalTasks: executorState.totalTasks,
      startedAt: executorState.startedAt,
      elapsedMs: executorState.elapsedMs,
      sessionBranch: this.orchestrationSession.executor.getSessionBranch() ?? undefined,
      originalBranch: this.orchestrationSession.executor.getOriginalBranch() ?? undefined,
    };

    const response = createMessage<OrchestrateStateResponseMessage>('orchestrate:state_response', {
      success: true,
      state,
    });
    response.id = message.id;
    this.send(ws, response);
  }

  /**
   * Broadcast a parallel event to all clients subscribed to parallel events.
   */
  private broadcastParallelEvent(orchestrationId: string, event: ParallelEvent): void {
    for (const [ws, clientState] of this.clients) {
      if (!clientState.authenticated || !clientState.subscribedToParallel) continue;

      const message = createMessage<ParallelEventMessage>('parallel_event', {
        orchestrationId,
        event,
      });
      this.send(ws, message);
    }
  }

  /**
   * Handle authentication request.
   * Supports both server token (initial auth) and connection token (re-auth).
   * On successful server token auth, issues a short-lived connection token.
   */
  private async handleAuth(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: AuthMessage
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;
    const tokenType = message.tokenType ?? 'server';

    if (tokenType === 'connection') {
      // Re-auth with existing connection token
      const validation = validateConnectionToken(message.token);

      if (validation.valid) {
        clientState.authenticated = true;
        clientState.connectionToken = message.token;

        const response = createMessage<AuthResponseMessage>('auth_response', {
          success: true,
        });
        this.send(ws, response);

        await this.auditLogger.logAuth(clientId, true, undefined, { tokenType: 'connection' });
      } else {
        // Connection token invalid/expired - client should re-auth with server token
        const response = createMessage<AuthResponseMessage>('auth_response', {
          success: false,
          error: validation.error ?? 'Connection token invalid',
        });
        this.send(ws, response);

        await this.auditLogger.logAuth(clientId, false, validation.error ?? 'Connection token invalid');
      }
    } else {
      // Initial auth with server token
      const validation = await validateServerToken(message.token);

      if (validation.valid) {
        clientState.authenticated = true;

        // Issue a short-lived connection token
        const connToken = issueConnectionToken(clientId);
        clientState.connectionToken = connToken.value;
        clientState.connectionTokenExpiresAt = connToken.expiresAt;

        const response = createMessage<AuthResponseMessage>('auth_response', {
          success: true,
          connectionToken: connToken.value,
          connectionTokenExpiresAt: connToken.expiresAt,
        });
        this.send(ws, response);

        await this.auditLogger.logAuth(clientId, true, undefined, { tokenType: 'server' });
      } else {
        const response = createMessage<AuthResponseMessage>('auth_response', {
          success: false,
          error: validation.error ?? 'Invalid token',
        });
        this.send(ws, response);

        await this.auditLogger.logAuth(
          clientId,
          false,
          validation.error ?? 'Invalid token',
          { expired: validation.expired }
        );
      }
    }
  }

  /**
   * Handle token refresh request.
   * Issues a new connection token if the current one is still valid.
   */
  private handleTokenRefresh(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: TokenRefreshMessage
  ): void {
    const clientId = `${clientState.id}@${clientState.ip}`;

    // Verify the provided token matches what we have for this client
    if (message.connectionToken !== clientState.connectionToken) {
      const response = createMessage<TokenRefreshResponseMessage>('token_refresh_response', {
        success: false,
        error: 'Connection token mismatch',
      });
      response.id = message.id;
      this.send(ws, response);
      return;
    }

    // Refresh the token
    const newToken = refreshConnectionToken(message.connectionToken);

    if (newToken) {
      clientState.connectionToken = newToken.value;
      clientState.connectionTokenExpiresAt = newToken.expiresAt;

      const response = createMessage<TokenRefreshResponseMessage>('token_refresh_response', {
        success: true,
        connectionToken: newToken.value,
        connectionTokenExpiresAt: newToken.expiresAt,
      });
      response.id = message.id;
      this.send(ws, response);

      this.auditLogger.logAction(clientId, 'token_refresh', true);
    } else {
      const response = createMessage<TokenRefreshResponseMessage>('token_refresh_response', {
        success: false,
        error: 'Token refresh failed',
      });
      response.id = message.id;
      this.send(ws, response);

      this.auditLogger.logAction(clientId, 'token_refresh', false, 'Token refresh failed');
    }
  }

  /**
   * Send a pong response.
   */
  private sendPong(ws: ServerWebSocket<WebSocketData>, requestId: string): void {
    const response = createMessage<PongMessage>('pong', {});
    // Keep the same ID as the ping request
    response.id = requestId;
    this.send(ws, response);
  }

  /**
   * Send server status.
   */
  private sendStatus(ws: ServerWebSocket<WebSocketData>): void {
    const uptime = this.startedAt
      ? (Date.now() - new Date(this.startedAt).getTime()) / 1000
      : 0;

    const response = createMessage<ServerStatusMessage>('server_status', {
      version: '0.2.1',
      uptime,
      connectedClients: this.clients.size,
    });
    this.send(ws, response);
  }

  /**
   * Send an error message.
   */
  private sendError(ws: ServerWebSocket<WebSocketData>, code: string, message: string): void {
    const response = createMessage<ErrorMessage>('error', {
      code,
      message,
    });
    this.send(ws, response);
  }

  /**
   * Send a message to a WebSocket client.
   */
  private send(ws: ServerWebSocket<WebSocketData>, message: WSMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Client may have disconnected
    }
  }
}

/**
 * Create and start a remote server.
 */
export async function createRemoteServer(
  options: Partial<RemoteServerOptions> = {}
): Promise<RemoteServer> {
  // Check if token exists and is valid
  const { token, isNew } = await getOrCreateServerToken();
  const hasToken = !isNew || token.value.length > 0;

  const serverOptions: RemoteServerOptions = {
    port: options.port ?? 7890,
    maxPortRetries: options.maxPortRetries,
    hasToken,
    onStart: options.onStart,
    onStop: options.onStop,
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    engine: options.engine,
    tracker: options.tracker,
    agentName: options.agentName,
    trackerName: options.trackerName,
    currentModel: options.currentModel,
    autoCommit: options.autoCommit,
    sandboxConfig: options.sandboxConfig,
    resolvedSandboxMode: options.resolvedSandboxMode,
    gitInfo: options.gitInfo,
    cwd: options.cwd,
    baseConfig: options.baseConfig,
  };

  return new RemoteServer(serverOptions);
}
