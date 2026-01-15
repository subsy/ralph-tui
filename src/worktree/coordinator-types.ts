/**
 * ABOUTME: Type definitions for the Coordinator Process.
 * Defines message passing interfaces and agent status tracking
 * for agent-to-agent communication in parallel worktree execution.
 */

/**
 * Message types that agents can send to coordinate work.
 */
export type AgentMessageType =
  | 'discovery'
  | 'warning'
  | 'blocker'
  | 'complete'
  | 'failed';

/**
 * Status of an agent in the coordinator's view.
 */
export type AgentStatus =
  | 'idle'
  | 'working'
  | 'blocked'
  | 'complete'
  | 'failed';

/**
 * Categories for discovery payloads to classify what was found.
 */
export type DiscoveryCategory =
  | 'api_change'
  | 'schema_change'
  | 'dependency_update'
  | 'pattern_discovered'
  | 'conflict_detected'
  | 'test_failure'
  | 'other';

/**
 * Payload structure for agent messages.
 * Contains details about what the agent discovered or needs to communicate.
 */
export interface AgentMessagePayload {
  /** Category of the discovery or message */
  category: DiscoveryCategory | string;

  /** Brief summary of the message (human-readable) */
  summary: string;

  /** Detailed description of the discovery or issue */
  details: string;

  /** Files affected by this discovery */
  affectedFiles: string[];

  /** Optional metadata for extensibility */
  metadata?: Record<string, unknown>;
}

/**
 * Message structure for agent-to-agent communication.
 * All messages flow through the coordinator's message broker.
 */
export interface AgentMessage {
  /** Unique identifier for this message */
  id: string;

  /** Type of message being sent */
  type: AgentMessageType;

  /** ID of the agent sending this message */
  fromAgent: string;

  /** Optional target agent ID (if omitted, broadcasts to all) */
  toAgent?: string;

  /** Timestamp when the message was created */
  timestamp: Date;

  /** Message payload with details */
  payload: AgentMessagePayload;

  /** Correlation ID for tracking related messages */
  correlationId?: string;
}

/**
 * Tracked agent state in the coordinator.
 */
export interface TrackedAgent {
  /** Unique identifier for the agent */
  id: string;

  /** Human-readable name for the agent */
  name: string;

  /** Current status of the agent */
  status: AgentStatus;

  /** ID of the worktree this agent is using */
  worktreeId?: string;

  /** ID of the task this agent is working on */
  taskId?: string;

  /** Timestamp when the agent was registered */
  registeredAt: Date;

  /** Timestamp of last status update */
  lastStatusUpdate: Date;

  /** Timestamp of last heartbeat (for liveness detection) */
  lastHeartbeat: Date;

  /** Queue of pending messages for this agent */
  pendingMessages: AgentMessage[];
}

/**
 * Options for sending a message through the coordinator.
 */
export interface SendMessageOptions {
  /** Priority of the message (higher = more urgent) */
  priority?: number;

  /** Time-to-live in milliseconds (message expires after this) */
  ttlMs?: number;

  /** Whether to require acknowledgment from recipients */
  requireAck?: boolean;
}

/**
 * Result of sending a message through the coordinator.
 */
export interface SendMessageResult {
  /** Whether the message was sent successfully */
  success: boolean;

  /** The message that was sent (with generated ID and timestamp) */
  message: AgentMessage;

  /** Number of recipients the message was delivered to */
  recipientCount: number;

  /** Time taken to deliver the message in milliseconds */
  deliveryTimeMs: number;
}

/**
 * Message subscription for receiving messages.
 */
export interface MessageSubscription {
  /** Unique identifier for this subscription */
  id: string;

  /** Agent ID that owns this subscription */
  agentId: string;

  /** Filter for message types (empty = all types) */
  typeFilter: AgentMessageType[];

  /** Filter for source agents (empty = all agents) */
  fromAgentFilter: string[];

  /** Callback function when a message is received */
  callback: MessageCallback;

  /** Timestamp when subscription was created */
  createdAt: Date;
}

/**
 * Callback function type for message reception.
 */
export type MessageCallback = (message: AgentMessage) => void | Promise<void>;

/**
 * Events emitted by the coordinator.
 */
export type CoordinatorEvent =
  | { type: 'agent_registered'; agent: TrackedAgent }
  | { type: 'agent_unregistered'; agentId: string }
  | { type: 'agent_status_changed'; agent: TrackedAgent; previousStatus: AgentStatus }
  | { type: 'message_sent'; message: AgentMessage; recipientCount: number }
  | { type: 'message_delivered'; message: AgentMessage; toAgent: string }
  | { type: 'message_expired'; message: AgentMessage }
  | { type: 'agent_timeout'; agent: TrackedAgent }
  | { type: 'broadcast'; message: AgentMessage };

/**
 * Callback type for coordinator event listeners.
 */
export type CoordinatorEventListener = (event: CoordinatorEvent) => void;

/**
 * Configuration for the coordinator.
 */
export interface CoordinatorConfig {
  /** Heartbeat interval in milliseconds (default: 5000) */
  heartbeatIntervalMs: number;

  /** Agent timeout in milliseconds (default: 30000) */
  agentTimeoutMs: number;

  /** Maximum pending messages per agent (default: 100) */
  maxPendingMessagesPerAgent: number;

  /** Default message TTL in milliseconds (default: 60000) */
  defaultMessageTtlMs: number;
}

/**
 * Default configuration for the coordinator.
 */
export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  heartbeatIntervalMs: 5000,
  agentTimeoutMs: 30000,
  maxPendingMessagesPerAgent: 100,
  defaultMessageTtlMs: 60000,
};

/**
 * Statistics about the coordinator's current state.
 */
export interface CoordinatorStats {
  /** Total number of registered agents */
  totalAgents: number;

  /** Number of agents by status */
  agentsByStatus: Record<AgentStatus, number>;

  /** Total messages sent since start */
  totalMessagesSent: number;

  /** Total messages delivered since start */
  totalMessagesDelivered: number;

  /** Average message delivery time in milliseconds */
  avgDeliveryTimeMs: number;

  /** Number of active subscriptions */
  activeSubscriptions: number;

  /** Timestamp when the coordinator was started */
  startedAt: Date;
}
