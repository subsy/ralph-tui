/**
 * ABOUTME: Type definitions for the Parallel Progress Summary View.
 * Defines work stream state, progress tracking, and drill-down view structures
 * for monitoring multiple parallel agents working in worktrees.
 */

import type { AgentStatus } from '../worktree/coordinator-types.js';
import type { BroadcastPriority, Broadcast } from '../worktree/broadcast-types.js';

/**
 * Progress state for a single work stream.
 * Represents an agent working on a task in a worktree.
 */
export interface WorkStreamProgress {
  /** Unique identifier for this stream (typically agent ID) */
  id: string;

  /** Human-readable agent name */
  agentName: string;

  /** Task ID being worked on */
  taskId: string;

  /** Task title for display */
  taskTitle: string;

  /** Worktree ID where work is happening */
  worktreeId?: string;

  /** Worktree path on filesystem */
  worktreePath?: string;

  /** Current status of the agent */
  status: AgentStatus;

  /** Progress percentage (0-100), -1 if unknown */
  progressPercent: number;

  /** Current activity description (e.g., "Running typecheck", "Editing file.ts") */
  currentActivity: string;

  /** Timestamp when the stream started */
  startedAt: Date;

  /** Duration in milliseconds since start */
  durationMs: number;

  /** Number of bytes written to stdout */
  stdoutBytes: number;

  /** Number of bytes written to stderr */
  stderrBytes: number;

  /** Last few lines of output for quick preview */
  outputPreview?: string;

  /** Whether this stream has unread broadcasts */
  hasUnreadBroadcasts: boolean;

  /** Number of pending broadcasts for this stream */
  pendingBroadcastCount: number;
}

/**
 * Inter-agent message for display in the progress view.
 * Simplified version of Broadcast for TUI display.
 */
export interface DisplayBroadcast {
  /** Broadcast ID */
  id: string;

  /** Agent that sent the broadcast */
  fromAgentName: string;

  /** Timestamp */
  timestamp: Date;

  /** Category (bug, pattern, blocker, etc.) */
  category: string;

  /** Priority level */
  priority: BroadcastPriority;

  /** Brief summary */
  summary: string;

  /** Affected files */
  affectedFiles: string[];

  /** Whether this broadcast requires action from the viewing agent */
  requiresAction: boolean;

  /** Suggested action (stop, adjust, review, continue) */
  suggestedAction?: string;

  /** Relevance score (0-1) */
  relevanceScore: number;
}

/**
 * Aggregated statistics for all parallel work streams.
 */
export interface ParallelProgressStats {
  /** Total number of active streams */
  totalStreams: number;

  /** Number of streams currently working */
  workingCount: number;

  /** Number of streams that are idle */
  idleCount: number;

  /** Number of streams that are blocked */
  blockedCount: number;

  /** Number of streams that completed */
  completedCount: number;

  /** Number of streams that failed */
  failedCount: number;

  /** Total tasks completed across all streams */
  totalTasksCompleted: number;

  /** Total tasks failed across all streams */
  totalTasksFailed: number;

  /** Average progress percentage across working streams */
  avgProgress: number;

  /** Total broadcasts sent */
  totalBroadcasts: number;

  /** Unacknowledged critical broadcasts */
  criticalBroadcasts: number;

  /** Timestamp when parallel execution started */
  startedAt?: Date;

  /** Total elapsed time in milliseconds */
  totalElapsedMs: number;
}

/**
 * View mode for the parallel progress component.
 */
export type ParallelProgressViewMode = 'summary' | 'drilldown';

/**
 * Props for the ParallelProgressSummary component.
 */
export interface ParallelProgressSummaryProps {
  /** All active work streams */
  streams: WorkStreamProgress[];

  /** Aggregated statistics */
  stats: ParallelProgressStats;

  /** Currently selected stream index */
  selectedIndex: number;

  /** Current view mode */
  viewMode: ParallelProgressViewMode;

  /** Callback when a stream is selected */
  onSelectStream?: (index: number) => void;

  /** Callback when drilling down into a stream */
  onDrillDown?: (streamId: string) => void;

