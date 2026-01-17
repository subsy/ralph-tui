/**
 * ABOUTME: RunApp component for the Ralph TUI execution view.
 * Integrates with the execution engine to display real-time progress.
 * Handles graceful interruption with confirmation dialog.
 */

import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { colors, layout } from '../theme.js';
import type { RalphStatus, TaskStatus } from '../theme.js';
import type { TaskItem, BlockerInfo, DetailsViewMode, IterationTimingInfo, SubagentTreeNode } from '../types.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { LeftPanel } from './LeftPanel.js';
import { RightPanel } from './RightPanel.js';
import { IterationHistoryView } from './IterationHistoryView.js';
import { IterationDetailView } from './IterationDetailView.js';
import { ProgressDashboard } from './ProgressDashboard.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import { HelpOverlay } from './HelpOverlay.js';
import { SettingsView } from './SettingsView.js';
import { EpicLoaderOverlay } from './EpicLoaderOverlay.js';
import type { EpicLoaderMode } from './EpicLoaderOverlay.js';
import { SubagentTreePanel } from './SubagentTreePanel.js';
import type {
  ExecutionEngine,
  EngineEvent,
  IterationResult,
  ActiveAgentState,
  RateLimitState,
} from '../../engine/index.js';
import type { TrackerTask } from '../../plugins/trackers/types.js';
import type { StoredConfig, SubagentDetailLevel, SandboxConfig, SandboxMode } from '../../config/types.js';
import type { AgentPluginMeta } from '../../plugins/agents/types.js';
import type { TrackerPluginMeta } from '../../plugins/trackers/types.js';
import { getIterationLogsByTask } from '../../logs/index.js';
import type { SubagentTraceStats, SubagentHierarchyNode } from '../../logs/types.js';
import { platform } from 'node:os';
import { writeToClipboard } from '../../utils/index.js';
import { StreamingOutputParser } from '../output-parser.js';
import type { FormattedSegment } from '../../plugins/agents/output-formatting.js';

/**
 * View modes for the RunApp component
 * - 'tasks': Show the task list (default)
 * - 'iterations': Show the iteration history
 * - 'iteration-detail': Show detailed view of a single iteration
 * Note: Task details are now shown inline in the RightPanel, not as a separate view
 */
type ViewMode = 'tasks' | 'iterations' | 'iteration-detail';

/**
 * Props for the RunApp component
 */
export interface RunAppProps {
  /** The execution engine instance */
  engine: ExecutionEngine;
  /** Current working directory for loading historical logs */
  cwd: string;
  /** Callback when quit is requested */
  onQuit?: () => Promise<void>;
  /** Callback when Enter is pressed on an iteration to drill into details */
  onIterationDrillDown?: (iteration: IterationResult) => void;
  /** Whether the interrupt confirmation dialog is showing */
  showInterruptDialog?: boolean;
  /** Callback when user confirms interrupt */
  onInterruptConfirm?: () => void;
  /** Callback when user cancels interrupt */
  onInterruptCancel?: () => void;
  /** Initial tasks to display before engine starts */
  initialTasks?: TrackerTask[];
  /** Callback when user wants to start the engine (s key in ready state) */
  onStart?: () => Promise<void>;
  /** Current stored configuration (for settings view) */
  storedConfig?: StoredConfig;
  /** Available agent plugins (for settings view) */
  availableAgents?: AgentPluginMeta[];
  /** Available tracker plugins (for settings view) */
  availableTrackers?: TrackerPluginMeta[];
  /** Callback when settings should be saved */
  onSaveSettings?: (config: StoredConfig) => Promise<void>;
  /** Callback to load available epics for the epic loader */
  onLoadEpics?: () => Promise<TrackerTask[]>;
  /** Callback when user selects a new epic */
  onEpicSwitch?: (epic: TrackerTask) => Promise<void>;
  /** Callback when user enters a file path (json tracker) */
  onFilePathSwitch?: (path: string) => Promise<boolean>;
  /** Current tracker type to determine epic loader mode */
  trackerType?: string;
  /** Current agent plugin name (from resolved config, includes CLI override) */
  agentPlugin?: string;
  /** Current epic ID for highlighting in the loader */
  currentEpicId?: string;
  /** Initial subagent panel visibility state (from persisted session) */
  initialSubagentPanelVisible?: boolean;
  /** Callback when subagent panel visibility changes (to persist state) */
  onSubagentPanelVisibilityChange?: (visible: boolean) => void;
  /** Current model being used (provider/model format, e.g., "anthropic/claude-3-5-sonnet") */
  currentModel?: string;
  /** Sandbox configuration for display in header */
  sandboxConfig?: SandboxConfig;
  /** Resolved sandbox mode (when mode is 'auto', this shows what it resolved to) */
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>;
}

/**
 * Convert tracker status to TUI task status (basic mapping without dependency checking).
 * Maps: open -> pending, in_progress -> active, completed -> closed (greyed out), etc.
 * Note: 'done' status is used for tasks completed in the current session (green checkmark),
 * while 'closed' is for previously completed tasks (greyed out for historical view).
 *
 * For open tasks, the actual actionable/blocked status is determined later by
 * convertTasksWithDependencyStatus() which checks if dependencies are resolved.
 */
function trackerStatusToTaskStatus(trackerStatus: string): TaskStatus {
  switch (trackerStatus) {
    case 'open':
      return 'pending'; // Will be refined to actionable/blocked later
    case 'in_progress':
      return 'active';
    case 'completed':
      return 'closed'; // Greyed out for historical/previously completed tasks
    case 'blocked':
      return 'blocked';
    case 'cancelled':
      return 'closed'; // Show cancelled as closed (greyed out finished state)
    default:
      return 'pending';
  }
}

/**
 * Convert a TrackerTask to a TaskItem for display in the TUI.
 */
