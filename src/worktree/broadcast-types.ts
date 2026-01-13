/**
 * ABOUTME: Type definitions for the Agent Broadcast System.
 * Defines broadcast categories, configuration, and message structures
 * for agents to share discoveries (bugs, patterns, blockers) in real-time.
 */

/**
 * Default broadcast categories that agents can use.
 * These cover common discovery types during parallel work.
 */
export type BroadcastCategory =
  | 'bug'
  | 'pattern'
  | 'blocker'
  | 'api_change'
  | 'schema_change'
  | 'dependency_update'
  | 'test_failure'
  | 'security_issue'
  | 'performance_issue'
  | 'custom';

/**
 * Default categories that are enabled by default.
 */
export const DEFAULT_BROADCAST_CATEGORIES: BroadcastCategory[] = ['bug', 'pattern', 'blocker'];

/**
 * Priority levels for broadcasts.
 * Higher priority broadcasts are delivered and processed first.
 */
export type BroadcastPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Payload structure for a broadcast message.
 */
export interface BroadcastPayload {
  /** Category of the broadcast (e.g., 'bug', 'pattern', 'blocker') */
  category: BroadcastCategory | string;

  /** Brief summary of the discovery (human-readable) */
  summary: string;

  /** Detailed description of the discovery */
  details: string;

  /** Files affected by this discovery */
  affectedFiles: string[];

  /** Priority of this broadcast */
  priority: BroadcastPriority;

  /** Optional code snippets or examples */
  codeSnippets?: string[];

  /** Optional suggested actions for other agents */
  suggestedActions?: string[];

  /** Optional metadata for extensibility */
  metadata?: Record<string, unknown>;
}

/**
 * A broadcast message sent from one agent to all others.
 */
export interface Broadcast {
  /** Unique identifier for this broadcast */
  id: string;

  /** ID of the agent that created this broadcast */
  fromAgent: string;

  /** Name of the agent that created this broadcast */
  fromAgentName: string;

  /** Task ID the agent was working on when creating this broadcast */
  taskId?: string;

  /** Timestamp when the broadcast was created */
  timestamp: Date;

  /** Broadcast payload with discovery details */
  payload: BroadcastPayload;

  /** IDs of agents that have consumed this broadcast */
  consumedBy: string[];

  /** IDs of agents that have acknowledged this broadcast */
  acknowledgedBy: string[];

  /** Whether this broadcast has been superseded by a newer one */
  superseded: boolean;

  /** ID of the broadcast that superseded this one (if any) */
  supersededBy?: string;
}

/**
 * Configuration for the broadcast system.
 */
export interface BroadcastConfig {
  /** Whether broadcasting is enabled (default: true) */
  enabled: boolean;

  /** Categories of broadcasts that are enabled (default: ['bug', 'pattern', 'blocker']) */
  enabledCategories: (BroadcastCategory | string)[];

  /** Maximum number of broadcasts to retain in memory (default: 1000) */
  maxBroadcastHistory: number;

  /** Time-to-live for broadcasts in milliseconds (default: 3600000 = 1 hour) */
  broadcastTtlMs: number;

  /** Whether to automatically consume broadcasts when agents poll (default: true) */
  autoConsume: boolean;

  /** Interval for cleaning up expired broadcasts in milliseconds (default: 60000) */
  cleanupIntervalMs: number;

  /** Whether to require acknowledgment for critical broadcasts (default: true) */
  requireAckForCritical: boolean;

  /** Custom category definitions for extensibility */
  customCategories?: string[];
}

/**
 * Default broadcast configuration.
 */
export const DEFAULT_BROADCAST_CONFIG: BroadcastConfig = {
  enabled: true,
  enabledCategories: DEFAULT_BROADCAST_CATEGORIES,
  maxBroadcastHistory: 1000,
  broadcastTtlMs: 3600000, // 1 hour
  autoConsume: true,
  cleanupIntervalMs: 60000, // 1 minute
  requireAckForCritical: true,
};

/**
 * Options for creating a broadcast.
 */
export interface CreateBroadcastOptions {
  /** Category of the broadcast */
  category: BroadcastCategory | string;

  /** Brief summary of the discovery */
  summary: string;

  /** Detailed description */
  details: string;

  /** Files affected by this discovery */
  affectedFiles: string[];