  /** Callback when returning from drill-down to summary */
  onBack?: () => void;
}

/**
 * Props for the WorkStreamCard component.
 */
export interface WorkStreamCardProps {
  /** The work stream to display */
  stream: WorkStreamProgress;

  /** Whether this card is currently selected */
  isSelected: boolean;

  /** Whether to show compact view (less detail) */
  compact?: boolean;

  /** Callback when the card is clicked/selected */
  onSelect?: () => void;
}

/**
 * Props for the WorkStreamDrillDown component.
 */
export interface WorkStreamDrillDownProps {
  /** The stream to show detailed view for */
  stream: WorkStreamProgress;

  /** Full output from the stream */
  output: string;

  /** Broadcasts relevant to this stream */
  broadcasts: DisplayBroadcast[];

  /** Broadcasts sent by this stream */
  sentBroadcasts: DisplayBroadcast[];

  /** Callback when returning to summary view */
  onBack?: () => void;

  /** Callback when acknowledging a broadcast */
  onAcknowledgeBroadcast?: (broadcastId: string) => void;
}

/**
 * Event types for parallel progress updates.
 * Used to push real-time updates to the TUI.
 */
export type ParallelProgressEvent =
  | { type: 'stream_added'; stream: WorkStreamProgress }
  | { type: 'stream_updated'; stream: WorkStreamProgress }
  | { type: 'stream_removed'; streamId: string }
  | { type: 'stats_updated'; stats: ParallelProgressStats }
  | { type: 'broadcast_received'; broadcast: DisplayBroadcast; toStreamId: string }
  | { type: 'broadcast_sent'; broadcast: DisplayBroadcast; fromStreamId: string };

/**
 * Callback type for parallel progress event listeners.
 */
export type ParallelProgressEventListener = (event: ParallelProgressEvent) => void;

/**
 * Helper to convert a Broadcast to DisplayBroadcast.
 */
export function broadcastToDisplayBroadcast(
  broadcast: Broadcast,
  requiresAction: boolean = false,
  suggestedAction?: string,
  relevanceScore: number = 0
): DisplayBroadcast {
  return {
    id: broadcast.id,
    fromAgentName: broadcast.fromAgentName,
    timestamp: broadcast.timestamp,
    category: broadcast.payload.category,
    priority: broadcast.payload.priority,
    summary: broadcast.payload.summary,
    affectedFiles: broadcast.payload.affectedFiles,
    requiresAction,
    suggestedAction,
    relevanceScore,
  };
}

/**
 * Get status color for a work stream status.
 */
export function getStreamStatusColor(status: AgentStatus): string {
  switch (status) {
    case 'working':
      return '#7aa2f7'; // Blue - active
    case 'complete':
      return '#9ece6a'; // Green - success
    case 'failed':
      return '#f7768e'; // Red - error
    case 'blocked':
      return '#e0af68'; // Orange - warning
    case 'idle':
    default:
      return '#565f89'; // Grey - muted
  }
}

/**
 * Get status indicator symbol for a work stream status.
 */
export function getStreamStatusIndicator(status: AgentStatus): string {
  switch (status) {
    case 'working':
      return '▶';
    case 'complete':
      return '✓';
    case 'failed':
      return '✗';
    case 'blocked':
      return '⊘';
    case 'idle':
    default:
      return '○';
  }
}

/**
 * Get priority color for a broadcast priority.
 */
export function getBroadcastPriorityColor(priority: BroadcastPriority): string {
  switch (priority) {
    case 'critical':
      return '#f7768e'; // Red
    case 'high':
      return '#e0af68'; // Orange
    case 'normal':
      return '#7aa2f7'; // Blue
    case 'low':
    default:
      return '#565f89'; // Grey
  }
}

/**
 * Format progress percentage for display.
 */
export function formatProgress(percent: number): string {
  if (percent < 0) {
    return '...'; // Unknown progress
  }
  return `${Math.round(percent)}%`;
}

/**
 * Format duration in milliseconds to human-readable string.
 */
export function formatStreamDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