function trackerTaskToTaskItem(task: TrackerTask): TaskItem {
  return {
    id: task.id,
    title: task.title,
    status: trackerStatusToTaskStatus(task.status),
    description: task.description,
    priority: task.priority,
    labels: task.labels,
    type: task.type,
    dependsOn: task.dependsOn,
    blocks: task.blocks,
    assignee: task.assignee,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    parentId: task.parentId,
    metadata: task.metadata,
  };
}

/**
 * Recalculate dependency status for all tasks after a status change.
 * This should be called whenever a task's status changes (e.g., completed)
 * to update blocked/actionable status of dependent tasks.
 */
function recalculateDependencyStatus(tasks: TaskItem[]): TaskItem[] {
  // Build a map of task IDs to their current status
  const statusMap = new Map<string, { status: TaskStatus; title: string }>();
  for (const task of tasks) {
    statusMap.set(task.id, { status: task.status, title: task.title });
  }

  return tasks.map((task) => {
    // Only recalculate for pending/blocked/actionable tasks (not active, done, error, or closed)
    if (task.status !== 'pending' && task.status !== 'blocked' && task.status !== 'actionable') {
      return task;
    }

    // If no dependencies, it's actionable
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return task.status === 'pending' ? { ...task, status: 'actionable' as TaskStatus } : task;
    }

    // Check if all dependencies are resolved (done/closed status in our TaskItem world)
    const blockers: BlockerInfo[] = [];
    for (const depId of task.dependsOn) {
      const dep = statusMap.get(depId);
      if (dep) {
        // Task exists - check if it's done
        if (dep.status !== 'done' && dep.status !== 'closed') {
          blockers.push({
            id: depId,
            title: dep.title,
            status: dep.status,
          });
        }
      } else {
        // Dependency not in our list - treat as potential blocker
        blockers.push({
          id: depId,
          title: `(external: ${depId})`,
          status: 'unknown',
        });
      }
    }

    // Update status based on blockers
    if (blockers.length > 0) {
      return {
        ...task,
        status: 'blocked' as TaskStatus,
        blockedByTasks: blockers,
      };
    }

    // All dependencies resolved - task is now actionable
    return {
      ...task,
      status: 'actionable' as TaskStatus,
      blockedByTasks: undefined,
    };
  });
}

/**
 * Convert all tasks and determine actionable/blocked status based on dependencies.
 * A task is 'actionable' if it has no dependencies OR all its dependencies are completed/closed.
 * A task is 'blocked' if it has any dependency that is NOT completed/closed.
 */
function convertTasksWithDependencyStatus(trackerTasks: TrackerTask[]): TaskItem[] {
  // First, create a map of task IDs to their status and title for quick lookup
  const taskMap = new Map<string, { status: string; title: string }>();
  for (const task of trackerTasks) {
    taskMap.set(task.id, { status: task.status, title: task.title });
  }

  // Convert each task, determining actionable/blocked based on dependencies
  return trackerTasks.map((task) => {
    const baseItem = trackerTaskToTaskItem(task);

    // Only check dependencies for open/pending tasks
    if (baseItem.status !== 'pending') {
      return baseItem;
    }

    // If no dependencies, it's actionable
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return { ...baseItem, status: 'actionable' as TaskStatus };
    }

    // Check if all dependencies are completed/closed/cancelled
    const blockers: BlockerInfo[] = [];
    for (const depId of task.dependsOn) {
      const dep = taskMap.get(depId);
      if (dep) {
        // Dependency exists in our task list
        if (dep.status !== 'completed' && dep.status !== 'cancelled' && dep.status !== 'closed') {
          blockers.push({
            id: depId,
            title: dep.title,
            status: dep.status,
          });
        }
      } else {
        // Dependency not in our list - assume it might be blocking (external dependency)
        // We could fetch it, but for now we'll treat unknown deps as potential blockers
        blockers.push({
          id: depId,
          title: `(external: ${depId})`,
          status: 'unknown',
        });
      }
    }

    // If any blockers found, task is blocked
    if (blockers.length > 0) {
      return {
        ...baseItem,
        status: 'blocked' as TaskStatus,
        blockedByTasks: blockers,
      };
    }

    // All dependencies are resolved - task is actionable
    return { ...baseItem, status: 'actionable' as TaskStatus };
  });
}

/**
 * Main RunApp component for execution view
 */
