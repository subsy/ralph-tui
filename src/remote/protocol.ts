/**
 * ABOUTME: Protocol documentation for ralph-tui remote WebSocket API.
 * Describes message types, authentication flow, and orchestration commands.
 *
 * ## Connection Flow
 *
 * 1. Client connects to WebSocket server (default: ws://localhost:7890)
 * 2. Client sends `auth` message with server token
 * 3. Server responds with `auth_response` containing connection token
 * 4. Client uses connection token for subsequent sessions
 *
 * ## Message Format
 *
 * All messages are JSON with base fields:
 * - `type`: string - message type identifier
 * - `id`: string - unique message ID for request/response correlation
 * - `timestamp`: string - ISO 8601 timestamp
 *
 * ## Engine Control Messages
 *
 * - `subscribe` - Start receiving engine events
 * - `unsubscribe` - Stop receiving engine events
 * - `get_state` - Get current engine state
 * - `get_tasks` - Get task list from tracker
 * - `pause` - Pause engine execution
 * - `resume` - Resume engine execution
 * - `interrupt` - Cancel current iteration
 * - `add_iterations` - Add iterations to engine
 * - `remove_iterations` - Remove iterations from engine
 * - `continue` - Continue execution after pause/stop
 *
 * ## Orchestration Messages (US-011)
 *
 * ### orchestrate:start
 * Start a new orchestration run.
 * ```json
 * {
 *   "type": "orchestrate:start",
 *   "id": "...",
 *   "timestamp": "...",
 *   "prdPath": "/path/to/prd.json",
 *   "maxWorkers": 3,
 *   "headless": true
 * }
 * ```
 * Response: `orchestrate:start_response` with `success` boolean.
 *
 * ### orchestrate:status
 * Query current orchestration status.
 * ```json
 * { "type": "orchestrate:status", "id": "...", "timestamp": "..." }
 * ```
 * Response: `orchestrate:status_response` with:
 * - `status`: "idle" | "running" | "paused" | "completed" | "failed"
 * - `currentPhase`: current phase name
 * - `currentPhaseIndex`: 0-based phase index
 * - `totalPhases`: total number of phases
 * - `workers`: array of WorkerState objects
 * - `completedTasks`: number of completed tasks
 * - `totalTasks`: total task count
 * - `startedAt`: ISO 8601 timestamp
 *
 * ### orchestrate:pause
 * Pause the current orchestration.
 * Response: `operation_result` with `operation: "orchestrate:pause"`.
 *
 * ### orchestrate:resume
 * Resume a paused orchestration.
 * Response: `operation_result` with `operation: "orchestrate:resume"`.
 *
 * ## Orchestrator Events
 *
 * When subscribed, clients receive `orchestrator_event` messages:
 * - `worker:started` - Worker process started
 * - `worker:progress` - Worker progress update
 * - `worker:completed` - Worker finished successfully
 * - `worker:failed` - Worker encountered error
 * - `phase:started` - Execution phase started
 * - `phase:completed` - Execution phase completed
 * - `orchestration:completed` - All phases complete
 *
 * ## Config Push Messages
 *
 * - `check_config` - Check existing config on remote
 * - `push_config` - Push config to remote
 *
 * ## Prompt/Output Messages
 *
 * - `get_prompt_preview` - Preview prompt for a task
 * - `get_iteration_output` - Get output from a completed iteration
 */

// Re-export types for protocol consumers
export type {
  // Base types
  WSMessage,
  AuthMessage,
  AuthResponseMessage,
  ErrorMessage,
  PingMessage,
  PongMessage,
  ServerStatusMessage,
  // Subscription
  SubscribeMessage,
  UnsubscribeMessage,
  EngineEventMessage,
  // State queries
  GetStateMessage,
  StateResponseMessage,
  RemoteEngineState,
  GetTasksMessage,
  TasksResponseMessage,
  // Engine control
  PauseMessage,
  ResumeMessage,
  InterruptMessage,
  RefreshTasksMessage,
  AddIterationsMessage,
  RemoveIterationsMessage,
  ContinueMessage,
  OperationResultMessage,
  // Orchestration (US-011)
  OrchestrateStartMessage,
  OrchestrateStartResponseMessage,
  OrchestrateStatusMessage,
  OrchestrateStatusResponseMessage,
  OrchestratePauseMessage,
  OrchestrateResumeMessage,
  OrchestratorEventMessage,
  RemoteOrchestratorState,
  OrchestratorStatus,
  // Config
  CheckConfigMessage,
  CheckConfigResponseMessage,
  PushConfigMessage,
  PushConfigResponseMessage,
  // Prompt/Output
  GetPromptPreviewMessage,
  PromptPreviewResponseMessage,
  GetIterationOutputMessage,
  IterationOutputResponseMessage,
  // Union type
  RemoteWSMessageType,
} from './types.js';