  /** Priority level (default: 'normal') */
  priority?: BroadcastPriority;

  /** Optional code snippets */
  codeSnippets?: string[];

  /** Optional suggested actions */
  suggestedActions?: string[];

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of creating a broadcast.
 */
export interface CreateBroadcastResult {
  /** Whether the broadcast was created successfully */
  success: boolean;

  /** The created broadcast (if successful) */
  broadcast?: Broadcast;

  /** Error message (if failed) */
  error?: string;

  /** Whether broadcasting was disabled and the broadcast was not sent */
  disabled?: boolean;

  /** Whether the category was filtered out */
  filtered?: boolean;
}

/**
 * Options for consuming broadcasts.
 */
export interface ConsumeBroadcastsOptions {
  /** Only get broadcasts from specific categories */
  categories?: (BroadcastCategory | string)[];

  /** Only get broadcasts with minimum priority */
  minPriority?: BroadcastPriority;

  /** Only get broadcasts affecting specific files */
  affectingFiles?: string[];

  /** Only get broadcasts created after this timestamp */
  since?: Date;

  /** Maximum number of broadcasts to return */
  limit?: number;

  /** Whether to mark broadcasts as consumed (default: true based on config) */
  markConsumed?: boolean;
}

/**
 * A consumed broadcast with action context.
 */
export interface ConsumedBroadcast extends Broadcast {
  /** Whether this agent should adjust its work based on this broadcast */
  requiresAction: boolean;

  /** Suggested action type for this agent */
  suggestedActionType?: 'stop' | 'adjust' | 'review' | 'continue' | 'acknowledge';

  /** Relevance score (0-1) based on file overlap and priority */
  relevanceScore: number;
}

/**
 * Result of consuming broadcasts.
 */
export interface ConsumeBroadcastsResult {
  /** Consumed broadcasts sorted by relevance */
  broadcasts: ConsumedBroadcast[];

  /** Total number of broadcasts available (before filtering/limiting) */
  totalAvailable: number;

  /** Number of broadcasts that require action */
  requireingAction: number;

  /** Number of critical broadcasts */
  criticalCount: number;
}

/**
 * Events emitted by the broadcast manager.
 */
export type BroadcastEvent =
  | { type: 'broadcast_created'; broadcast: Broadcast }
  | { type: 'broadcast_consumed'; broadcastId: string; agentId: string }
  | { type: 'broadcast_acknowledged'; broadcastId: string; agentId: string }
  | { type: 'broadcast_expired'; broadcastId: string }
  | { type: 'broadcast_superseded'; broadcastId: string; supersededBy: string }
  | { type: 'config_changed'; config: BroadcastConfig };

/**
 * Callback type for broadcast event listeners.
 */
export type BroadcastEventListener = (event: BroadcastEvent) => void;

/**
 * Statistics about the broadcast system.
 */
export interface BroadcastStats {
  /** Whether broadcasting is enabled */
  enabled: boolean;

  /** Total broadcasts created since start */
  totalCreated: number;

  /** Total broadcasts consumed */
  totalConsumed: number;

  /** Total broadcasts acknowledged */
  totalAcknowledged: number;

  /** Current number of active broadcasts */
  activeBroadcasts: number;

  /** Number of broadcasts by category */
  byCategory: Record<string, number>;

  /** Number of broadcasts by priority */
  byPriority: Record<BroadcastPriority, number>;

  /** Average time to first consumption in milliseconds */
  avgTimeToFirstConsumptionMs: number;

  /** Timestamp when the manager was started */
  startedAt: Date;
}

/**
 * Subscription for receiving broadcast notifications.
 */
export interface BroadcastSubscription {
  /** Unique identifier for this subscription */
  id: string;

  /** Agent ID that owns this subscription */
  agentId: string;

  /** Filter for categories (empty = all enabled categories) */
  categoryFilter: (BroadcastCategory | string)[];

  /** Filter for minimum priority */
  minPriority?: BroadcastPriority;

  /** Filter for files (only broadcasts affecting these files) */
  fileFilter?: string[];

  /** Callback function when a relevant broadcast is received */
  callback: (broadcast: Broadcast) => void | Promise<void>;

  /** Timestamp when subscription was created */
  createdAt: Date;
}
