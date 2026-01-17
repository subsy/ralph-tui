/**
 * ABOUTME: Type definitions for Ralph TUI components.
 * Defines the data structures and props used across the TUI layout components.
 */

import type { TaskStatus, RalphStatus } from './theme.js';
import type { IterationResult, SubagentTreeNode, ActiveAgentState, RateLimitState } from '../engine/types.js';
import type { TaskPriority } from '../plugins/trackers/types.js';
import type { SubagentDetailLevel, SandboxConfig, SandboxMode } from '../config/types.js';
import type { FormattedSegment } from '../plugins/agents/output-formatting.js';

// Re-export types for convenience
export type { TaskPriority };
export type { SubagentDetailLevel };
export type { SubagentTreeNode };

/**
 * Blocker task info for display purposes
 */
export interface BlockerInfo {
  /** Blocker task ID */
  id: string;
  /** Blocker task title */
  title: string;
  /** Blocker task status */
  status: string;
}

/**
 * Task item displayed in the task list and detail view.
 * Extended from TrackerTask for full detail view support.
 */
export interface TaskItem {
  /** Unique identifier */
  id: string;
  /** Human-readable task title */
  title: string;
  /** Current status */
  status: TaskStatus;
  /** Detailed description or body text */
  description?: string;
  /** Current iteration/sprint number */
  iteration?: number;
  /** Priority level (0-4, where 0 is critical) */
  priority?: TaskPriority;
  /** Labels or tags associated with the task */
  labels?: string[];
  /** Task type (e.g., 'feature', 'bug', 'task', 'epic') */
  type?: string;
  /** IDs of tasks this task depends on (blockers) */
  dependsOn?: string[];
  /** IDs of tasks that depend on this task */
  blocks?: string[];
  /** Detailed info about tasks that are blocking this one (for display) */
  blockedByTasks?: BlockerInfo[];
  /** Completion notes or close reason (if closed) */
  closeReason?: string;
  /** Acceptance criteria as markdown text or list */
  acceptanceCriteria?: string;
  /** Assigned user or owner */
  assignee?: string;
  /** Creation timestamp (ISO 8601) */
  createdAt?: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt?: string;
  /** Parent task/epic ID for hierarchical display */
  parentId?: string;
  /** Tracker-specific metadata (varies by plugin) */
  metadata?: Record<string, unknown>;
}

/**
 * Props for the Header component.
 * Compact header shows only essential info: status, current task, progress, elapsed time.
 * Also displays selected agent and tracker plugin names for configuration visibility.
 */
export interface HeaderProps {
  /** Current Ralph execution status */
  status: RalphStatus;
  /** Elapsed time in seconds */
  elapsedTime: number;
  /** Current task ID being worked on (if any) */
  currentTaskId?: string;
  /** Current task title being worked on (if any) */
  currentTaskTitle?: string;
  /** Number of completed tasks (for progress display) */
  completedTasks?: number;
  /** Total number of tasks (for progress display) */
  totalTasks?: number;
  /** Selected agent plugin name (e.g., "claude", "opencode") */
  agentName?: string;
  /** Selected tracker plugin name (e.g., "beads", "beads-bv", "json") */
  trackerName?: string;
  /** Active agent state from engine (tracks which agent is running and why) */
  activeAgentState?: ActiveAgentState | null;
  /** Rate limit state from engine (tracks primary agent rate limiting) */
  rateLimitState?: RateLimitState | null;
  /** Current iteration number (for iteration progress display) */
  currentIteration?: number;
  /** Maximum iterations (0 = unlimited, for iteration progress display) */
  maxIterations?: number;
  /** Current model being used (provider/model format, e.g., "anthropic/claude-3-5-sonnet") */
  currentModel?: string;
  /** Sandbox configuration (for displaying sandbox status indicator) */
  sandboxConfig?: SandboxConfig;
  /** Resolved sandbox mode (when mode is 'auto', this shows what it resolved to) */
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>;
}

/**
 * Props for the LeftPanel (task list) component
 */
export interface LeftPanelProps {
  /** List of tasks to display */
  tasks: TaskItem[];
  /** Currently selected task index */
  selectedIndex: number;
  /** Callback when a task is selected (keyboard navigation) */
  onSelectTask?: (index: number) => void;
  /** Callback when Enter is pressed to drill into task details */
  onTaskDrillDown?: (task: TaskItem) => void;
}

/**
 * View mode for the right panel details area
 * - 'details': Show task metadata (title, ID, status, description, dependencies)
 * - 'output': Show full-height scrollable iteration output
 */
export type DetailsViewMode = 'details' | 'output';

/**
 * Timing information for an iteration (for output view display)
 */
export interface IterationTimingInfo {
  /** ISO 8601 timestamp when iteration started */
  startedAt?: string;
  /** ISO 8601 timestamp when iteration ended */
  endedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Whether the iteration is currently running */
  isRunning?: boolean;
  /** Model used for this iteration (provider/model format, e.g., "anthropic/claude-3-5-sonnet") */
  model?: string;
}

/**
 * Props for the RightPanel (details) component
 */
export interface RightPanelProps {
  /** Currently selected task (null if none selected) */
  selectedTask: TaskItem | null;
  /** Current iteration number */
  currentIteration: number;
  /** Current iteration output/log (legacy string format) */
  iterationOutput?: string;
  /** Current iteration output segments for TUI-native color rendering */
  iterationSegments?: FormattedSegment[];
  /** View mode for the details panel (details or output) */
  viewMode?: DetailsViewMode;
  /** Callback when view mode should be toggled */
  onToggleViewMode?: () => void;
  /** Timing information for the iteration (optional) */
  iterationTiming?: IterationTimingInfo;
  /** Name of the agent being used */
  agentName?: string;
  /** Model being used (provider/model format) */
  currentModel?: string;
  /**
   * Subagent tracing detail level.
   * Controls how much subagent information is shown:
   * - 'off': No tracing, use raw output
   * - 'minimal': Show start/complete events only
   * - 'moderate': Show events + description + duration (collapsible)
   * - 'full': Show events + nested output + hierarchy panel
   */
  subagentDetailLevel?: SubagentDetailLevel;
  /** Subagent tree for the current iteration (hierarchical structure) */
  subagentTree?: SubagentTreeNode[];
  /** Set of collapsed subagent IDs (for section toggle state) */
  collapsedSubagents?: Set<string>;
  /** ID of the currently focused subagent section */
  focusedSubagentId?: string;
  /** Callback when a subagent section is toggled */
  onSubagentToggle?: (id: string) => void;
}

/**
 * Overall application state for the TUI
 */
export interface AppState {
  header: HeaderProps;
  leftPanel: LeftPanelProps;
  rightPanel: RightPanelProps;
}

/**
 * Props for the IterationHistoryPanel component
 */
export interface IterationHistoryPanelProps {
  /** List of iteration results */
  iterations: IterationResult[];
  /** Total number of iterations planned */
  totalIterations: number;
  /** Currently selected iteration index */
  selectedIndex: number;
  /** Current running iteration number (0 if none running) */
  runningIteration: number;
  /** Callback when Enter is pressed to drill into iteration details */
  onIterationDrillDown?: (iteration: IterationResult) => void;
}

/**
 * Props for the TaskDetailView component
 */
export interface TaskDetailViewProps {
  /** The task to display details for */
  task: TaskItem;
  /** Callback when Esc is pressed to return to list view */
  onBack?: () => void;
}