export function RunApp({
  engine,
  cwd,
  onQuit,
  onIterationDrillDown,
  showInterruptDialog = false,
  onInterruptConfirm,
  onInterruptCancel,
  initialTasks,
  onStart,
  storedConfig,
  availableAgents = [],
  availableTrackers = [],
  onSaveSettings,
  onLoadEpics,
  onEpicSwitch,
  onFilePathSwitch,
  trackerType,
  agentPlugin,
  currentEpicId,
  initialSubagentPanelVisible = false,
  onSubagentPanelVisibilityChange,
  currentModel,
  sandboxConfig,
  resolvedSandboxMode,
}: RunAppProps): ReactNode {
  const { width, height } = useTerminalDimensions();
  const renderer = useRenderer();
  // Copy feedback message state (auto-dismissed after 2s)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    // Initialize with initial tasks if provided (for ready state)
    if (initialTasks && initialTasks.length > 0) {
      return convertTasksWithDependencyStatus(initialTasks);
    }
    return [];
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Start in 'ready' state if we have onStart callback (waiting for user to start)
  const [status, setStatus] = useState<RalphStatus>(onStart ? 'ready' : 'running');
  const [currentIteration, setCurrentIteration] = useState(0);
  const [maxIterations, setMaxIterations] = useState(() => {
    // Initialize from engine if available
    const info = engine.getIterationInfo();
    return info.maxIterations;
  });
  const [currentOutput, setCurrentOutput] = useState('');
  const [currentSegments, setCurrentSegments] = useState<FormattedSegment[]>([]);
  // Streaming parser for live output - extracts readable content and prevents memory bloat
  // Use agentPlugin prop (from resolved config with CLI override) with fallback to storedConfig
  const resolvedAgentName = agentPlugin || storedConfig?.defaultAgent || storedConfig?.agent || 'claude';
  const outputParserRef = useRef(
    new StreamingOutputParser({
      agentPlugin: resolvedAgentName,
    })
  );
  const [elapsedTime, setElapsedTime] = useState(0);
  const [epicName] = useState('Ralph');
  // Derive agent/tracker names from config - these are displayed in the header
  const agentName = resolvedAgentName;
  // Use trackerType (from resolved config.tracker.plugin) as priority since it's the actual plugin in use
  const trackerName = trackerType || storedConfig?.defaultTracker || storedConfig?.tracker || 'beads';
  // Dashboard visibility state (off by default for compact header design)
  const [showDashboard, setShowDashboard] = useState(false);
  // Iteration history state
  const [iterations, setIterations] = useState<IterationResult[]>([]);
  const [totalIterations] = useState(10); // Default max iterations for display
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [iterationSelectedIndex, setIterationSelectedIndex] = useState(0);
  // Iteration detail view state
  const [detailIteration, setDetailIteration] = useState<IterationResult | null>(null);
  // Help overlay state
  const [showHelp, setShowHelp] = useState(false);
  // Settings view state
  const [showSettings, setShowSettings] = useState(false);
  // Quit confirmation dialog state
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  // Show/hide closed tasks filter (default: show closed tasks)
  const [showClosedTasks, setShowClosedTasks] = useState(true);
  // Cache for historical iteration output loaded from disk (taskId -> { output, timing })
  const [historicalOutputCache, setHistoricalOutputCache] = useState<
    Map<string, { output: string; timing: IterationTimingInfo }>
  >(() => new Map());
  // Current task info for status display
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>(undefined);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string | undefined>(undefined);
  // Current iteration start time (ISO timestamp)
  const [currentIterationStartedAt, setCurrentIterationStartedAt] = useState<string | undefined>(undefined);
  // Epic loader overlay state
  const [showEpicLoader, setShowEpicLoader] = useState(false);
  const [epicLoaderEpics, setEpicLoaderEpics] = useState<TrackerTask[]>([]);
  const [epicLoaderLoading, setEpicLoaderLoading] = useState(false);
  const [epicLoaderError, setEpicLoaderError] = useState<string | undefined>(undefined);
  // Determine epic loader mode based on tracker type
  const epicLoaderMode: EpicLoaderMode = trackerType === 'json' ? 'file-prompt' : 'list';
  // Details panel view mode (details or output) - default to details
  const [detailsViewMode, setDetailsViewMode] = useState<DetailsViewMode>('details');
  // Subagent tracing detail level - initialized from config, can be cycled with 't' key
  const [subagentDetailLevel, setSubagentDetailLevel] = useState<SubagentDetailLevel>(
    () => storedConfig?.subagentTracingDetail ?? 'off'
  );
  // Subagent tree for the current iteration (from engine.getSubagentTree())
  const [subagentTree, setSubagentTree] = useState<SubagentTreeNode[]>([]);
  // Set of collapsed subagent IDs (for collapsible sections in output view)
  const [collapsedSubagents, setCollapsedSubagents] = useState<Set<string>>(() => new Set());
  // Currently focused subagent ID for keyboard navigation (future enhancement)
  const [focusedSubagentId, setFocusedSubagentId] = useState<string | undefined>(undefined);
  // Subagent stats cache for iteration history view (keyed by iteration number)
  const [subagentStatsCache, setSubagentStatsCache] = useState<Map<number, SubagentTraceStats>>(
    () => new Map()
  );
  // Subagent trace data for iteration detail view (lazily loaded)
  const [iterationDetailSubagentTree, setIterationDetailSubagentTree] = useState<
    SubagentHierarchyNode[] | undefined
  >(undefined);
  const [iterationDetailSubagentStats, setIterationDetailSubagentStats] = useState<
    SubagentTraceStats | undefined
  >(undefined);
  const [iterationDetailSubagentLoading, setIterationDetailSubagentLoading] = useState(false);
  // Subagent tree panel visibility state (toggled with 'T' key)
  // Tracks subagents even when panel is hidden (subagentTree state continues updating)
  const [subagentPanelVisible, setSubagentPanelVisible] = useState(initialSubagentPanelVisible);

  // Active agent state from engine - tracks which agent is running and why (primary/fallback)
  const [activeAgentState, setActiveAgentState] = useState<ActiveAgentState | null>(null);
  // Rate limit state from engine - tracks primary agent rate limiting
  const [rateLimitState, setRateLimitState] = useState<RateLimitState | null>(null);

  // Compute display agent name - prefer active agent from engine state, fallback to config
  const displayAgentName = activeAgentState?.plugin ?? agentName;

  // Filter and sort tasks for display
  // Sort order: active → actionable → blocked → done → closed
  // This is computed early so keyboard handlers can use displayedTasks.length
  const displayedTasks = useMemo(() => {
    // Status priority for sorting (lower = higher priority)
    const statusPriority: Record<TaskStatus, number> = {
      active: 0,
      actionable: 1,
      pending: 2, // Treat pending same as actionable (shouldn't happen often)
      blocked: 3,
      error: 4, // Failed tasks show after blocked
      done: 5,
      closed: 6,
    };

    const filtered = showClosedTasks ? tasks : tasks.filter((t) => t.status !== 'closed');
    return [...filtered].sort((a, b) => {
      const priorityA = statusPriority[a.status] ?? 10;
      const priorityB = statusPriority[b.status] ?? 10;
      return priorityA - priorityB;
    });
  }, [tasks, showClosedTasks]);

  // Clamp selectedIndex when displayedTasks shrinks (e.g., when hiding closed tasks)
  useEffect(() => {
    if (displayedTasks.length > 0 && selectedIndex >= displayedTasks.length) {
      setSelectedIndex(displayedTasks.length - 1);
    }
  }, [displayedTasks.length, selectedIndex]);

  // Update output parser when agent changes (parser was created before config was loaded)
  useEffect(() => {
    if (agentName) {
      outputParserRef.current.setAgentPlugin(agentName);
    }
  }, [agentName]);

  // Subscribe to engine events
  useEffect(() => {
    const unsubscribe = engine.on((event: EngineEvent) => {
      switch (event.type) {
        case 'engine:started':
          // Engine starting means we're about to select a task
          setStatus('selecting');
          // Initialize task list from engine with proper status mapping
          // Uses convertTasksWithDependencyStatus to determine actionable/blocked
          if (event.tasks && event.tasks.length > 0) {
            setTasks(convertTasksWithDependencyStatus(event.tasks));
          }
          break;

        case 'engine:stopped':
          // Map stop reason to appropriate TUI status for display
          // Clear current task info since we're not executing anymore
          setCurrentTaskId(undefined);
          setCurrentTaskTitle(undefined);
          if (event.reason === 'error') {
            setStatus('error');
          } else if (event.reason === 'completed') {
            setStatus('complete');
          } else if (event.reason === 'no_tasks') {
            setStatus('idle');
          } else {
            setStatus('stopped');
          }
          break;

        case 'engine:paused':
          setStatus('paused');
          break;

        case 'engine:resumed':
          // When resuming, set to selecting until task:selected
          setStatus('selecting');
          break;

        case 'task:selected':
          // Task has been selected, now we're about to execute
          setCurrentTaskId(event.task.id);
          setCurrentTaskTitle(event.task.title);
          setStatus('executing');
          break;

        case 'iteration:started':
          setCurrentIteration(event.iteration);
          setCurrentOutput('');
          setCurrentSegments([]);
          // Reset the streaming parser for the new iteration
          outputParserRef.current.reset();
          // Clear subagent state for new iteration
          setSubagentTree([]);
          setCollapsedSubagents(new Set());
          setFocusedSubagentId(undefined);
          // Set current task info for display
          setCurrentTaskId(event.task.id);
          setCurrentTaskTitle(event.task.title);
          // Capture the iteration start time for timing display
          setCurrentIterationStartedAt(event.timestamp);
          setStatus('executing');
          // Auto-switch to output view when iteration starts
          setDetailsViewMode('output');
          // Update task list to show current task as active
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'active' as TaskStatus } : t
            )
          );
          // Select the active task (index 0 after sorting, since active tasks have highest priority)
          // This is called separately to ensure proper state batching
          setSelectedIndex(0);
          break;

        case 'iteration:completed':
          // Clear current task info and transition back to selecting
          setCurrentTaskId(undefined);
          setCurrentTaskTitle(undefined);
          setCurrentIterationStartedAt(undefined);
          setStatus('selecting');
          if (event.result.taskCompleted) {
            // Update completed task status AND recalculate dependency status for all tasks
            // This ensures that tasks previously blocked by this one become actionable
            setTasks((prev) => {
              const updated = prev.map((t) =>
                t.id === event.result.task.id
                  ? { ...t, status: 'done' as TaskStatus }
                  : t
              );
              // Recalculate blocked/actionable status now that dependencies may have changed
              return recalculateDependencyStatus(updated);
            });
          }
          // Add iteration result to history
          setIterations((prev) => {
            // Replace existing iteration or add new
            const existing = prev.findIndex((i) => i.iteration === event.result.iteration);
            if (existing !== -1) {
              const updated = [...prev];
              updated[existing] = event.result;
              return updated;
            }
            return [...prev, event.result];
          });
          break;

        case 'iteration:failed':
          // Mark task as having an error (not 'blocked' - that's for dependency issues)
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'error' as TaskStatus } : t
            )
          );
          break;

        case 'task:selected':
          // Add task if not present
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === event.task.id);
            if (exists) return prev;
            return [
              ...prev,
              {
                id: event.task.id,
                title: event.task.title,
                status: 'pending' as TaskStatus,
                description: event.task.description,
                iteration: event.iteration,
              },
            ];
          });
          break;

        case 'task:completed':
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'done' as TaskStatus } : t
            )
          );
          break;

        case 'agent:output':
          if (event.stream === 'stdout') {
            // Use streaming parser to extract readable content (filters out verbose JSONL)
            outputParserRef.current.push(event.data);
            setCurrentOutput(outputParserRef.current.getOutput());
            // Also update segments for TUI-native color rendering
            setCurrentSegments(outputParserRef.current.getSegments());
          }
          // Refresh subagent tree from engine (subagent events are processed in engine)
          // Only refresh if subagent tracing is enabled to avoid unnecessary work
          if (subagentDetailLevel !== 'off') {
            setSubagentTree(engine.getSubagentTree());
          }
          break;

        case 'agent:switched':
          // Agent was switched (primary to fallback or recovery)
          setActiveAgentState({
            plugin: event.newAgent,
            reason: event.reason,
            since: event.timestamp,
          });
          if (event.rateLimitState) {
            setRateLimitState(event.rateLimitState);
          }
          break;

        case 'agent:all-limited':
          // All agents (primary + fallbacks) are rate limited
          setRateLimitState(event.rateLimitState);
          break;

        case 'agent:recovery-attempted':
          // Primary agent recovery was attempted
          if (event.success) {
            // Primary recovered - update state to show primary agent again
            setActiveAgentState({
              plugin: event.primaryAgent,
              reason: 'primary',
              since: event.timestamp,
            });
            // Clear rate limit state since primary is recovered
            setRateLimitState(null);
          }
          break;

        case 'tasks:refreshed':
          // Update task list with fresh data from tracker
          setTasks(convertTasksWithDependencyStatus(event.tasks));
          break;

        case 'engine:iterations-added':
          // Update maxIterations state when iterations are added at runtime
          setMaxIterations(event.newMax);
          break;

        case 'engine:iterations-removed':
          // Update maxIterations state when iterations are removed at runtime
          setMaxIterations(event.newMax);
          break;
      }
    });

    return unsubscribe;
  }, [engine, subagentDetailLevel]);

  // Update elapsed time every second - only while executing
  // Timer accumulates total execution time across all iterations
  useEffect(() => {
    // Only run timer when actively executing an iteration
    if (status !== 'executing') {
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Get initial state from engine
  useEffect(() => {
    const state = engine.getState();
    setCurrentIteration(state.currentIteration);
    // Run initial output through parser (engine stores raw output)
    // Ensure parser knows the agent type first
    if (agentName) {
      outputParserRef.current.setAgentPlugin(agentName);
    }
    if (state.currentOutput) {
      outputParserRef.current.push(state.currentOutput);
      setCurrentOutput(outputParserRef.current.getOutput());
    }
    // Initialize active agent and rate limit state from engine
    if (state.activeAgent) {
      setActiveAgentState(state.activeAgent);
    }
    if (state.rateLimitState) {
      setRateLimitState(state.rateLimitState);
    }
  }, [engine, agentName]);

  // Calculate the number of items in iteration history (iterations + pending)
  const iterationHistoryLength = Math.max(iterations.length, totalIterations);

  // Handler for toggling subagent section collapse state
  const handleSubagentToggle = useCallback((id: string) => {
    setCollapsedSubagents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // Update focused subagent when toggling
    setFocusedSubagentId(id);
  }, []);

  // Handle keyboard navigation
  const handleKeyboard = useCallback(
    (key: KeyEvent) => {
      // Handle clipboard copy:
      // - macOS: Cmd+C (meta key)
      // - Linux: Ctrl+Shift+C or Alt+C
      // - Windows: Ctrl+C
      // Note: We check this early so copy works even when dialogs are open
      const isMac = platform() === 'darwin';
      const isWindows = platform() === 'win32';
      const selection = renderer.getSelection();
      const isCopyShortcut = isMac
        ? key.meta && key.name === 'c'
        : isWindows
          ? key.ctrl && key.name === 'c'
          : (key.ctrl && key.shift && key.name === 'c') || (key.option && key.name === 'c');

      if (isCopyShortcut && selection) {
        const selectedText = selection.getSelectedText();
        if (selectedText && selectedText.length > 0) {
          writeToClipboard(selectedText).then((result) => {
            if (result.success) {
              setCopyFeedback(`Copied ${result.charCount} chars`);
            }
          });
        }
        return;
      }

      // When interrupt dialog is showing, only handle y/n/Esc
      if (showInterruptDialog) {
        switch (key.name) {
          case 'y':
            onInterruptConfirm?.();
            break;
          case 'n':
          case 'escape':
            onInterruptCancel?.();
            break;
        }
        return; // Don't process other keys when dialog is showing
      }

      // When quit dialog is showing, handle y/n/Esc
      if (showQuitDialog) {
        switch (key.name) {
          case 'y':
            setShowQuitDialog(false);
            onQuit?.();
            break;
          case 'n':
          case 'escape':
            setShowQuitDialog(false);
            break;
        }
        return; // Don't process other keys when dialog is showing
      }

      // When help overlay is showing, ? or Esc closes it
      if (showHelp) {
        if (key.name === '?' || key.name === 'escape') {
          setShowHelp(false);
        }
        return; // Don't process other keys when help is showing
      }

      // When settings view is showing, let it handle its own keyboard events
      // Closing is handled by SettingsView internally via onClose callback
      if (showSettings) {
        return;
      }

      // When epic loader is showing, only Escape closes it
      // Epic loader handles its own keyboard events via useKeyboard
      if (showEpicLoader) {
        return;
      }

      switch (key.name) {
        case 'q':
          // Show quit confirmation dialog
          setShowQuitDialog(true);
          break;

        case 'escape':
          // In detail view, Esc goes back to list view
          if (viewMode === 'iteration-detail') {
            setViewMode('iterations');
            setDetailIteration(null);
          } else {
            // Show quit confirmation dialog
            setShowQuitDialog(true);
          }
          break;

        case 'up':
        case 'k':
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.max(0, prev - 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.max(0, prev - 1));
          }
          break;

        case 'down':
        case 'j':
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.min(displayedTasks.length - 1, prev + 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.min(iterationHistoryLength - 1, prev + 1));
          }
          break;

        case 'p':
          // Toggle pause/resume
          // When running/executing/selecting, pause will transition to pausing, then to paused
          // When pausing, pressing p again will cancel the pause request
          // When paused, resume will transition back to selecting
          if (status === 'running' || status === 'executing' || status === 'selecting') {
            engine.pause();
            setStatus('pausing');
          } else if (status === 'pausing') {
            // Cancel pause request
            engine.resume();
            setStatus('selecting');
          } else if (status === 'paused') {
            engine.resume();
            // Status will update via engine event
          }
          break;

        // Note: 'c' / Ctrl+C is intentionally NOT handled here.
        // Ctrl+C and Ctrl+Shift+C send the same sequence (\x03) in most terminals,
        // so we can't distinguish between "stop" and "copy". Users should use 'q' to quit.

        case 'v':
          // Toggle between tasks and iterations view (only if not in detail view)
          if (viewMode !== 'iteration-detail') {
            setViewMode((prev) => (prev === 'tasks' ? 'iterations' : 'tasks'));
          }
          break;

        case 'd':
          // Toggle dashboard visibility
          setShowDashboard((prev) => !prev);
          break;

        case 'h':
          // Toggle show/hide closed tasks
          setShowClosedTasks((prev) => !prev);
          break;

        case '?':
          // Show help overlay
          setShowHelp(true);
          break;

        case 's':
          // Start/continue execution - 's' always means "keep going"
          if (status === 'ready' && onStart) {
            // First start - use onStart callback
            setStatus('running');
            onStart();
          } else if (status === 'stopped' || status === 'idle') {
            // Continue after stop - use engine.continueExecution()
            if (currentIteration >= maxIterations) {
              // At max iterations, add one more then continue
              engine.addIterations(1).then((shouldContinue) => {
                if (shouldContinue) {
                  setStatus('running');
                  engine.continueExecution();
                }
              }).catch((err) => {
                console.error('Failed to add iteration:', err);
              });
            } else {
              // Have iterations remaining, just continue
              setStatus('running');
              engine.continueExecution();
            }
          }
          break;

        case 'r':
          // Refresh task list from tracker
          engine.refreshTasks();
          break;

        case '+':
        case '=':
        case '-':
        case '_':
          // Add/remove 10 iterations: +/= add, -/_ remove
          const isPlus = key.name === '+' || key.name === '=';
          const isMinus = key.name === '-' || key.name === '_';
          if ((isPlus || isMinus) &&
              (status === 'ready' || status === 'running' || status === 'executing' || status === 'paused' || status === 'stopped' || status === 'idle' || status === 'complete')) {
            if (isPlus) {
              engine.addIterations(10).then((shouldContinue) => {
                if (shouldContinue || status === 'complete') {
                  setStatus('running');
                  engine.continueExecution();
                }
              }).catch((err) => {
                console.error('Failed to add iterations:', err);
              });
            } else {
              engine.removeIterations(10)
                .then((success) => {
                  if (!success) {
                    console.log('Cannot reduce below current iteration or minimum of 1');
                  }
                })
                .catch((err) => {
                  console.error('Failed to remove iterations:', err);
                });
            }
          }
          break;

        case ',':
          // Open settings view (comma key, like many text editors)
          if (storedConfig && onSaveSettings) {
            setShowSettings(true);
          }
          break;

        case 'l':
          // Open epic loader to switch epics (only when not executing)
          if (onLoadEpics && (status === 'ready' || status === 'paused' || status === 'stopped' || status === 'idle' || status === 'complete' || status === 'error')) {
            setShowEpicLoader(true);
            setEpicLoaderLoading(true);
            setEpicLoaderError(undefined);
            // Load epics asynchronously
            onLoadEpics()
              .then((loadedEpics) => {
                setEpicLoaderEpics(loadedEpics);
                setEpicLoaderLoading(false);
              })
              .catch((err) => {
                setEpicLoaderError(err instanceof Error ? err.message : 'Failed to load epics');
                setEpicLoaderLoading(false);
              });
          }
          break;

        case 'o':
          // Toggle between details and output view in the right panel
          setDetailsViewMode((prev) => (prev === 'details' ? 'output' : 'details'));
          break;

        case 't':
          // Check if Shift+T (uppercase) - toggle subagent tree panel
          // key.sequence contains the actual character ('T' for Shift+T, 't' for plain t)
          if (key.sequence === 'T') {
            // Toggle subagent tree panel visibility (Shift+T)
            // The panel shows on the right side; subagent tracking continues even when hidden
            setSubagentPanelVisible((prev) => {
              const newVisible = !prev;
              // Persist the change to session state
              onSubagentPanelVisibilityChange?.(newVisible);
              return newVisible;
            });
          } else {
            // Cycle through subagent detail levels: off → minimal → moderate → full → off
            setSubagentDetailLevel((prev) => {
              const levels: SubagentDetailLevel[] = ['off', 'minimal', 'moderate', 'full'];
              const currentIdx = levels.indexOf(prev);
              const nextIdx = (currentIdx + 1) % levels.length;
              const nextLevel = levels[nextIdx]!;
              // Persist the change if onSaveSettings is available
              if (storedConfig && onSaveSettings) {
                const newConfig = { ...storedConfig, subagentTracingDetail: nextLevel };
                onSaveSettings(newConfig).catch(() => {
                  // Ignore save errors for quick toggle - setting is still in-memory
                });
              }
              return nextLevel;
            });
          }
          break;

        case 'return':
        case 'enter':
          // Enter drills into iteration details (does NOT start execution - use 's' for that)
          // Note: Task details are shown inline in RightPanel, no separate drill-down needed
          if (viewMode === 'iterations') {
            // Drill into selected iteration details
            if (iterations[iterationSelectedIndex]) {
              setDetailIteration(iterations[iterationSelectedIndex]);
              setViewMode('iteration-detail');
              onIterationDrillDown?.(iterations[iterationSelectedIndex]);
            }
          }
          break;
      }
    },
    [displayedTasks, selectedIndex, status, engine, onQuit, viewMode, iterations, iterationSelectedIndex, iterationHistoryLength, onIterationDrillDown, showInterruptDialog, onInterruptConfirm, onInterruptCancel, showHelp, showSettings, showQuitDialog, showEpicLoader, onStart, storedConfig, onSaveSettings, onLoadEpics, subagentDetailLevel, onSubagentPanelVisibilityChange, currentIteration, maxIterations, renderer]
  );

  useKeyboard(handleKeyboard);

  // Calculate layout - account for dashboard height when visible
  const dashboardHeight = showDashboard ? layout.progressDashboard.height : 0;
  const contentHeight = Math.max(
    1,
    height - layout.header.height - layout.footer.height - dashboardHeight
  );
  const isCompact = width < 80;

  // Calculate completed tasks (counting both 'done' and 'closed' as completed)
  // 'done' = completed in current session, 'closed' = historically completed
  const completedTasks = tasks.filter(
    (t) => t.status === 'done' || t.status === 'closed'
  ).length;
  const totalTasks = tasks.length;

  // Get selected task from filtered list
  const selectedTask = displayedTasks[selectedIndex] ?? null;

  // Compute the iteration output and timing to show for the selected task
  // - If selected task is currently executing: show live currentOutput with isRunning + segments
  // - If selected task has a completed iteration: show that iteration's output with timing
  // - Otherwise: undefined (will show "waiting" or appropriate message)
  const selectedTaskIteration = useMemo(() => {
    // If no selected task, check if there's currently executing task and show that
    if (!selectedTask) {
      // If there's a current task executing, show its output even if no task selected
      if (currentTaskId) {
        const timing: IterationTimingInfo = {
          startedAt: currentIterationStartedAt,
          isRunning: true,
        };
        return { iteration: currentIteration, output: currentOutput, segments: currentSegments, timing };
      }
      return { iteration: currentIteration, output: undefined, segments: undefined, timing: undefined };
    }

    // Check if this task is currently being executed
    // Use both ID match AND status check for robustness against state timing issues
    const isExecuting = currentTaskId === selectedTask.id || selectedTask.status === 'active';
    if (isExecuting && currentTaskId) {
      // Use the captured start time from the iteration:started event
      const timing: IterationTimingInfo = {
        startedAt: currentIterationStartedAt,
        isRunning: true,
      };
      return { iteration: currentIteration, output: currentOutput, segments: currentSegments, timing };
    }

    // Look for a completed iteration for this task (in-memory from current session)
    const taskIteration = iterations.find((iter) => iter.task.id === selectedTask.id);
    if (taskIteration) {
      const timing: IterationTimingInfo = {
        startedAt: taskIteration.startedAt,
        endedAt: taskIteration.endedAt,
        durationMs: taskIteration.durationMs,
        isRunning: taskIteration.status === 'running',
      };
      return {
        iteration: taskIteration.iteration,
        output: taskIteration.agentResult?.stdout ?? '',
        segments: undefined, // Completed iterations don't have live segments
        timing,
      };
    }

    // Check historical output cache (loaded from disk)
    const historicalData = historicalOutputCache.get(selectedTask.id);
    if (historicalData !== undefined) {
      return {
        iteration: -1, // Historical iteration number unknown, use -1 to indicate "past"
        output: historicalData.output,
        segments: undefined, // Historical data doesn't have segments
        timing: historicalData.timing,
      };
    }

    // Task hasn't been run yet (or historical log not yet loaded)
    return { iteration: 0, output: undefined, segments: undefined, timing: undefined };
  }, [selectedTask, currentTaskId, currentIteration, currentOutput, currentSegments, iterations, historicalOutputCache]);

  // Load historical iteration logs from disk when a completed task is selected
  useEffect(() => {
    if (!selectedTask) return;
    if (!cwd) return;

    // Only load if task is done/closed and not already in cache or in-memory iterations
    const isCompleted = selectedTask.status === 'done' || selectedTask.status === 'closed';
    const hasInMemory = iterations.some((iter) => iter.task.id === selectedTask.id);
    const hasInCache = historicalOutputCache.has(selectedTask.id);

    if (isCompleted && !hasInMemory && !hasInCache) {
      // Load from disk asynchronously
      getIterationLogsByTask(cwd, selectedTask.id).then((logs) => {
        if (logs.length > 0) {
          // Use the most recent log (last one)
          const mostRecent = logs[logs.length - 1];
          const timing: IterationTimingInfo = {
            startedAt: mostRecent.metadata.startedAt,
            endedAt: mostRecent.metadata.endedAt,
            durationMs: mostRecent.metadata.durationMs,
            isRunning: false,
          };
          setHistoricalOutputCache((prev) => {
            const next = new Map(prev);
            next.set(selectedTask.id, { output: mostRecent.stdout, timing });
            return next;
          });
        } else {
          // No logs found - mark as empty output with no timing to avoid repeated lookups
          setHistoricalOutputCache((prev) => {
            const next = new Map(prev);
            next.set(selectedTask.id, { output: '', timing: {} });
            return next;
          });
        }
      });
    }
  }, [selectedTask, cwd, iterations, historicalOutputCache]);

  // Lazy load subagent trace data when viewing iteration details
  useEffect(() => {
    if (viewMode !== 'iteration-detail' || !detailIteration || !cwd) {
      // Clear data when not in detail view
      setIterationDetailSubagentTree(undefined);
      setIterationDetailSubagentStats(undefined);
      setIterationDetailSubagentLoading(false);
      return;
    }

    // Check if we already have the stats cached
    const cachedStats = subagentStatsCache.get(detailIteration.iteration);
    if (cachedStats) {
      setIterationDetailSubagentStats(cachedStats);
    }

    // Load the full trace data from the log file
    setIterationDetailSubagentLoading(true);

    // Find the log file for this iteration
    getIterationLogsByTask(cwd, detailIteration.task.id).then(async (logs) => {
      // Find the log matching this iteration number
      const log = logs.find((l) => l.metadata.iteration === detailIteration.iteration);
      if (log && log.subagentTrace) {
        setIterationDetailSubagentTree(log.subagentTrace.hierarchy);
        setIterationDetailSubagentStats(log.subagentTrace.stats);
        // Cache the stats for the history view
        setSubagentStatsCache((prev) => {
          const next = new Map(prev);
          next.set(detailIteration.iteration, log.subagentTrace!.stats);
          return next;
        });
      } else {
        setIterationDetailSubagentTree(undefined);
        setIterationDetailSubagentStats(undefined);
      }
      setIterationDetailSubagentLoading(false);
    }).catch(() => {
      setIterationDetailSubagentLoading(false);
      setIterationDetailSubagentTree(undefined);
      setIterationDetailSubagentStats(undefined);
    });
  }, [viewMode, detailIteration, cwd, subagentStatsCache]);

  // Also load subagent stats for all iterations when viewing history (lazy background loading)
  useEffect(() => {
    if (viewMode !== 'iterations' || !cwd || iterations.length === 0) {
      return;
    }

    // Load stats for iterations we don't have cached yet
    const loadMissingStats = async () => {
      for (const iter of iterations) {
        if (!subagentStatsCache.has(iter.iteration)) {
          try {
            const logs = await getIterationLogsByTask(cwd, iter.task.id);
            const log = logs.find((l) => l.metadata.iteration === iter.iteration);
            if (log?.subagentTrace?.stats) {
              setSubagentStatsCache((prev) => {
                const next = new Map(prev);
                next.set(iter.iteration, log.subagentTrace!.stats);
                return next;
              });
            }
          } catch {
            // Ignore errors loading individual stats
          }
        }
      }
    };

    loadMissingStats();
  }, [viewMode, iterations, cwd, subagentStatsCache]);

  // Auto-dismiss copy feedback after 2 seconds
  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => {
      setCopyFeedback(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Header - compact design showing essential info + agent/tracker + fallback status */}
      <Header
        status={status}
        elapsedTime={elapsedTime}
        currentTaskId={currentTaskId}
        currentTaskTitle={currentTaskTitle}
        completedTasks={completedTasks}
        totalTasks={totalTasks}
        agentName={agentName}
        trackerName={trackerName}
        activeAgentState={activeAgentState}
        rateLimitState={rateLimitState}
        currentIteration={currentIteration}
        maxIterations={maxIterations}
        currentModel={currentModel}
        sandboxConfig={sandboxConfig}
        resolvedSandboxMode={resolvedSandboxMode}
      />

      {/* Progress Dashboard - toggleable with 'd' key */}
      {showDashboard && (
        <ProgressDashboard
          status={status}
          agentName={displayAgentName}
          currentModel={currentModel}
          trackerName={trackerName || 'beads'}
          epicName={epicName}
          currentTaskId={currentTaskId}
          currentTaskTitle={currentTaskTitle}
          sandboxConfig={sandboxConfig}
          resolvedSandboxMode={resolvedSandboxMode}
        />
      )}

      {/* Main content area */}
      <box
        style={{
          flexGrow: 1,
          flexDirection: isCompact ? 'column' : 'row',
          height: contentHeight,
        }}
      >
        {viewMode === 'iteration-detail' && detailIteration ? (
          // Full-screen iteration detail view
          <IterationDetailView
            iteration={detailIteration}
            totalIterations={totalIterations}
            onBack={() => {
              setViewMode('iterations');
              setDetailIteration(null);
            }}
            subagentTree={iterationDetailSubagentTree}
            subagentStats={iterationDetailSubagentStats}
            subagentTraceLoading={iterationDetailSubagentLoading}
            sandboxConfig={sandboxConfig}
            resolvedSandboxMode={resolvedSandboxMode}
          />
        ) : viewMode === 'tasks' ? (
          <>
            <LeftPanel tasks={displayedTasks} selectedIndex={selectedIndex} />
            <RightPanel
              selectedTask={selectedTask}
              currentIteration={selectedTaskIteration.iteration}
              iterationOutput={selectedTaskIteration.output}
              iterationSegments={selectedTaskIteration.segments}
              viewMode={detailsViewMode}
              iterationTiming={selectedTaskIteration.timing}
              agentName={displayAgentName}
              currentModel={currentModel}
              subagentDetailLevel={subagentDetailLevel}
              subagentTree={subagentTree}
              collapsedSubagents={collapsedSubagents}
              focusedSubagentId={focusedSubagentId}
              onSubagentToggle={handleSubagentToggle}
            />
            {/* Subagent Tree Panel - shown on right side when toggled with 'T' key */}
            {subagentPanelVisible && (
              <SubagentTreePanel
                tree={subagentTree}
                activeSubagentId={focusedSubagentId}
                width={45}
              />
            )}
          </>
        ) : (
          <>
            <IterationHistoryView
              iterations={iterations}
              totalIterations={totalIterations}
              selectedIndex={iterationSelectedIndex}
              runningIteration={currentIteration}
              width={isCompact ? width : Math.floor(width * 0.5)}
              subagentStats={subagentStatsCache}
            />
            <RightPanel
              selectedTask={selectedTask}
              currentIteration={selectedTaskIteration.iteration}
              iterationOutput={selectedTaskIteration.output}
              iterationSegments={selectedTaskIteration.segments}
              viewMode={detailsViewMode}
              iterationTiming={selectedTaskIteration.timing}
              agentName={displayAgentName}
              currentModel={currentModel}
              subagentDetailLevel={subagentDetailLevel}
              subagentTree={subagentTree}
              collapsedSubagents={collapsedSubagents}
              focusedSubagentId={focusedSubagentId}
              onSubagentToggle={handleSubagentToggle}
            />
            {/* Subagent Tree Panel - shown on right side when toggled with 'T' key */}
            {subagentPanelVisible && (
              <SubagentTreePanel
                tree={subagentTree}
                activeSubagentId={focusedSubagentId}
                width={45}
              />
            )}
          </>
        )}
      </box>

      {/* Footer */}
      <Footer />

      {/* Copy feedback toast - positioned at bottom right */}
      {copyFeedback && (
        <box
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: colors.bg.tertiary,
            border: true,
            borderColor: colors.status.success,
          }}
        >
          <text fg={colors.status.success}>✓ {copyFeedback}</text>
        </box>
      )}

      {/* Interrupt Confirmation Dialog */}
      <ConfirmationDialog
        visible={showInterruptDialog}
        title="⚠ Interrupt Ralph?"
        message="Current iteration will be terminated."
        hint="[y] Yes  [n/Esc] No  [Ctrl+C] Force quit"
      />

      {/* Quit Confirmation Dialog */}
      <ConfirmationDialog
        visible={showQuitDialog}
        title="Quit Ralph?"
        message="Session will be saved and can be resumed later."
        hint="[y] Yes  [n/Esc] Cancel"
      />

      {/* Help Overlay */}
      <HelpOverlay visible={showHelp} />

      {/* Settings View */}
      {storedConfig && onSaveSettings && (
        <SettingsView
          visible={showSettings}
          config={storedConfig}
          agents={availableAgents}
          trackers={availableTrackers}
          onSave={onSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Epic Loader Overlay */}
      <EpicLoaderOverlay
        visible={showEpicLoader}
        mode={epicLoaderMode}
        epics={epicLoaderEpics}
        loading={epicLoaderLoading}
        error={epicLoaderError}
        trackerName={trackerName}
        currentEpicId={currentEpicId}
        onSelect={async (epic) => {
          if (onEpicSwitch) {
            await onEpicSwitch(epic);
          }
          setShowEpicLoader(false);
        }}
        onCancel={() => setShowEpicLoader(false)}
        onFilePath={async (path) => {
          if (onFilePathSwitch) {
            const success = await onFilePathSwitch(path);
            if (success) {
              setShowEpicLoader(false);
            } else {
              setEpicLoaderError(`Failed to load file: ${path}`);
            }
          }
        }}
      />
    </box>
  );
}
