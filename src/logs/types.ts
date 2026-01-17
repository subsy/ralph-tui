/**
 * ABOUTME: Type definitions for iteration log persistence.
 * Defines structures for storing and retrieving iteration logs from disk.
 */

import type { IterationStatus, ActiveAgentReason } from '../engine/types.js';
import type {
  SubagentEvent,
  SubagentState,
} from '../plugins/agents/tracing/types.js';

/**
 * Entry recording an agent switch during an iteration.
 * Tracks when and why the engine switched between primary and fallback agents.
 */
export interface AgentSwitchEntry {
  /** ISO 8601 timestamp when the switch occurred */
  at: string;

  /** Plugin identifier of the agent being switched from */
  from: string;

  /** Plugin identifier of the agent being switched to */
  to: string;

  /** Reason for the switch */
  reason: ActiveAgentReason;
}

/**
 * Directory where iteration logs are stored (relative to cwd).
 * This is the new standard location per US-020.
 */
export const ITERATIONS_DIR = '.ralph-tui/iterations';

/**
 * Metadata header stored at the top of each iteration log file.
 * Separated from raw output by a divider line.
 */
export interface IterationLogMetadata {
  /** Iteration number (1-based) */
  iteration: number;

  /** Task ID that was worked on */
  taskId: string;

  /** Task title */
  taskTitle: string;

  /** Task description (if available) */
  taskDescription?: string;

  /** Status of the iteration */
  status: IterationStatus;

  /** Whether the task was marked as completed */
  taskCompleted: boolean;

  /** Whether <promise>COMPLETE</promise> was detected */
  promiseComplete: boolean;

  /** ISO 8601 timestamp when iteration started */
  startedAt: string;

  /** ISO 8601 timestamp when iteration ended */
  endedAt: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Error message if iteration failed */
  error?: string;

  /** Agent plugin used */
  agentPlugin?: string;

  /** Model used (if specified) */
  model?: string;

  /** Epic ID (for beads trackers) */
  epicId?: string;

  /** Agent switches that occurred during this iteration */
  agentSwitches?: AgentSwitchEntry[];

  /** Summary of how iteration completed (e.g., 'Completed on fallback (opencode) due to rate limit') */
  completionSummary?: string;

  /** Sandbox mode used for this iteration ('docker', 'seatbelt', 'off') */
  sandboxMode?: string;

  /** Resolved sandbox mode when configured mode was 'auto' */
  resolvedSandboxMode?: string;

  /** Whether network access was enabled in sandbox */
  sandboxNetwork?: boolean;
}

/**
 * Node in the subagent hierarchy tree.
 * Represents a single subagent with its nested children.
 */
export interface SubagentHierarchyNode {
  /** Subagent state at time of persistence */
  state: SubagentState;

  /** Child subagents spawned by this subagent */
  children: SubagentHierarchyNode[];
}

/**
 * Aggregate statistics for subagent activity.
 */
export interface SubagentTraceStats {
  /** Total number of subagents spawned */
  totalSubagents: number;

  /** Count by agent type (e.g., { Explore: 3, Bash: 2 }) */
  byType: Record<string, number>;

  /** Total duration of all completed subagents in milliseconds */
  totalDurationMs: number;

  /** Number of subagents that failed */
  failureCount: number;

  /** Maximum nesting depth observed */
  maxDepth: number;
}

/**
 * Complete subagent trace data persisted with iteration logs.
 * Contains the full event timeline, hierarchy tree, and aggregate stats.
 */
export interface SubagentTrace {
  /** Full timeline of subagent lifecycle events in chronological order */
  events: SubagentEvent[];

  /** Hierarchical tree of subagent relationships */
  hierarchy: SubagentHierarchyNode[];

  /** Aggregate statistics */
  stats: SubagentTraceStats;
}

/**
 * Complete iteration log with metadata and output.
 */
export interface IterationLog {
  /** Log metadata */
  metadata: IterationLogMetadata;

  /** Full stdout from agent */
  stdout: string;

  /** Full stderr from agent */
  stderr: string;

  /** Path to the log file on disk */
  filePath: string;

  /** Subagent trace data (optional, for iterations with subagent tracking) */
  subagentTrace?: SubagentTrace;
}

/**
 * Summary of an iteration log for listing.
 */
export interface IterationLogSummary {
  /** Iteration number */
  iteration: number;

  /** Task ID */
  taskId: string;

  /** Task title (truncated for display) */
  taskTitle: string;

  /** Status of the iteration */
  status: IterationStatus;

  /** Whether task was completed */
  taskCompleted: boolean;

  /** Duration in milliseconds */
  durationMs: number;

  /** When the iteration started */
  startedAt: string;

  /** Path to the log file */
  filePath: string;
}

/**
 * Filter options for listing logs.
 */
export interface LogFilterOptions {
  /** Filter by specific iteration number */
  iteration?: number;

  /** Filter by task ID (partial match) */
  taskId?: string;

  /** Filter by status */
  status?: IterationStatus[];

  /** Maximum number of logs to return */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

/**
 * Options for cleaning up old logs.
 */
export interface LogCleanupOptions {
  /** Number of most recent logs to keep */
  keep: number;

  /** Dry run - don't actually delete, just report what would be deleted */
  dryRun?: boolean;
}

/**
 * Result of a cleanup operation.
 */
export interface LogCleanupResult {
  /** Number of logs deleted (or would be deleted in dry run) */
  deletedCount: number;

  /** Paths of deleted files */
  deletedFiles: string[];

  /** Number of logs kept */
  keptCount: number;

  /** Whether this was a dry run */
  dryRun: boolean;
}
