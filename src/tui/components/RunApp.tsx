/**
 * ABOUTME: RunApp component for the Ralph TUI execution view.
 * Integrates with the execution engine to display real-time progress.
 * US-5: Extended with connection resilience toast notifications.
 * Handles graceful interruption with confirmation dialog.
 */

import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useMemo, useRef, startTransition } from 'react';
import { colors, layout } from '../theme.js';
import type { RalphStatus, TaskStatus } from '../theme.js';
import type { TaskItem, BlockerInfo, DetailsViewMode, IterationTimingInfo, SubagentTreeNode } from '../types.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { LeftPanel } from './LeftPanel.js';
import { RightPanel } from './RightPanel.js';
import { IterationHistoryView } from './IterationHistoryView.js';
import { IterationDetailView } from './IterationDetailView.js';
import type { HistoricExecutionContext } from './IterationDetailView.js';
import { ProgressDashboard } from './ProgressDashboard.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import { HelpOverlay } from './HelpOverlay.js';
import { SettingsView } from './SettingsView.js';
import { EpicLoaderOverlay } from './EpicLoaderOverlay.js';
import type { EpicLoaderMode } from './EpicLoaderOverlay.js';
import { SubagentTreePanel } from './SubagentTreePanel.js';
import { ParallelProgressView } from './ParallelProgressView.js';
import { WorkerDetailView } from './WorkerDetailView.js';
import { MergeProgressView } from './MergeProgressView.js';
import { ConflictResolutionPanel } from './ConflictResolutionPanel.js';
import { TabBar } from './TabBar.js';
import { RemoteConfigView } from './RemoteConfigView.js';
import type { RemoteConfigData } from './RemoteConfigView.js';
import { RemoteManagementOverlay } from './RemoteManagementOverlay.js';
import type { RemoteManagementMode, ExistingRemoteData } from './RemoteManagementOverlay.js';
import { Toast, formatConnectionToast } from './Toast.js';
import type { ConnectionToastMessage } from './Toast.js';
import type { InstanceTab } from '../../remote/client.js';
import { addRemote, removeRemote, getRemote } from '../../remote/config.js';
import type {
  ExecutionEngine,
  EngineEvent,
  IterationResult,
  ActiveAgentState,
  RateLimitState,
} from '../../engine/index.js';
import type { TrackerTask } from '../../plugins/trackers/types.js';
import type { StoredConfig, SubagentDetailLevel, SandboxConfig, SandboxMode } from '../../config/types.js';
import type { TrackerPluginMeta } from '../../plugins/trackers/types.js';
import { getIterationLogsByTask } from '../../logs/index.js';
import type { SubagentTraceStats, SubagentHierarchyNode } from '../../logs/types.js';
import { platform } from 'node:os';
import { writeToClipboard } from '../../utils/index.js';
import { StreamingOutputParser } from '../output-parser.js';
import type { FormattedSegment } from '../../plugins/agents/output-formatting.js';
import {
  summarizeTokenUsageFromOutput,
  withContextWindow,
  type TokenUsageSummary,
} from '../../plugins/agents/usage.js';
import { getModelsForProvider, getProviders } from '../../models-dev/index.js';
import type {
  WorkerDisplayState,
  MergeOperation,
  FileConflict,
  ConflictResolutionResult,
} from '../../parallel/types.js';

/**
 * View modes for the RunApp component
 * - 'tasks': Show the task list (default)
 * - 'iterations': Show the iteration history
 * - 'iteration-detail': Show detailed view of a single iteration
 * Note: Task details are now shown inline in the RightPanel, not as a separate view
 */
type ViewMode = 'tasks' | 'iterations' | 'iteration-detail' | 'parallel-overview' | 'parallel-detail' | 'merge-progress';

/**
 * Focused pane for TAB-based navigation between panels.
 * - 'output': RightPanel output view has keyboard focus (j/k scroll output)
 * - 'subagentTree': SubagentTreePanel has keyboard focus (j/k select nodes)
 */
type FocusedPane = 'output' | 'subagentTree';

/**
 * Props for the RunApp component
 */
export interface RunAppProps {
  /** The execution engine instance (optional in parallel mode where workers have their own engines) */
  engine?: ExecutionEngine;
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
  /** Available agent names (for settings view) */
  availableAgents?: string[];
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
  /** Custom command path for the agent (if configured, e.g., 'claude-glm' instead of default 'claude') */
  agentCommand?: string;
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
  /** Instance tabs for remote navigation (local first, then remotes) */
  instanceTabs?: InstanceTab[];
  /** Currently selected instance tab index */
  selectedTabIndex?: number;
  /** Callback when a tab is selected */
  onSelectTab?: (index: number) => void;
  /** Connection toast to display (from InstanceManager) */
  connectionToast?: ConnectionToastMessage | null;
  /** Instance manager for remote data fetching */
  instanceManager?: import('../../remote/instance-manager.js').InstanceManager;
  /** Whether to show the epic loader immediately on startup (for json tracker without PRD path) */
  initialShowEpicLoader?: boolean;
  /** Local git repository info (from server's working directory) */
  localGitInfo?: {
    repoName?: string;
    branch?: string;
    isDirty?: boolean;
    commitHash?: string;
  };
  /** Whether parallel execution is active */
  isParallelMode?: boolean;
  /** Parallel workers state (when parallel mode is active) */
  parallelWorkers?: WorkerDisplayState[];
  /** Worker output lines keyed by worker ID */
  parallelWorkerOutputs?: Map<string, string[]>;
  /** Merge queue state (when parallel mode is active) */
  parallelMergeQueue?: MergeOperation[];
  /** Current parallel group index (0-based) */
  parallelCurrentGroup?: number;
  /** Total number of parallel groups */
  parallelTotalGroups?: number;
  /** Session backup tag for rollback */
  parallelSessionBackupTag?: string;
  /** Active file conflicts during merge (for conflict panel) */
  parallelConflicts?: FileConflict[];
  /** Conflict resolution results */
  parallelConflictResolutions?: ConflictResolutionResult[];
  /** Task ID of the conflicting merge */
  parallelConflictTaskId?: string;
  /** Task title of the conflicting merge */
  parallelConflictTaskTitle?: string;
  /** Whether AI conflict resolution is running */
  parallelAiResolving?: boolean;
  /** The file currently being resolved by AI */
  parallelCurrentlyResolvingFile?: string;
  /** Whether to show the conflict panel (true during Phase 2 conflict resolution) */
  parallelShowConflicts?: boolean;
  /** Maps task IDs to worker IDs for output routing in parallel mode */
  parallelTaskIdToWorkerId?: Map<string, string>;
  /** Task IDs that completed locally but merge failed (shows ⚠ in TUI) */
  parallelCompletedLocallyTaskIds?: Set<string>;
  /** Task IDs where auto-commit was skipped (e.g., files were gitignored) */
  parallelAutoCommitSkippedTaskIds?: Set<string>;
  /** Task IDs that have been successfully merged (shows ✓ done in TUI) */
  parallelMergedTaskIds?: Set<string>;
  /** Number of currently active (running) workers */
  activeWorkerCount?: number;
  /** Total number of workers */
  totalWorkerCount?: number;
  /** Failure message for parallel execution */
  parallelFailureMessage?: string;
  /** Callback to pause parallel execution */
  onParallelPause?: () => void;
  /** Callback to resume parallel execution */
  onParallelResume?: () => void;
  /** Callback to immediately kill all parallel workers */
  onParallelKill?: () => Promise<void>;
  /** Callback to restart parallel execution after stop/complete */
  onParallelStart?: () => void;
  /** Callback when user requests conflict resolution retry (r key in failure state) */
  onConflictRetry?: () => void;
  /** Callback when user requests to skip a failed merge (s key in failure state) */
  onConflictSkip?: () => void;
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
 * Also computes the 'blocks' field (inverse of dependsOn) for each task.
 */
function convertTasksWithDependencyStatus(trackerTasks: TrackerTask[]): TaskItem[] {
  // First, create a map of task IDs to their status and title for quick lookup
  const taskMap = new Map<string, { status: string; title: string }>();
  for (const task of trackerTasks) {
    taskMap.set(task.id, { status: task.status, title: task.title });
  }

  // Build the inverse relationship: which tasks does each task block?
  // If task A dependsOn task B, then B blocks A
  const blocksMap = new Map<string, string[]>();
  for (const task of trackerTasks) {
    if (task.dependsOn && task.dependsOn.length > 0) {
      for (const depId of task.dependsOn) {
        const existing = blocksMap.get(depId) || [];
        existing.push(task.id);
        blocksMap.set(depId, existing);
      }
    }
  }

  // Convert each task, determining actionable/blocked based on dependencies
  return trackerTasks.map((task) => {
    const baseItem = trackerTaskToTaskItem(task);

    // Add the computed 'blocks' field only if tracker didn't provide it
    // (beads trackers provide this from CLI, JSON tracker needs computation)
    if (!baseItem.blocks || baseItem.blocks.length === 0) {
      const blocksIds = blocksMap.get(task.id);
      if (blocksIds && blocksIds.length > 0) {
        baseItem.blocks = blocksIds;
      }
    }

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

function parseProviderModel(model?: string): { providerId: string; modelId: string } | null {
  if (!model || !model.includes('/')) {
    return null;
  }
  const [providerId, ...rest] = model.split('/');
  const modelId = rest.join('/');
  if (!providerId || !modelId) {
    return null;
  }
  return { providerId, modelId };
}

function getFallbackContextWindow(model?: string, agentHint?: string): number | undefined {
  const normalizedModel = model?.trim().toLowerCase() ?? '';
  const normalizedAgent = agentHint?.trim().toLowerCase();
  const modelPart = normalizedModel.includes('/')
    ? normalizedModel.split('/').slice(1).join('/')
    : normalizedModel;

  // Claude CLI often uses shorthand model names ("sonnet", "opus", "haiku")
  // that cannot be resolved via models.dev without provider/model format.
  if (
    normalizedAgent === 'claude' ||
    modelPart === 'sonnet' ||
    modelPart === 'opus' ||
    modelPart === 'haiku' ||
    modelPart.startsWith('claude-') ||
    modelPart.includes('claude')
  ) {
    return 200_000;
  }

  return undefined;
}

function normalizeUsage(usage: TokenUsageSummary, contextWindow?: number): TokenUsageSummary {
  const normalizedTotal =
    usage.totalTokens > 0 ? usage.totalTokens : usage.inputTokens + usage.outputTokens;
  return withContextWindow({ ...usage, totalTokens: normalizedTotal }, contextWindow);
}

function areUsageSummariesEqual(
  a: TokenUsageSummary | undefined,
  b: TokenUsageSummary | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.totalTokens === b.totalTokens &&
    a.contextWindowTokens === b.contextWindowTokens &&
    a.remainingContextTokens === b.remainingContextTokens &&
    a.remainingContextPercent === b.remainingContextPercent &&
    a.events === b.events
  );
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
  agentCommand,
  currentEpicId,
  initialSubagentPanelVisible = false,
  onSubagentPanelVisibilityChange,
  currentModel,
  sandboxConfig,
  resolvedSandboxMode,
  instanceTabs,
  selectedTabIndex = 0,
  onSelectTab,
  connectionToast,
  instanceManager,
  initialShowEpicLoader = false,
  localGitInfo,
  isParallelMode = false,
  parallelWorkers = [],
  parallelWorkerOutputs,
  parallelMergeQueue = [],
  parallelCurrentGroup = 0,
  parallelTotalGroups = 0,
  parallelSessionBackupTag,
  parallelConflicts = [],
  parallelConflictResolutions = [],
  parallelConflictTaskId = '',
  parallelConflictTaskTitle = '',
  parallelAiResolving = false,
  parallelCurrentlyResolvingFile = '',
  parallelShowConflicts = false,
  parallelTaskIdToWorkerId,
  parallelCompletedLocallyTaskIds,
  parallelAutoCommitSkippedTaskIds: _parallelAutoCommitSkippedTaskIds, // Reserved for future status bar warning
  parallelMergedTaskIds,
  parallelFailureMessage,
  activeWorkerCount,
  totalWorkerCount,
  onParallelPause,
  onParallelResume,
  onParallelKill,
  onParallelStart,
  onConflictRetry,
  onConflictSkip,
}: RunAppProps): ReactNode {
  const { width, height } = useTerminalDimensions();
  const renderer = useRenderer();
  // Copy feedback message state (auto-dismissed after 2s)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  useEffect(() => {
    if (isParallelMode && parallelFailureMessage) {
      setStatus('error');
    }
  }, [isParallelMode, parallelFailureMessage]);
  // Info feedback message state (auto-dismissed after 4s, for hints/tips)
  const [infoFeedback, setInfoFeedback] = useState<string | null>(null);
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
    // Initialize from engine if available (engine is absent in parallel mode)
    if (engine) {
      const info = engine.getIterationInfo();
      return info.maxIterations;
    }
    return 0;
  });
  const [currentOutput, setCurrentOutput] = useState('');
  const [currentSegments, setCurrentSegments] = useState<FormattedSegment[]>([]);
  const [taskUsageMap, setTaskUsageMap] = useState<Map<string, TokenUsageSummary>>(
    () => new Map()
  );
  // Streaming parser for live output - extracts readable content and prevents memory bloat
  // Use agentPlugin prop (from resolved config with CLI override) with fallback to storedConfig
  const resolvedAgentName = agentPlugin || storedConfig?.defaultAgent || storedConfig?.agent || 'claude';
  const outputParserRef = useRef(
    new StreamingOutputParser({
      agentPlugin: resolvedAgentName,
    })
  );
  const currentTaskIdRef = useRef<string | undefined>(undefined);
  const localContextWindowRef = useRef<number | undefined>(undefined);
  const [localContextWindow, setLocalContextWindow] = useState<number | undefined>(undefined);
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
  // Always start with the task list view — parallel mode shows multiple ▶ tasks natively
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [iterationSelectedIndex, setIterationSelectedIndex] = useState(0);
  // Iteration detail view state
  const [detailIteration, setDetailIteration] = useState<IterationResult | null>(null);
  // Help overlay state
  const [showHelp, setShowHelp] = useState(false);
  // Settings view state
  const [showSettings, setShowSettings] = useState(false);
  // Remote config view state
  const [showRemoteConfig, setShowRemoteConfig] = useState(false);
  const [remoteConfigData, setRemoteConfigData] = useState<RemoteConfigData | null>(null);
  const [remoteConfigLoading, setRemoteConfigLoading] = useState(false);
  const [remoteConfigError, setRemoteConfigError] = useState<string | undefined>(undefined);
  // Remote management overlay state (add/edit/delete remotes)
  const [showRemoteManagement, setShowRemoteManagement] = useState(false);
  const [remoteManagementMode, setRemoteManagementMode] = useState<RemoteManagementMode>('add');
  const [editingRemote, setEditingRemote] = useState<ExistingRemoteData | undefined>(undefined);
  // Quit confirmation dialog state
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  // Kill confirmation dialog state (parallel mode: immediately terminate all workers)
  const [showKillDialog, setShowKillDialog] = useState(false);
  // Parallel mode state
  const [selectedWorkerIndex, setSelectedWorkerIndex] = useState(0);
  const [showConflictPanel, setShowConflictPanel] = useState(false);
  const [conflictSelectedIndex, setConflictSelectedIndex] = useState(0);
  // Show/hide closed tasks filter (default: show closed tasks)
  const [showClosedTasks, setShowClosedTasks] = useState(true);
  // Cache for historical iteration output loaded from disk (taskId -> { output, timing, agent, model })
  const [historicalOutputCache, setHistoricalOutputCache] = useState<
    Map<string, {
      output: string;
      timing: IterationTimingInfo;
      usage?: TokenUsageSummary;
      agentPlugin?: string;
      model?: string;
    }>
  >(() => new Map());
  // Current task info for status display
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>(undefined);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string | undefined>(undefined);
  // Current iteration start time (ISO timestamp)
  const [currentIterationStartedAt, setCurrentIterationStartedAt] = useState<string | undefined>(undefined);
  // Epic loader overlay state (may start visible for json tracker without PRD path)
  const [showEpicLoader, setShowEpicLoader] = useState(initialShowEpicLoader);
  const [epicLoaderEpics, setEpicLoaderEpics] = useState<TrackerTask[]>([]);
  const [epicLoaderLoading, setEpicLoaderLoading] = useState(false);
  const [epicLoaderError, setEpicLoaderError] = useState<string | undefined>(undefined);
  // Determine epic loader mode based on tracker type
  const epicLoaderMode: EpicLoaderMode = trackerType === 'json' ? 'file-prompt' : 'list';
  // Details panel view mode (details, output, or prompt) - default to details
  const [detailsViewMode, setDetailsViewMode] = useState<DetailsViewMode>('details');
  // Prompt preview content and template source (for prompt view mode)
  const [promptPreview, setPromptPreview] = useState<string | undefined>(undefined);
  const [templateSource, setTemplateSource] = useState<string | undefined>(undefined);
  // Subagent tracing detail level - initialized from config, can be cycled with 't' key
  // Default to 'moderate' to show inline subagent sections by default
  const [subagentDetailLevel, setSubagentDetailLevel] = useState<SubagentDetailLevel>(
    () => storedConfig?.subagentTracingDetail ?? 'moderate'
  );
  // Subagent tree for the current iteration (from engine.getSubagentTree())
  const [subagentTree, setSubagentTree] = useState<SubagentTreeNode[]>([]);
  // Remote subagent tree (for remote viewing)
  const [remoteSubagentTree, setRemoteSubagentTree] = useState<SubagentTreeNode[]>([]);
  // Currently focused subagent ID for keyboard navigation
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
  // Historic execution context for iteration detail view (loaded from persisted logs)
  const [iterationDetailHistoricContext, setIterationDetailHistoricContext] = useState<
    HistoricExecutionContext | undefined
  >(undefined);
  // Subagent tree panel visibility state (toggled with 'T' key)
  // Tracks subagents even when panel is hidden (subagentTree state continues updating)
  const [subagentPanelVisible, setSubagentPanelVisible] = useState(initialSubagentPanelVisible);
  // Track if user manually hid the panel (to respect user intent for auto-show logic)
  // When true, auto-show will not override user's explicit hide action
  const [userManuallyHidPanel, setUserManuallyHidPanel] = useState(false);

  // Focused pane for TAB-based navigation between output and subagent tree
  // - 'output': j/k scroll output content (default)
  // - 'subagentTree': j/k select nodes in the tree
  const [focusedPane, setFocusedPane] = useState<FocusedPane>('output');

  // Selected node in subagent tree for keyboard navigation
  // - currentTaskId (or 'main' if no task): Task root node is selected
  // - string: Subagent ID is selected
  const [selectedSubagentId, setSelectedSubagentId] = useState<string>('main');

  // Active agent state from engine - tracks which agent is running and why (primary/fallback)
  const [activeAgentState, setActiveAgentState] = useState<ActiveAgentState | null>(null);
  // Rate limit state from engine - tracks primary agent rate limiting
  const [rateLimitState, setRateLimitState] = useState<RateLimitState | null>(null);
  // Runtime-detected model from agent telemetry (falls back to configured model when unavailable)
  const [detectedModel, setDetectedModel] = useState<string | undefined>(currentModel);

  // Remote viewing state
  const isViewingRemote = selectedTabIndex > 0;
  const [remoteTasks, setRemoteTasks] = useState<TaskItem[]>([]);
  const [remoteStatus, setRemoteStatus] = useState<RalphStatus>('ready');
  const [remoteOutput, setRemoteOutput] = useState('');
  const [remoteCurrentIteration, setRemoteCurrentIteration] = useState(0);
  const [remoteMaxIterations, setRemoteMaxIterations] = useState(10);
  const [remoteCurrentTaskId, setRemoteCurrentTaskId] = useState<string | undefined>(undefined);
  const [remoteActiveAgent, setRemoteActiveAgent] = useState<ActiveAgentState | null>(null);
  const [remoteRateLimitState, setRemoteRateLimitState] = useState<RateLimitState | null>(null);
  const [remoteCurrentTaskTitle, setRemoteCurrentTaskTitle] = useState<string | undefined>(undefined);
  const [remoteAgentName, setRemoteAgentName] = useState<string | undefined>(undefined);
  const [remoteTrackerName, setRemoteTrackerName] = useState<string | undefined>(undefined);
  const [remoteModel, setRemoteModel] = useState<string | undefined>(undefined);
  const [remoteTaskUsageMap, setRemoteTaskUsageMap] = useState<Map<string, TokenUsageSummary>>(
    () => new Map()
  );
  const [remoteAutoCommit, setRemoteAutoCommit] = useState<boolean | undefined>(undefined);
  // Remote sandbox config for display
  const [remoteSandboxConfig, setRemoteSandboxConfig] = useState<SandboxConfig | undefined>(undefined);
  const [remoteResolvedSandboxMode, setRemoteResolvedSandboxMode] = useState<Exclude<SandboxMode, 'auto'> | undefined>(undefined);
  // Remote git info for display
  const [remoteGitInfo, setRemoteGitInfo] = useState<{
    repoName?: string;
    branch?: string;
    isDirty?: boolean;
    commitHash?: string;
  } | undefined>(undefined);
  // Cache for remote iteration output by task ID (similar to historicalOutputCache for local)
  const [remoteIterationCache, setRemoteIterationCache] = useState<Map<string, {
    iteration: number;
    output: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    usage?: TokenUsageSummary;
    isRunning: boolean;
  }>>(new Map());
  const remoteOutputParserRef = useRef(
    new StreamingOutputParser({
      agentPlugin: remoteAgentName ?? 'claude',
    })
  );
  const remoteCurrentTaskIdRef = useRef<string | undefined>(undefined);
  const remoteContextWindowRef = useRef<number | undefined>(undefined);
  const [remoteContextWindow, setRemoteContextWindow] = useState<number | undefined>(undefined);

  // Get the selected tab's connection status from instanceTabs
  // This is used to trigger data fetch when connection completes
  const selectedTabStatus = instanceTabs?.[selectedTabIndex]?.status;
  const remoteSubagentTreeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remoteSubagentTreeRefreshInFlightRef = useRef(false);

  const updateRemoteUsage = useCallback(
    (usage: TokenUsageSummary | undefined, taskId?: string) => {
      const resolvedTaskId = taskId ?? remoteCurrentTaskIdRef.current;
      if (!usage || !resolvedTaskId) {
        return;
      }

      const normalized = normalizeUsage(usage, remoteContextWindowRef.current);
      setRemoteTaskUsageMap((prev) => {
        const existing = prev.get(resolvedTaskId);
        if (areUsageSummariesEqual(existing, normalized)) {
          return prev;
        }
        const next = new Map(prev);
        next.set(resolvedTaskId, normalized);
        return next;
      });
    },
    []
  );

  const refreshRemoteSubagentTree = useCallback(() => {
    if (!instanceManager) {
      return;
    }

    if (remoteSubagentTreeRefreshTimerRef.current !== undefined) {
      return;
    }

    remoteSubagentTreeRefreshTimerRef.current = setTimeout(() => {
      remoteSubagentTreeRefreshTimerRef.current = undefined;

      if (remoteSubagentTreeRefreshInFlightRef.current) {
        return;
      }

      remoteSubagentTreeRefreshInFlightRef.current = true;
      instanceManager.getRemoteState().then((state) => {
        if (state?.subagentTree) {
          setRemoteSubagentTree(state.subagentTree);
        }
      }).catch((err) => {
        console.error('Failed to refresh remote state:', err);
      }).finally(() => {
        remoteSubagentTreeRefreshInFlightRef.current = false;
      });
    }, 200);
  }, [instanceManager]);

  // Fetch remote data when switching to a remote tab AND when it becomes connected
  useEffect(() => {
    if (!isViewingRemote || !instanceManager) return;

    // Wait for the tab to be connected before fetching data
    // This fixes the issue where first tab select doesn't load data because
    // the client is still in 'connecting' state
    if (selectedTabStatus !== 'connected') {
      return;
    }

    const fetchRemoteData = async () => {
      // Get remote state
      const state = await instanceManager.getRemoteState();
      if (state) {
        // Convert engine status to RalphStatus
        // Engine statuses: 'idle' | 'running' | 'pausing' | 'paused' | 'stopping'
        const statusMap: Record<string, RalphStatus> = {
          idle: 'ready',
          running: 'running',
          pausing: 'pausing',
          paused: 'paused',
          stopping: 'stopped',
        };
        setRemoteStatus(statusMap[state.status] || 'ready');
        setRemoteCurrentIteration(state.currentIteration);
        setRemoteMaxIterations(state.maxIterations);
        setRemoteOutput(state.currentOutput || '');
        const hydratedUsage = new Map<string, TokenUsageSummary>();
        for (const iteration of state.iterations) {
          const usageFromIteration =
            iteration.usage ??
            summarizeTokenUsageFromOutput(iteration.agentResult?.stdout ?? '');
          if (usageFromIteration) {
            hydratedUsage.set(
              iteration.task.id,
              normalizeUsage(usageFromIteration)
            );
          }
        }
        if (state.currentTask) {
          setRemoteCurrentTaskId(state.currentTask.id);
          setRemoteCurrentTaskTitle(state.currentTask.title);
          remoteCurrentTaskIdRef.current = state.currentTask.id;

          const liveUsage = summarizeTokenUsageFromOutput(state.currentOutput ?? '');
          if (liveUsage) {
            hydratedUsage.set(
              state.currentTask.id,
              normalizeUsage(liveUsage, remoteContextWindowRef.current)
            );
          }
        }
        setRemoteTaskUsageMap(hydratedUsage);
        // Capture remote agent and rate limit state
        if (state.activeAgent) {
          setRemoteActiveAgent(state.activeAgent);
        }
        if (state.rateLimitState) {
          setRemoteRateLimitState(state.rateLimitState);
        }
        // Capture remote config info for display
        if (state.agentName) {
          setRemoteAgentName(state.agentName);
        }
        if (state.trackerName) {
          setRemoteTrackerName(state.trackerName);
        }
        setRemoteModel(state.currentModel);
        // Capture auto-commit setting for status display
        if (state.autoCommit !== undefined) {
          setRemoteAutoCommit(state.autoCommit);
        }
        // Capture sandbox config for display
        if (state.sandboxConfig) {
          setRemoteSandboxConfig({
            enabled: state.sandboxConfig.enabled,
            mode: state.sandboxConfig.mode,
            network: state.sandboxConfig.network,
          });
        }
        if (state.resolvedSandboxMode) {
          setRemoteResolvedSandboxMode(state.resolvedSandboxMode);
        }
        // Capture git info for display
        if (state.gitInfo) {
          setRemoteGitInfo(state.gitInfo);
        }
        // Set remote subagent tree if available
        if (state.subagentTree) {
          setRemoteSubagentTree(state.subagentTree);
        }
      }

      // Fetch tasks separately (getRemoteState returns empty tasks array)
      const tasks = await instanceManager.getRemoteTasks();
      if (tasks && tasks.length > 0) {
        // Convert tasks and mark the currently running task as 'active'
        const convertedTasks = convertTasksWithDependencyStatus(tasks);
        const currentTaskId = state?.currentTask?.id;
        if (currentTaskId) {
          const updatedTasks = convertedTasks.map(t =>
            t.id === currentTaskId ? { ...t, status: 'active' as const } : t
          );
          setRemoteTasks(updatedTasks);
        } else {
          setRemoteTasks(convertedTasks);
        }
      }

      // Subscribe to engine events
      await instanceManager.subscribeToSelectedRemote();
    };

    fetchRemoteData().catch((err) => {
      console.error('Failed to fetch remote data:', err);
    });

    // Subscribe to engine events from InstanceManager
    const unsubscribe = instanceManager.onEngineEvent((event) => {
      switch (event.type) {
        case 'engine:started':
          setRemoteStatus('running');
          break;
        case 'engine:stopped':
          setRemoteStatus(event.reason === 'completed' ? 'complete' : 'ready');
          break;
        case 'engine:paused':
          setRemoteStatus('paused');
          break;
        case 'engine:resumed':
          setRemoteStatus('running');
          break;
        case 'iteration:started':
          setRemoteCurrentIteration(event.iteration);
          setRemoteCurrentTaskId(event.task.id);
          setRemoteCurrentTaskTitle(event.task.title);
          remoteCurrentTaskIdRef.current = event.task.id;
          setRemoteOutput(''); // Clear output for new iteration
          remoteOutputParserRef.current.reset();
          setRemoteSubagentTree([]); // Clear subagent tree for new iteration
          // Mark this task as active in the task list
          setRemoteTasks((prevTasks) =>
            prevTasks.map((t) =>
              t.id === event.task.id
                ? { ...t, status: 'active' as const }
                : t.status === 'active'
                  ? { ...t, status: 'actionable' as const }
                  : t
            )
          );
          break;
        case 'agent:output':
          if (event.stream === 'stdout') {
            setRemoteOutput((prev) => prev + event.data);
            remoteOutputParserRef.current.push(event.data);
            updateRemoteUsage(remoteOutputParserRef.current.getUsage(), event.taskId);
          }
          // Refresh subagent tree at a throttled cadence to avoid fetching remote state per chunk.
          refreshRemoteSubagentTree();
          break;
        case 'agent:usage':
          updateRemoteUsage(event.usage, event.taskId);
          break;
        case 'agent:model':
          setRemoteModel(event.model);
          break;
        case 'iteration:completed':
          {
            const usage = event.result.usage;
            if (usage) {
              updateRemoteUsage(usage, event.result.task.id);
            }
          }
          break;
        case 'task:completed':
          // Refresh task list
          instanceManager.getRemoteTasks().then((tasks) => {
            if (tasks) {
              setRemoteTasks(convertTasksWithDependencyStatus(tasks));
            }
          }).catch((err) => {
            console.error('Failed to refresh remote tasks:', err);
          });
          break;
        case 'agent:switched':
          // Agent was switched (primary to fallback or recovery) on remote
          setRemoteActiveAgent({
            plugin: event.newAgent,
            reason: event.reason,
            since: event.timestamp,
          });
          if (event.rateLimitState) {
            setRemoteRateLimitState(event.rateLimitState);
          }
          break;
      }
    });

    return () => {
      if (remoteSubagentTreeRefreshTimerRef.current !== undefined) {
        clearTimeout(remoteSubagentTreeRefreshTimerRef.current);
        remoteSubagentTreeRefreshTimerRef.current = undefined;
      }
      remoteSubagentTreeRefreshInFlightRef.current = false;
      unsubscribe();
      instanceManager.unsubscribeFromSelectedRemote();
    };
  }, [
    isViewingRemote,
    selectedTabIndex,
    selectedTabStatus,
    instanceManager,
    updateRemoteUsage,
    refreshRemoteSubagentTree,
  ]);

  // Computed display values that switch between local and remote state
  // These are used in the UI to show the appropriate data based on which tab is selected
  const displayStatus = isViewingRemote ? remoteStatus : status;
  const displayCurrentIteration = isViewingRemote ? remoteCurrentIteration : currentIteration;
  const displayMaxIterations = isViewingRemote ? remoteMaxIterations : maxIterations;
  const displayCurrentTaskId = isViewingRemote ? remoteCurrentTaskId : currentTaskId;
  const displayCurrentTaskTitle = isViewingRemote ? remoteCurrentTaskTitle : currentTaskTitle;
  const displayAggregateUsage = useMemo(() => {
    const usageMap = isViewingRemote ? remoteTaskUsageMap : taskUsageMap;
    if (usageMap.size === 0) {
      return undefined;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    for (const usage of usageMap.values()) {
      inputTokens += usage.inputTokens ?? 0;
      outputTokens += usage.outputTokens ?? 0;
      totalTokens += usage.totalTokens > 0
        ? usage.totalTokens
        : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
    };
  }, [isViewingRemote, taskUsageMap, remoteTaskUsageMap]);

  // Compute display agent name - prefer active agent from engine state, fallback to config
  // For remote viewing, use remote active agent state, then remote config, then local config
  // For local viewing, append custom command in brackets if configured (e.g., "claude (claude-glm)")
  const baseAgentName = isViewingRemote
    ? (remoteActiveAgent?.plugin ?? remoteAgentName ?? agentName)
    : (activeAgentState?.plugin ?? agentName);
  const displayAgentName = !isViewingRemote && agentCommand && agentCommand !== baseAgentName
    ? `${baseAgentName} (${agentCommand})`
    : baseAgentName;
  const localModel = detectedModel ?? currentModel;

  // Compute display tracker and model for local vs remote
  const displayTrackerName = isViewingRemote ? (remoteTrackerName ?? trackerName) : trackerName;
  const displayModel = isViewingRemote ? (remoteModel ?? currentModel) : localModel;

  // Resolve model context windows for live local/remote usage indicators.
  const modelContextCacheRef = useRef<Map<string, number | null>>(new Map());
  const resolveModelContextWindow = useCallback(
    async (model?: string, agentHint?: string): Promise<number | undefined> => {
    if (!model) {
      return undefined;
    }

    const key = model.trim();
    if (!key) {
      return undefined;
    }

    const cacheKey = `${agentHint ?? ''}::${key}`;
    if (modelContextCacheRef.current.has(cacheKey)) {
      const cached = modelContextCacheRef.current.get(cacheKey);
      return cached === null ? undefined : cached;
    }

    const parsed = parseProviderModel(key);
    try {
      if (parsed) {
        const models = await getModelsForProvider(parsed.providerId);
        const match = models.find((m) => m.id === parsed.modelId);
        if (match?.contextLimit && Number.isFinite(match.contextLimit)) {
          modelContextCacheRef.current.set(cacheKey, match.contextLimit);
          return match.contextLimit;
        }
      } else {
        // Fallback for model strings without provider prefix (e.g., "gpt-4o", "sonnet").
        const providers = await getProviders();
        const allProviderModels = await Promise.all(
          providers.map((provider) => getModelsForProvider(provider.id))
        );
        const normalizedKey = key.toLowerCase();
        const match = allProviderModels
          .flat()
          .find(
            (m) =>
              m.id === key ||
              m.name.toLowerCase() === normalizedKey
          );
        if (match?.contextLimit && Number.isFinite(match.contextLimit)) {
          modelContextCacheRef.current.set(cacheKey, match.contextLimit);
          return match.contextLimit;
        }
      }
    } catch {
      // Ignore lookup failures and fall back to unavailable context window.
    }

    const fallback = getFallbackContextWindow(key, agentHint);
    if (fallback && Number.isFinite(fallback)) {
      modelContextCacheRef.current.set(cacheKey, fallback);
      return fallback;
    }

    modelContextCacheRef.current.set(cacheKey, null);
    return undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveModelContextWindow(
      localModel,
      activeAgentState?.plugin ?? resolvedAgentName
    ).then((contextWindow) => {
      if (!cancelled) {
        localContextWindowRef.current = contextWindow;
        setLocalContextWindow(contextWindow);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [localModel, activeAgentState?.plugin, resolvedAgentName, resolveModelContextWindow]);

  useEffect(() => {
    let cancelled = false;
    void resolveModelContextWindow(
      remoteModel,
      remoteActiveAgent?.plugin ?? remoteAgentName
    ).then((contextWindow) => {
      if (!cancelled) {
        remoteContextWindowRef.current = contextWindow;
        setRemoteContextWindow(contextWindow);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [remoteModel, remoteActiveAgent?.plugin, remoteAgentName, resolveModelContextWindow]);

  useEffect(() => {
    if (localContextWindow === undefined) {
      return;
    }

    startTransition(() => {
      setTaskUsageMap((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        const next = new Map<string, TokenUsageSummary>();
        for (const [taskId, usage] of prev.entries()) {
          next.set(taskId, normalizeUsage(usage, localContextWindow));
        }
        return next;
      });

      setIterations((prev) =>
        prev.map((iteration) =>
          iteration.usage
            ? {
                ...iteration,
                usage: normalizeUsage(iteration.usage, localContextWindow),
              }
            : iteration
        )
      );

      setHistoricalOutputCache((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        const next = new Map(prev);
        for (const [taskId, cacheEntry] of prev.entries()) {
          if (!cacheEntry.usage) {
            continue;
          }
          next.set(taskId, {
            ...cacheEntry,
            usage: normalizeUsage(cacheEntry.usage, localContextWindow),
          });
        }
        return next;
      });
    });
  }, [localContextWindow]);

  useEffect(() => {
    if (remoteContextWindow === undefined) {
      return;
    }

    setRemoteTaskUsageMap((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const next = new Map<string, TokenUsageSummary>();
      for (const [taskId, usage] of prev.entries()) {
        next.set(taskId, normalizeUsage(usage, remoteContextWindow));
      }
      return next;
    });

    setRemoteIterationCache((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const next = new Map(prev);
      for (const [taskId, cacheEntry] of prev.entries()) {
        if (!cacheEntry.usage) {
          continue;
        }
        next.set(taskId, {
          ...cacheEntry,
          usage: normalizeUsage(cacheEntry.usage, remoteContextWindow),
        });
      }
      return next;
    });
  }, [remoteContextWindow]);

  useEffect(() => {
    remoteOutputParserRef.current.setAgentPlugin(remoteActiveAgent?.plugin ?? remoteAgentName ?? 'claude');
  }, [remoteActiveAgent?.plugin, remoteAgentName]);

  // Count running subagents for status indicator when panel is hidden
  const runningSubagentCount = useMemo(() => {
    const countRunning = (nodes: SubagentTreeNode[]): number => {
      return nodes.reduce((sum, node) => {
        const self = node.state.status === 'running' ? 1 : 0;
        return sum + self + countRunning(node.children);
      }, 0);
    };
    const tree = isViewingRemote ? remoteSubagentTree : subagentTree;
    return countRunning(tree);
  }, [subagentTree, remoteSubagentTree, isViewingRemote]);

  // Filter and sort tasks for display
  // Sort order: active → actionable → blocked → done → closed
  // This is computed early so keyboard handlers can use displayedTasks.length
  // Use remoteTasks when viewing a remote instance
  const displayedTasks = useMemo(() => {
    // Status priority for sorting (lower = higher priority)
    const statusPriority: Record<TaskStatus, number> = {
      active: 0,
      actionable: 1,
      pending: 2, // Treat pending same as actionable (shouldn't happen often)
      blocked: 3,
      error: 4, // Failed tasks show after blocked
      completedLocally: 5, // Completed but not merged (e.g., no commits)
      done: 6,
      closed: 7,
    };

    // Use remote tasks when viewing remote, local tasks otherwise
    let sourceTasks = isViewingRemote ? remoteTasks : tasks;

    // Parallel mode: overlay worker statuses onto tasks in a single render cycle.
    // LeftPanel already renders ▶ for any task with status 'active', so marking multiple
    // tasks as active simultaneously will display multiple ▶ icons — the core UX goal.
    // This is derived state (computed from parallelWorkers), not stored state, which
    // ensures updates appear on the same render that receives new parallelWorkers props.
    if (isParallelMode && parallelWorkers?.length) {
      sourceTasks = sourceTasks.map((task) => {
        const worker = parallelWorkers.find((w) => w.task?.id === task.id);
        if (!worker) return task;

        if (worker.status === 'running') return { ...task, status: 'active' as TaskStatus };
        if (worker.status === 'completed') {
          // Check if task completed locally but merge failed (shows ⚠ instead of ✓)
          if (parallelCompletedLocallyTaskIds?.has(task.id)) {
            return { ...task, status: 'completedLocally' as TaskStatus };
          }
          return { ...task, status: 'done' as TaskStatus };
        }
        if (worker.status === 'failed') return { ...task, status: 'error' as TaskStatus };
        return task;
      });
    }

    // Also mark tasks as completedLocally if they're in the set but worker has finished
    // (this catches tasks that were completed but merge failed after worker status updated)
    if (isParallelMode && parallelCompletedLocallyTaskIds?.size) {
      sourceTasks = sourceTasks.map((task) => {
        // Only override if task isn't already showing a terminal status
        if (parallelCompletedLocallyTaskIds.has(task.id) &&
            task.status !== 'done' && task.status !== 'active' && task.status !== 'completedLocally') {
          return { ...task, status: 'completedLocally' as TaskStatus };
        }
        return task;
      });
    }

    // Mark tasks as done if they've been successfully merged
    // This ensures tasks show ✓ even after worker states are cleared or parallel execution ends
    if (isParallelMode && parallelMergedTaskIds?.size) {
      sourceTasks = sourceTasks.map((task) => {
        if (parallelMergedTaskIds.has(task.id) && task.status !== 'done') {
          return { ...task, status: 'done' as TaskStatus };
        }
        return task;
      });
    }

    const usageMap = isViewingRemote ? remoteTaskUsageMap : taskUsageMap;
    sourceTasks = sourceTasks.map((task) => {
      const nextUsage = usageMap.get(task.id);
      if (areUsageSummariesEqual(task.usage, nextUsage)) {
        return task;
      }
      return {
        ...task,
        usage: nextUsage,
      };
    });

    const filtered = showClosedTasks ? sourceTasks : sourceTasks.filter((t) => t.status !== 'closed');
    return [...filtered].sort((a, b) => {
      const priorityA = statusPriority[a.status] ?? 10;
      const priorityB = statusPriority[b.status] ?? 10;
      return priorityA - priorityB;
    });
  }, [
    tasks,
    remoteTasks,
    isViewingRemote,
    showClosedTasks,
    isParallelMode,
    parallelWorkers,
    parallelCompletedLocallyTaskIds,
    parallelMergedTaskIds,
    taskUsageMap,
    remoteTaskUsageMap,
  ]);

  // Derive parallel execution status from worker states.
  // This allows restart gating to use actual worker completion state rather than stale local status.
  // Returns 'complete' if all workers finished successfully, 'running' if any are active,
  // 'idle' if no workers exist, null if not in parallel mode.
  const parallelDerivedStatus = useMemo((): RalphStatus | null => {
    if (!isParallelMode) return null;
    if (!parallelWorkers || parallelWorkers.length === 0) return 'idle';

    const hasRunning = parallelWorkers.some((w) => w.status === 'running' || w.status === 'idle');
    const allCompleted = parallelWorkers.every((w) => w.status === 'completed');
    const hasFailed = parallelWorkers.some((w) => w.status === 'failed');

    if (hasRunning) return 'running';
    if (allCompleted) return 'complete';
    if (hasFailed) return 'error';
    return 'idle';
  }, [isParallelMode, parallelWorkers]);

  // Clamp selectedIndex when displayedTasks shrinks (e.g., when hiding closed tasks)
  useEffect(() => {
    if (displayedTasks.length > 0 && selectedIndex >= displayedTasks.length) {
      setSelectedIndex(displayedTasks.length - 1);
    }
  }, [displayedTasks.length, selectedIndex]);

  // Auto-show subagent panel when first subagent spawns (unless user manually hid it)
  // This makes subagent activity discoverable without requiring users to know about 'T' key
  useEffect(() => {
    if (subagentTree.length > 0 && !subagentPanelVisible && !userManuallyHidPanel) {
      setSubagentPanelVisible(true);
      // Also persist the change to session state
      onSubagentPanelVisibilityChange?.(true);
    }
  }, [subagentTree.length, subagentPanelVisible, userManuallyHidPanel, onSubagentPanelVisibilityChange]);

  // Compute effective task ID for prompt preview - memoized to avoid unstable references
  // This is computed early so the useEffect can depend on a stable string instead of arrays
  const promptPreviewTaskId = useMemo(() => {
    const selectedIter = viewMode === 'iterations' && iterations.length > 0
      ? iterations[iterationSelectedIndex]
      : undefined;
    return viewMode === 'iterations'
      ? selectedIter?.task?.id
      : displayedTasks[selectedIndex]?.id;
  }, [viewMode, iterations, iterationSelectedIndex, displayedTasks, selectedIndex]);

  // Regenerate prompt preview when selected task changes (if in prompt view mode)
  // This keeps the prompt preview in sync with the currently selected task/iteration
  // Depends on promptPreviewTaskId (stable string) instead of arrays to avoid re-render loops
  useEffect(() => {
    // If not in prompt view mode, do nothing
    if (detailsViewMode !== 'prompt') {
      return;
    }

    // If no task is selected, clear the preview
    if (!promptPreviewTaskId) {
      setPromptPreview('No task selected');
      setTemplateSource(undefined);
      return;
    }

    // Track if this effect has been superseded by a newer one
    let cancelled = false;

    setPromptPreview('Generating prompt preview...');
    setTemplateSource(undefined);

    void (async () => {
      // Use remote API when viewing remote, local engine otherwise
      if (isViewingRemote && instanceManager) {
        const result = await instanceManager.getRemotePromptPreview(promptPreviewTaskId);
        if (cancelled) return;

        if (result === null) {
          setPromptPreview('Unable to fetch prompt preview from remote.\n\nConnection may not be ready.');
          setTemplateSource(undefined);
        } else if (result.success) {
          setPromptPreview(result.prompt);
          setTemplateSource(result.source);
        } else {
          setPromptPreview(`Error: ${result.error}`);
          setTemplateSource(undefined);
        }
      } else if (engine) {
        const result = await engine.generatePromptPreview(promptPreviewTaskId);
        // Don't update state if this effect was cancelled (user changed task again)
        if (cancelled) return;

        if (result.success) {
          setPromptPreview(result.prompt);
          setTemplateSource(result.source);
        } else {
          setPromptPreview(`Error: ${result.error}`);
          setTemplateSource(undefined);
        }
      }
    })();

    // Cleanup: mark this effect as cancelled if it re-runs before completing
    return () => {
      cancelled = true;
    };
  }, [detailsViewMode, promptPreviewTaskId, engine, isViewingRemote, instanceManager]);

  // Fetch remote iteration output when selecting a different task (for remote viewing)
  // This fills the remoteIterationCache so the useMemo can use it synchronously
  useEffect(() => {
    // Skip if not viewing remote or no instance manager
    if (!isViewingRemote || !instanceManager) return;

    // Get the effective task ID that we're viewing
    const selectedIteration = viewMode === 'iterations' && iterations.length > 0
      ? iterations[iterationSelectedIndex]
      : undefined;
    const effectiveTaskId = viewMode === 'iterations'
      ? selectedIteration?.task?.id
      : displayedTasks[selectedIndex]?.id;

    // Skip if no task selected or if this is the currently running task
    // (currently running task uses live remoteOutput, not cached)
    if (!effectiveTaskId || effectiveTaskId === remoteCurrentTaskId) return;

    // Check if we already have this task in cache
    if (remoteIterationCache.has(effectiveTaskId)) return;

    // Fetch iteration output from remote
    let cancelled = false;
    void (async () => {
      const result = await instanceManager.getRemoteIterationOutput(effectiveTaskId);
      if (cancelled) return;

      if (result && result.success && result.output !== undefined) {
        const contextWindow = await resolveModelContextWindow(
          remoteModel,
          remoteActiveAgent?.plugin ?? remoteAgentName
        );
        if (cancelled) return;
        const fallbackUsage = summarizeTokenUsageFromOutput(result.output ?? '');
        const usage = result.usage
          ? normalizeUsage(result.usage, contextWindow)
          : fallbackUsage
            ? normalizeUsage(fallbackUsage, contextWindow)
            : undefined;
        setRemoteIterationCache((prev) => {
          const next = new Map(prev);
          next.set(effectiveTaskId, {
            iteration: result.iteration ?? 0,
            output: result.output ?? '',
            startedAt: result.startedAt,
            endedAt: result.endedAt,
            durationMs: result.durationMs,
            usage,
            isRunning: result.isRunning ?? false,
          });
          return next;
        });
        if (usage) {
          setRemoteTaskUsageMap((prev) => {
            const next = new Map(prev);
            next.set(effectiveTaskId, usage);
            return next;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isViewingRemote,
    instanceManager,
    viewMode,
    iterations,
    iterationSelectedIndex,
    displayedTasks,
    selectedIndex,
    remoteCurrentTaskId,
    remoteIterationCache,
    resolveModelContextWindow,
    remoteModel,
    remoteActiveAgent?.plugin,
    remoteAgentName,
  ]);

  // Update output parser when agent changes (parser was created before config was loaded)
  useEffect(() => {
    if (agentName) {
      outputParserRef.current.setAgentPlugin(agentName);
    }
  }, [agentName]);

  // Subscribe to engine events (engine is absent in parallel mode)
  useEffect(() => {
    if (!engine) return;
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
          currentTaskIdRef.current = undefined;
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
          setFocusedSubagentId(undefined);
          setSelectedSubagentId('main');
          // Reset user manual hide state for new iteration - allows auto-show for new subagents
          setUserManuallyHidPanel(false);
          // Set current task info for display
          setCurrentTaskId(event.task.id);
          setCurrentTaskTitle(event.task.title);
          currentTaskIdRef.current = event.task.id;
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
          currentTaskIdRef.current = undefined;
          setStatus('selecting');
          {
            const usage = event.result.usage;
            if (usage) {
              setTaskUsageMap((prev) => {
                const next = new Map(prev);
                next.set(
                  event.result.task.id,
                  normalizeUsage(usage, localContextWindowRef.current)
                );
                return next;
              });
            }
          }
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
            const usage = outputParserRef.current.getUsage();
            const taskId = event.taskId ?? currentTaskIdRef.current;
            if (usage && taskId) {
              const normalized = normalizeUsage(usage, localContextWindowRef.current);
              setTaskUsageMap((prev) => {
                const existing = prev.get(taskId);
                if (areUsageSummariesEqual(existing, normalized)) {
                  return prev;
                }
                const next = new Map(prev);
                next.set(taskId, normalized);
                return next;
              });
            }
          }
          // Always refresh subagent tree from engine (subagent events are processed in engine).
          // This decouples data collection from display preferences - the subagentDetailLevel
          // only affects how much detail to show inline, not whether to track subagents.
          setSubagentTree(engine!.getSubagentTree());
          break;

        case 'agent:usage':
          {
            const taskId = event.taskId ?? currentTaskIdRef.current;
            if (taskId) {
              const normalized = normalizeUsage(event.usage, localContextWindowRef.current);
              setTaskUsageMap((prev) => {
                const existing = prev.get(taskId);
                if (areUsageSummariesEqual(existing, normalized)) {
                  return prev;
                }
                const next = new Map(prev);
                next.set(taskId, normalized);
                return next;
              });
            }
          }
          break;
        case 'agent:model':
          setDetectedModel(event.model);
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
  }, [engine]);

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

  // Get initial state from engine (engine is absent in parallel mode)
  useEffect(() => {
    if (!engine) return;
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
    const hydratedUsage = new Map<string, TokenUsageSummary>();
    for (const iteration of state.iterations) {
      const usageFromIteration =
        iteration.usage ??
        summarizeTokenUsageFromOutput(iteration.agentResult?.stdout ?? '');
      if (usageFromIteration) {
        hydratedUsage.set(
          iteration.task.id,
          normalizeUsage(usageFromIteration, localContextWindowRef.current)
        );
      }
    }
    if (state.currentTask?.id && state.currentOutput) {
      const liveUsage = summarizeTokenUsageFromOutput(state.currentOutput);
      if (liveUsage) {
        hydratedUsage.set(
          state.currentTask.id,
          normalizeUsage(liveUsage, localContextWindowRef.current)
        );
      }
    }
    setTaskUsageMap(hydratedUsage);
    // Initialize active agent and rate limit state from engine
    if (state.activeAgent) {
      setActiveAgentState(state.activeAgent);
    }
    if (state.rateLimitState) {
      setRateLimitState(state.rateLimitState);
    }
    if (state.currentModel) {
      setDetectedModel(state.currentModel);
    }
  }, [engine, agentName]);

  useEffect(() => {
    currentTaskIdRef.current = currentTaskId;
  }, [currentTaskId]);

  useEffect(() => {
    remoteCurrentTaskIdRef.current = remoteCurrentTaskId;
  }, [remoteCurrentTaskId]);

  // Sync task selection → agent tree selection
  // When currentTaskId changes, reset tree selection to the task root
  useEffect(() => {
    if (currentTaskId) {
      setSelectedSubagentId(currentTaskId);
    } else {
      setSelectedSubagentId('main');
    }
  }, [currentTaskId]);

  // Auto-show conflict panel when Phase 2 conflict resolution starts
  // Only show when parallelShowConflicts is true (set by conflict:ai-resolving event),
  // not when conflicts are merely detected during Phase 1 merge attempts
  useEffect(() => {
    if (isParallelMode && parallelShowConflicts && parallelConflicts.length > 0) {
      setShowConflictPanel(true);
      setConflictSelectedIndex(0);
    } else if (!parallelShowConflicts) {
      setShowConflictPanel(false);
    }
  }, [isParallelMode, parallelShowConflicts, parallelConflicts]);

  // Calculate the number of items in iteration history (iterations + pending)
  const iterationHistoryLength = Math.max(iterations.length, totalIterations);

  // Navigate through subagent tree with j/k keys
  // Builds a flattened list of all nodes (task root + subagents) and moves selection
  const navigateSubagentTree = useCallback((direction: 1 | -1) => {
    // Use the appropriate tree based on whether viewing remote
    const tree = isViewingRemote ? remoteSubagentTree : subagentTree;
    // Root node ID: displayCurrentTaskId if available, otherwise 'main' for backwards compat
    const rootNodeId = displayCurrentTaskId || 'main';
    // Build flat list: [rootNodeId, ...all subagent IDs in tree order]
    const flatList: string[] = [rootNodeId];

    function traverse(nodes: SubagentTreeNode[]) {
      for (const node of nodes) {
        flatList.push(node.state.id);
        traverse(node.children);
      }
    }
    traverse(tree);

    // Find current index and move
    const currentIdx = flatList.indexOf(selectedSubagentId);
    const newIdx = Math.max(0, Math.min(flatList.length - 1, currentIdx + direction));
    setSelectedSubagentId(flatList[newIdx]!);
  }, [subagentTree, remoteSubagentTree, isViewingRemote, selectedSubagentId, displayCurrentTaskId]);

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

      // When kill dialog is showing, handle y/n/Esc
      if (showKillDialog) {
        switch (key.name) {
          case 'y':
            setShowKillDialog(false);
            setStatus('stopped');
            onParallelKill?.();
            break;
          case 'n':
          case 'escape':
            setShowKillDialog(false);
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

      // When remote config view is showing, let it handle its own keyboard events
      // Closing is handled by RemoteConfigView internally via onClose callback
      if (showRemoteConfig) {
        return;
      }

      // When epic loader is showing, only Escape closes it
      // Epic loader handles its own keyboard events via useKeyboard
      if (showEpicLoader) {
        return;
      }

      // When remote management overlay is showing, let it handle its own keyboard events
      if (showRemoteManagement) {
        return;
      }

      // When conflict resolution panel is showing, handle conflict-specific keys
      if (showConflictPanel) {
        // Check if we're in failure state (has failed resolutions and not currently resolving)
        const hasFailures = !parallelAiResolving &&
          parallelConflictResolutions.some((r) => !r.success);

        switch (key.name) {
          case 'escape':
            // Close conflict panel (AI resolution continues in background)
            setShowConflictPanel(false);
            break;
          case 'j':
          case 'down':
            setConflictSelectedIndex((prev) => Math.min(prev + 1, parallelConflicts.length - 1));
            break;
          case 'k':
          case 'up':
            setConflictSelectedIndex((prev) => Math.max(prev - 1, 0));
            break;
          case 'r':
            // Retry AI resolution (only in failure state)
            if (hasFailures && onConflictRetry) {
              onConflictRetry();
            }
            break;
          case 's':
            // Skip this task's merge (only in failure state)
            if (hasFailures && onConflictSkip) {
              onConflictSkip();
              setShowConflictPanel(false);
            }
            break;
        }
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
          } else if (viewMode === 'parallel-detail') {
            setViewMode('parallel-overview');
          } else if (viewMode === 'parallel-overview' || viewMode === 'merge-progress') {
            setViewMode('tasks');
          } else {
            // Show quit confirmation dialog
            setShowQuitDialog(true);
          }
          break;

        case 'tab':
          // Toggle focus between output and subagent tree panels
          // Only works when subagent panel is visible and in output view mode
          if (subagentPanelVisible && detailsViewMode === 'output') {
            setFocusedPane((prev) => prev === 'output' ? 'subagentTree' : 'output');
          }
          break;

        case 'up':
        case 'k':
          // Focus-aware navigation: when subagent panel is visible and focused, navigate tree
          if (detailsViewMode === 'output' && subagentPanelVisible && focusedPane === 'subagentTree') {
            navigateSubagentTree(-1);
            break;
          }
          // Default: navigate task/iteration/parallel lists
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.max(0, prev - 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.max(0, prev - 1));
          } else if (viewMode === 'parallel-overview') {
            setSelectedWorkerIndex((prev) => Math.max(0, prev - 1));
          }
          break;

        case 'down':
        case 'j':
          // Focus-aware navigation: when subagent panel is visible and focused, navigate tree
          if (detailsViewMode === 'output' && subagentPanelVisible && focusedPane === 'subagentTree') {
            navigateSubagentTree(1);
            break;
          }
          // Default: navigate task/iteration/parallel lists
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.min(displayedTasks.length - 1, prev + 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.min(iterationHistoryLength - 1, prev + 1));
          } else if (viewMode === 'parallel-overview') {
            setSelectedWorkerIndex((prev) => Math.min(parallelWorkers.length - 1, prev + 1));
          }
          break;

        case 'p':
          // Toggle pause/resume
          // When running/executing/selecting, pause will transition to pausing, then to paused
          // When pausing, pressing p again will cancel the pause request
          // When paused, resume will transition back to selecting
          if (isViewingRemote && instanceManager) {
            // Route to remote instance
            if (displayStatus === 'running' || displayStatus === 'executing' || displayStatus === 'selecting') {
              // Set status to 'pausing' immediately for feedback
              setRemoteStatus('pausing');
              instanceManager.sendRemoteCommand('pause');
            } else if (displayStatus === 'pausing') {
              // Cancel pause request - set back to running
              setRemoteStatus('running');
              instanceManager.sendRemoteCommand('resume');
            } else if (displayStatus === 'paused') {
              // Resume from paused - set to selecting
              setRemoteStatus('selecting');
              instanceManager.sendRemoteCommand('resume');
            }
          } else if (isParallelMode && onParallelPause && onParallelResume) {
            // Parallel mode: pause/resume all workers
            if (status === 'running' || status === 'executing' || status === 'selecting') {
              onParallelPause();
              setStatus('pausing');
            } else if (status === 'pausing') {
              onParallelResume();
              setStatus('running');
            } else if (status === 'paused') {
              onParallelResume();
              setStatus('running');
            }
          } else if (engine) {
            // Local engine control (engine absent in parallel mode)
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

        case 'w':
          // Toggle parallel workers view (only when parallel mode is active)
          if (isParallelMode) {
            setViewMode((prev) =>
              prev === 'parallel-overview' ? 'tasks' : 'parallel-overview'
            );
          }
          break;

        case 'm':
          // Toggle merge progress view (only when parallel mode is active)
          if (isParallelMode) {
            setViewMode((prev) =>
              prev === 'merge-progress' ? 'tasks' : 'merge-progress'
            );
          }
          break;

        case 'enter':
        case 'return': {
          // In parallel overview, Enter drills into worker detail
          if (viewMode === 'parallel-overview' && parallelWorkers.length > 0) {
            setViewMode('parallel-detail');
            break;
          }
          // Parallel mode: Enter restarts execution when in a terminal state
          // Use derived status from worker states to avoid stale local status
          const parallelStatusForRestart = parallelDerivedStatus ?? status;
          if (isParallelMode && onParallelStart &&
              (parallelStatusForRestart === 'stopped' || parallelStatusForRestart === 'complete' ||
               parallelStatusForRestart === 'idle' || parallelStatusForRestart === 'error')) {
            setStatus('running');
            onParallelStart();
            break;
          }
          break;
        }

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
          if (isViewingRemote && instanceManager) {
            // Route to remote instance - send continue command
            if (displayStatus === 'stopped' || displayStatus === 'idle' || displayStatus === 'ready' || displayStatus === 'complete') {
              instanceManager.sendRemoteCommand('continue');
            }
          } else if (isParallelMode && onParallelStart) {
            // Parallel mode: restart execution after stop/complete/idle
            // Use derived status from worker states to avoid stale local status
            const parallelStatusForStart = parallelDerivedStatus ?? status;
            if (parallelStatusForStart === 'stopped' || parallelStatusForStart === 'complete' ||
                parallelStatusForStart === 'idle' || parallelStatusForStart === 'error') {
              setStatus('running');
              onParallelStart();
            }
          } else if (engine) {
            // Local engine control (engine absent in parallel mode)
            if (status === 'ready' && onStart) {
              // First start - use onStart callback
              setStatus('running');
              onStart();
            } else if (status === 'stopped' || status === 'idle' || status === 'complete') {
              // Continue after stop (or after completion with new tasks) - use engine.continueExecution()
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
          }
          break;

        case 'r':
          // Refresh task list from tracker
          if (isViewingRemote && instanceManager) {
            instanceManager.sendRemoteCommand('refreshTasks');
          } else if (engine) {
            engine.refreshTasks();
          }
          break;

        case '+':
        case '=':
        case '-':
        case '_':
          // Add/remove 10 iterations: +/= add, -/_ remove
          const isPlus = key.name === '+' || key.name === '=';
          const isMinus = key.name === '-' || key.name === '_';
          const effectiveStatus = isViewingRemote ? displayStatus : status;
          if ((isPlus || isMinus) &&
              (effectiveStatus === 'ready' || effectiveStatus === 'running' || effectiveStatus === 'executing' || effectiveStatus === 'paused' || effectiveStatus === 'stopped' || effectiveStatus === 'idle' || effectiveStatus === 'complete')) {
            if (isViewingRemote && instanceManager) {
              // Route to remote instance
              if (isPlus) {
                instanceManager.addRemoteIterations(10);
              } else {
                instanceManager.removeRemoteIterations(10);
              }
            } else if (engine) {
              // Local engine control (engine absent in parallel mode)
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
          }
          break;

        case ',':
          // Open settings view (comma key, like many text editors)
          if (storedConfig && onSaveSettings) {
            setShowSettings(true);
          }
          break;

        case 'c':
          // Shift+C: Show config viewer (read-only) for both local and remote
          if (key.sequence === 'C') {
            setShowRemoteConfig(true);
            setRemoteConfigLoading(true);
            setRemoteConfigError(undefined);
            setRemoteConfigData(null);

            if (isViewingRemote && instanceManager) {
              // For remote tabs, fetch config from remote
              instanceManager.checkRemoteConfig()
                .then((data) => {
                  if (data) {
                    setRemoteConfigData(data);
                  } else {
                    setRemoteConfigError('Failed to fetch remote config');
                  }
                  setRemoteConfigLoading(false);
                })
                .catch((err) => {
                  setRemoteConfigError(err instanceof Error ? err.message : 'Failed to fetch remote config');
                  setRemoteConfigLoading(false);
                });
            } else {
              // For local tab, read config files from disk
              import('fs/promises').then(async (fs) => {
                const { homedir } = await import('os');
                const { join } = await import('path');
                try {
                  const globalPath = join(homedir(), '.config', 'ralph-tui', 'config.toml');
                  const projectPath = join(cwd, '.ralph-tui', 'config.toml');

                  let globalExists = false;
                  let globalContent: string | undefined;
                  let projectExists = false;
                  let projectContent: string | undefined;

                  try {
                    globalContent = await fs.readFile(globalPath, 'utf-8');
                    globalExists = true;
                  } catch {
                    // File doesn't exist
                  }

                  try {
                    projectContent = await fs.readFile(projectPath, 'utf-8');
                    projectExists = true;
                  } catch {
                    // File doesn't exist
                  }

                  setRemoteConfigData({
                    globalExists,
                    projectExists,
                    globalPath: globalExists ? globalPath : undefined,
                    projectPath: projectExists ? projectPath : undefined,
                    globalContent,
                    projectContent,
                    remoteCwd: cwd,
                  });
                  setRemoteConfigLoading(false);
                } catch (err) {
                  setRemoteConfigError(err instanceof Error ? err.message : 'Failed to load config');
                  setRemoteConfigLoading(false);
                }
              });
            }
          }
          break;

        case 'l':
          // Open epic loader to switch epics (only when not executing)
          // Disabled for remote instances - epic loading is local-only
          if (isViewingRemote) {
            setInfoFeedback('Epic/PRD loading not available for remote instances');
            break;
          }
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
          // Cycle through details/output/prompt views in the right panel
          // Check if Shift+O (uppercase) - direct jump to prompt preview
          if (key.sequence === 'O') {
            // Shift+O: Jump directly to prompt view
            // The effect handles generating the preview when detailsViewMode changes
            setDetailsViewMode('prompt');
          } else {
            // lowercase 'o': Cycle through views
            // The effect handles generating the preview when detailsViewMode changes to 'prompt'
            setDetailsViewMode((prev) => {
              const modes: DetailsViewMode[] = ['details', 'output', 'prompt'];
              const currentIdx = modes.indexOf(prev);
              const nextIdx = (currentIdx + 1) % modes.length;
              return modes[nextIdx]!;
            });
          }
          break;

        case 't':
          // Check if Shift+T (uppercase) - toggle subagent tree panel
          // key.sequence contains the actual character ('T' for Shift+T, 't' for plain t)
          if (key.sequence === 'T') {
            // Toggle subagent tree panel visibility (Shift+T)
            // The panel shows on the right side; subagent tracking continues even when hidden
            setSubagentPanelVisible((prev) => {
              const newVisible = !prev;
              // If user is hiding the panel, mark it as manually hidden
              // This prevents auto-show from overriding user intent
              if (!newVisible) {
                setUserManuallyHidPanel(true);
              }
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

        // Tab navigation: number keys 1-9 to switch tabs
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          if (instanceTabs && onSelectTab) {
            const tabIndex = parseInt(key.name, 10) - 1;
            if (tabIndex < instanceTabs.length) {
              onSelectTab(tabIndex);
            }
          }
          break;

        // Tab navigation: [ and ] to cycle tabs
        case '[':
          if (instanceTabs && onSelectTab && instanceTabs.length > 1) {
            const prevIndex = (selectedTabIndex - 1 + instanceTabs.length) % instanceTabs.length;
            onSelectTab(prevIndex);
          }
          break;

        case ']':
          if (instanceTabs && onSelectTab && instanceTabs.length > 1) {
            const nextIndex = (selectedTabIndex + 1) % instanceTabs.length;
            onSelectTab(nextIndex);
          }
          break;

        // Remote management: 'a' to add new remote
        case 'a':
          // Open add remote overlay
          setRemoteManagementMode('add');
          setEditingRemote(undefined);
          setShowRemoteManagement(true);
          break;

        // Remote management: 'e' to edit current remote (only when viewing a remote tab)
        case 'e':
          if (isViewingRemote && instanceTabs && selectedTabIndex > 0) {
            const tab = instanceTabs[selectedTabIndex];
            if (tab?.alias) {
              // Load remote data for editing
              getRemote(tab.alias).then((config) => {
                if (config) {
                  setEditingRemote({
                    alias: tab.alias!,
                    host: config.host,
                    port: config.port,
                    token: config.token,
                  });
                  setRemoteManagementMode('edit');
                  setShowRemoteManagement(true);
                }
              }).catch((err) => {
                console.error('Failed to load remote config for editing:', err);
                setInfoFeedback('Failed to load remote configuration');
              });
            }
          }
          break;

        // 'x' — Kill all workers (parallel mode) or delete remote (remote view)
        case 'x':
          // Kill all running agents (parallel mode only, with confirmation)
          if (isParallelMode && onParallelKill &&
              (status === 'running' || status === 'executing' || status === 'pausing' || status === 'paused')) {
            setShowKillDialog(true);
            break;
          }
          // Remote management: delete current remote (only when viewing a remote tab)
          if (isViewingRemote && instanceTabs && selectedTabIndex > 0) {
            const tab = instanceTabs[selectedTabIndex];
            if (tab?.alias) {
              // Load remote data for delete confirmation
              getRemote(tab.alias).then((config) => {
                if (config) {
                  setEditingRemote({
                    alias: tab.alias!,
                    host: config.host,
                    port: config.port,
                    token: config.token,
                  });
                  setRemoteManagementMode('delete');
                  setShowRemoteManagement(true);
                }
              }).catch((err) => {
                console.error('Failed to load remote config for deletion:', err);
                setInfoFeedback('Failed to load remote configuration');
              });
            }
          }
          break;
      }
    },
    [displayedTasks, selectedIndex, status, engine, onQuit, viewMode, iterations, iterationSelectedIndex, iterationHistoryLength, onIterationDrillDown, showInterruptDialog, onInterruptConfirm, onInterruptCancel, showHelp, showSettings, showQuitDialog, showKillDialog, showEpicLoader, showRemoteManagement, onStart, storedConfig, onSaveSettings, onLoadEpics, subagentDetailLevel, onSubagentPanelVisibilityChange, currentIteration, maxIterations, renderer, detailsViewMode, subagentPanelVisible, focusedPane, navigateSubagentTree, instanceTabs, selectedTabIndex, onSelectTab, isViewingRemote, displayStatus, instanceManager, isParallelMode, parallelWorkers, parallelConflicts, showConflictPanel, onParallelKill, onParallelPause, onParallelResume, onParallelStart, parallelDerivedStatus]
  );

  useKeyboard(handleKeyboard);

  // Calculate layout - account for dashboard and tab bar height when visible
  const dashboardHeight = showDashboard ? layout.progressDashboard.height : 0;
  const tabBarHeight = instanceTabs && instanceTabs.length > 1 ? layout.tabBar.height : 0;
  const contentHeight = Math.max(
    1,
    height - layout.header.height - layout.footer.height - dashboardHeight - tabBarHeight
  );
  const isCompact = width < 80;

  // Calculate completed tasks (counting both 'done' and 'closed' as completed)
  // 'done' = completed in current session, 'closed' = historically completed
  const completedTasks = tasks.filter(
    (t) => t.status === 'done' || t.status === 'closed'
  ).length;
  const totalTasks = tasks.length;

  // Get selected task from filtered list (used for display in tasks view)
  const selectedTask = displayedTasks[selectedIndex] ?? null;

  // Get selected iteration when in iterations view
  const selectedIteration = viewMode === 'iterations' && iterations.length > 0
    ? iterations[iterationSelectedIndex]
    : undefined;

  // Unified task ID for data loading - works across both views
  // In iterations view, use the task ID from the selected iteration
  // In tasks view, use the task ID from the task list
  const effectiveTaskId = viewMode === 'iterations'
    ? selectedIteration?.task?.id
    : selectedTask?.id;

  // Compute the iteration output and timing to show
  // Uses effectiveTaskId to ensure correct data is shown in both tasks and iterations views
  // - If current task is executing: show live currentOutput with isRunning + segments
  // - If completed iteration exists: show that iteration's output with timing
  // - Otherwise: undefined (will show "waiting" or appropriate message)
  const selectedTaskIteration = useMemo(() => {
    // When viewing remote, check if we're viewing the currently running task
    // or a different task (which should use the cache)
    if (isViewingRemote) {
      // If this is the currently running task, show live output
      if (effectiveTaskId === remoteCurrentTaskId && remoteStatus === 'running') {
        const timing: IterationTimingInfo = {
          isRunning: true,
        };
        return {
          iteration: remoteCurrentIteration,
          output: remoteOutput || undefined,
          segments: undefined,
          usage: effectiveTaskId ? remoteTaskUsageMap.get(effectiveTaskId) : undefined,
          timing,
        };
      }

      // Check if we have cached iteration data for this task
      if (effectiveTaskId && remoteIterationCache.has(effectiveTaskId)) {
        const cached = remoteIterationCache.get(effectiveTaskId)!;
        const timing: IterationTimingInfo = {
          startedAt: cached.startedAt,
          endedAt: cached.endedAt,
          durationMs: cached.durationMs,
          isRunning: cached.isRunning,
        };
        return {
          iteration: cached.iteration,
          output: cached.output,
          segments: undefined,
          usage: cached.usage,
          timing,
        };
      }

      // No data available yet (being fetched or task never run)
      const timing: IterationTimingInfo = {
        isRunning: false,
      };
      return {
        iteration: 0,
        output: undefined,
        segments: undefined,
        usage: effectiveTaskId ? remoteTaskUsageMap.get(effectiveTaskId) : undefined,
        timing,
      };
    }

    // Parallel mode: route output from the worker assigned to the selected task.
    // Each worker's stdout is buffered in parallelWorkerOutputs keyed by workerId.
    // We use parallelTaskIdToWorkerId to look up which worker handles this task.
    if (isParallelMode && parallelTaskIdToWorkerId && parallelWorkerOutputs) {
      const workerId = parallelTaskIdToWorkerId.get(effectiveTaskId ?? '');
      if (workerId) {
        const outputLines = parallelWorkerOutputs.get(workerId) ?? [];
        const output = outputLines.join('\n');
        // Derive isRunning from the worker's actual status instead of hardcoding true.
        // This ensures completed/failed workers show as no longer running.
        const worker = parallelWorkers.find((w) => w.id === workerId);
        const isRunning = worker?.status === 'running';
        return {
          iteration: 1,
          output,
          segments: [{ text: output }],
          usage: effectiveTaskId ? taskUsageMap.get(effectiveTaskId) : undefined,
          timing: { isRunning },
        };
      }
    }

    // If no effective task ID, check if there's currently executing task and show that
    if (!effectiveTaskId) {
      // If there's a current task executing, show its output even if no task selected
      if (currentTaskId) {
        const timing: IterationTimingInfo = {
          startedAt: currentIterationStartedAt,
          isRunning: true,
        };
        return {
          iteration: currentIteration,
          output: currentOutput,
          segments: currentSegments,
          usage: taskUsageMap.get(currentTaskId),
          timing,
        };
      }
      return {
        iteration: currentIteration,
        output: undefined,
        segments: undefined,
        usage: undefined,
        timing: undefined,
      };
    }

    // Check if this task is currently being executed
    // Derive active status from the effective task (iterations view uses selectedIteration.task,
    // tasks view uses selectedTask) to avoid showing wrong output
    const effectiveTaskStatus = viewMode === 'iterations'
      ? selectedIteration?.task?.status
      : selectedTask?.status;
    const isActiveTask = effectiveTaskStatus === 'active' || effectiveTaskStatus === 'in_progress';
    const isExecuting = currentTaskId === effectiveTaskId || isActiveTask;
    // Only use currentOutput if we have actual content - on session resume, currentOutput is empty
    // but the task is marked "active", so we should fall through to historical cache lookup
    if (isExecuting && currentTaskId && currentOutput) {
      // Use the captured start time from the iteration:started event
      const timing: IterationTimingInfo = {
        startedAt: currentIterationStartedAt,
        isRunning: true,
      };
      return {
        iteration: currentIteration,
        output: currentOutput,
        segments: currentSegments,
        usage: taskUsageMap.get(effectiveTaskId),
        timing,
      };
    }

    // Look for a completed iteration for this task (in-memory from current session)
    const taskIteration = iterations.find((iter) => iter.task.id === effectiveTaskId);
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
        usage: taskIteration.usage,
        timing,
      };
    }

    // Check historical output cache (loaded from disk)
    const historicalData = historicalOutputCache.get(effectiveTaskId);
    // Only use historical data if it has actual output content
    // Empty output ('') means no logs were found - treat as "not yet executed"
    if (historicalData !== undefined && historicalData.output) {
      return {
        iteration: -1, // Historical iteration number unknown, use -1 to indicate "past"
        output: historicalData.output,
        segments: undefined, // Historical data doesn't have segments
        usage: historicalData.usage,
        timing: historicalData.timing,
      };
    }

    // Task hasn't been run yet (or historical log not yet loaded)
    return {
      iteration: 0,
      output: undefined,
      segments: undefined,
      usage: effectiveTaskId ? taskUsageMap.get(effectiveTaskId) : undefined,
      timing: undefined,
    };
  }, [
    effectiveTaskId,
    selectedTask,
    selectedIteration,
    viewMode,
    currentTaskId,
    currentIteration,
    currentOutput,
    currentSegments,
    iterations,
    historicalOutputCache,
    currentIterationStartedAt,
    isViewingRemote,
    remoteStatus,
    remoteCurrentIteration,
    remoteOutput,
    remoteIterationCache,
    remoteCurrentTaskId,
    isParallelMode,
    parallelTaskIdToWorkerId,
    parallelWorkerOutputs,
    taskUsageMap,
    remoteTaskUsageMap,
  ]);

  // Compute the actual output to display based on selectedSubagentId
  // When a subagent is selected (not task root), try to get its specific output
  // NOTE: Only use selectedSubagentId when viewing the current task - subagent tree
  // only shows subagents for the currently executing task
  const displayIterationOutput = useMemo(() => {
    // Compute effective task ID - what task are we actually viewing?
    // This avoids using potentially stale selectedTask?.id directly
    const effectiveTaskId = viewMode === 'iterations'
      ? selectedIteration?.task?.id
      : selectedTask?.id;

    // Check if we're viewing the currently executing task
    // For remote instances, compare against remoteCurrentTaskId
    const activeTaskId = isViewingRemote ? remoteCurrentTaskId : currentTaskId;
    const isViewingCurrentTask = effectiveTaskId === activeTaskId;

    // Check if task root is selected (effectiveTaskId or 'main' for backwards compat)
    const isTaskRootSelected = selectedSubagentId === effectiveTaskId || selectedSubagentId === 'main';

    // If not viewing current task, or task root is selected, show the iteration output
    if (!isViewingCurrentTask || isTaskRootSelected) {
      return selectedTaskIteration.output;
    }

    // Helper to recursively find a subagent node by ID
    function findSubagentNode(nodes: SubagentTreeNode[], id: string): SubagentTreeNode | undefined {
      for (const node of nodes) {
        if (node.state.id === id) return node;
        const found = findSubagentNode(node.children, id);
        if (found) return found;
      }
      return undefined;
    }

    // Use appropriate tree based on whether viewing remote
    const tree = isViewingRemote ? remoteSubagentTree : subagentTree;

    // Find subagent state from tree
    const subagentNode = findSubagentNode(tree, selectedSubagentId);

    // For remote instances, we can only show info from the tree node
    // (subagent output/details APIs are local-only)
    if (isViewingRemote) {
      if (subagentNode) {
        const { state } = subagentNode;
        const lines: string[] = [];
        lines.push(`═══ [${state.type}] ${state.description} ═══`);
        lines.push('');

        // Status and timing
        const statusLine = `Status: ${state.status}`;
        const durationLine = state.durationMs
          ? `  |  Duration: ${state.durationMs < 1000 ? `${state.durationMs}ms` : `${Math.round(state.durationMs / 1000)}s`}`
          : '';
        lines.push(statusLine + durationLine);

        // Child subagents
        if (state.children.length > 0) {
          lines.push(`Child subagents: ${state.children.length}`);
        }

        lines.push('');

        // Status message
        if (state.status === 'running') {
          lines.push('─── Status ───');
          lines.push('Subagent is currently running...');
        } else if (state.status === 'completed') {
          lines.push('─── Info ───');
          lines.push('Detailed subagent output not available for remote instances.');
          lines.push('View the main task output for full iteration results.');
        } else if (state.status === 'error') {
          lines.push('─── Error ───');
          lines.push('Subagent encountered an error');
        }

        return lines.join('\n');
      }
      return `[Subagent ${selectedSubagentId}]\nNo output available for remote instance`;
    }

    // Local instance: get subagent-specific output from engine (engine absent in parallel mode)
    const subagentOutput = engine?.getSubagentOutput(selectedSubagentId);

    // Build rich output based on subagent state
    // We have: metadata, prompt, result, child subagents, timing
    if (subagentNode) {
      const { state } = subagentNode;
      const details = engine?.getSubagentDetails(selectedSubagentId);

      // Build header
      const lines: string[] = [];
      lines.push(`═══ [${state.type}] ${state.description} ═══`);
      lines.push('');

      // Status and timing
      const statusLine = `Status: ${state.status}`;
      const durationLine = state.durationMs
        ? `  |  Duration: ${state.durationMs < 1000 ? `${state.durationMs}ms` : `${Math.round(state.durationMs / 1000)}s`}`
        : '';
      lines.push(statusLine + durationLine);

      // Timestamps
      if (details) {
        const startTime = new Date(details.spawnedAt).toLocaleTimeString();
        const endTime = details.endedAt ? new Date(details.endedAt).toLocaleTimeString() : 'running';
        lines.push(`Started: ${startTime}  |  Ended: ${endTime}`);
      }

      // Child subagents
      if (state.children.length > 0) {
        lines.push(`Child subagents: ${state.children.length}`);
      }

      lines.push('');

      // Show the prompt/task given to the subagent
      if (details?.prompt) {
        lines.push('─── Task Given ───');
        lines.push(details.prompt);
        lines.push('');
      }

      // Show the result if available
      if (subagentOutput && subagentOutput.trim().length > 0) {
        lines.push('─── Result ───');
        lines.push(subagentOutput);
      } else if (state.status === 'running') {
        lines.push('─── Status ───');
        lines.push('Subagent is currently running...');
      } else if (state.status === 'completed') {
        lines.push('─── Result ───');
        lines.push('(Subagent completed without returning detailed output)');
      } else if (state.status === 'error') {
        lines.push('─── Error ───');
        lines.push('Subagent encountered an error');
      }

      return lines.join('\n');
    }

    // Subagent not found in tree
    if (subagentOutput && subagentOutput.trim().length > 0) {
      return `[Subagent]\n\n${subagentOutput}`;
    }

    return `[Subagent ${selectedSubagentId}]\nNo output available`;
  }, [selectedSubagentId, currentTaskId, remoteCurrentTaskId, selectedTask?.id, selectedIteration?.task?.id, viewMode, selectedTaskIteration.output, engine, subagentTree, remoteSubagentTree, isViewingRemote]);

  // Compute historic agent/model for display when viewing completed iterations
  // Falls back to current values if viewing a live iteration or no historic data available
  // Uses effectiveTaskId which is unified across tasks and iterations views
  const displayAgentInfo = useMemo(() => {
    // If this is the currently executing task, use current agent/model
    if (effectiveTaskId && currentTaskId === effectiveTaskId) {
      return { agent: displayAgentName, model: displayModel };
    }

    // If viewing a running iteration, use current values
    if (selectedIteration?.status === 'running') {
      return { agent: displayAgentName, model: displayModel };
    }

    // For completed tasks/iterations, check historical cache using the unified task ID
    if (effectiveTaskId && historicalOutputCache.has(effectiveTaskId)) {
      const cachedData = historicalOutputCache.get(effectiveTaskId);
      if (cachedData?.agentPlugin || cachedData?.model) {
        return { agent: cachedData.agentPlugin, model: cachedData.model };
      }
    }

    // Fall back to current values
    return { agent: displayAgentName, model: displayModel };
  }, [effectiveTaskId, selectedIteration, currentTaskId, displayAgentName, displayModel, historicalOutputCache]);

  // Load historical iteration logs from disk when a task is selected.
  // This populates the cache so output is available even on session resume
  // when currentOutput is empty but the task appears "active".
  useEffect(() => {
    if (!cwd || !effectiveTaskId) return;

    // Check if we should load historical data
    // Don't load for currently running iterations
    const isRunning = selectedIteration?.status === 'running';
    if (isRunning) return;

    // Don't load historical data when viewing the currently executing task from tasks view
    // (no iteration selected). Live output should be shown instead of stale disk data.
    const isCurrentlyExecutingTask = selectedTask?.id === currentTaskId && selectedTask?.status === 'active';
    const isTasksView = !selectedIteration;
    if (isCurrentlyExecutingTask && isTasksView) return;

    // For active tasks, only load historical if no current iteration yet (resume scenario)
    // This allows showing previous output when resuming an in-progress task
    const isActiveTask = selectedTask?.status === 'active';
    const hasCurrentIteration = iterations.some(i => i.task.id === effectiveTaskId);
    if (isActiveTask && hasCurrentIteration) return;

    // Check if already in cache
    const hasInCache = historicalOutputCache.has(effectiveTaskId);

    if (!hasInCache) {
      // Load from disk asynchronously
      const taskId = effectiveTaskId;
      void (async () => {
        try {
          const logs = await getIterationLogsByTask(cwd, taskId);
          if (logs.length > 0) {
            // Use the most recent log (last one)
            const mostRecent = logs[logs.length - 1];
            const timing: IterationTimingInfo = {
              startedAt: mostRecent.metadata.startedAt,
              endedAt: mostRecent.metadata.endedAt,
              durationMs: mostRecent.metadata.durationMs,
              isRunning: false,
            };
            const contextWindow = await resolveModelContextWindow(
              mostRecent.metadata.model,
              mostRecent.metadata.agentPlugin
            );
            const fallbackUsage = summarizeTokenUsageFromOutput(mostRecent.stdout);
            const usage = mostRecent.metadata.usage
              ? normalizeUsage(mostRecent.metadata.usage, contextWindow)
              : fallbackUsage
                ? normalizeUsage(fallbackUsage, contextWindow)
                : undefined;

            setHistoricalOutputCache((prev) => {
              const next = new Map(prev);
              next.set(taskId, {
                output: mostRecent.stdout,
                timing,
                usage,
                agentPlugin: mostRecent.metadata.agentPlugin,
                model: mostRecent.metadata.model,
              });
              return next;
            });

            if (usage) {
              setTaskUsageMap((prev) => {
                const next = new Map(prev);
                next.set(taskId, usage);
                return next;
              });
            }
          } else {
            // No logs found - mark as empty output with no timing to avoid repeated lookups
            setHistoricalOutputCache((prev) => {
              const next = new Map(prev);
              next.set(taskId, { output: '', timing: {} });
              return next;
            });
          }
        } catch {
          // On error, mark as empty to avoid repeated failed lookups
          setHistoricalOutputCache((prev) => {
            const next = new Map(prev);
            next.set(taskId, { output: '', timing: {} });
            return next;
          });
        }
      })();
    }
  }, [
    effectiveTaskId,
    selectedTask,
    selectedIteration,
    cwd,
    historicalOutputCache,
    resolveModelContextWindow,
  ]);

  // Lazy load subagent trace data and historic context when viewing iteration details
  useEffect(() => {
    if (viewMode !== 'iteration-detail' || !detailIteration || !cwd) {
      // Clear data when not in detail view
      setIterationDetailSubagentTree(undefined);
      setIterationDetailSubagentStats(undefined);
      setIterationDetailSubagentLoading(false);
      setIterationDetailHistoricContext(undefined);
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
      if (log) {
        // Extract historic execution context from metadata
        const historicContext: HistoricExecutionContext = {
          agentPlugin: log.metadata.agentPlugin,
          model: log.metadata.model,
          sandboxMode: log.metadata.sandboxMode,
          resolvedSandboxMode: log.metadata.resolvedSandboxMode,
          sandboxNetwork: log.metadata.sandboxNetwork,
        };
        setIterationDetailHistoricContext(historicContext);

        // Extract subagent trace data if available
        if (log.subagentTrace) {
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
      } else {
        setIterationDetailSubagentTree(undefined);
        setIterationDetailSubagentStats(undefined);
        setIterationDetailHistoricContext(undefined);
      }
      setIterationDetailSubagentLoading(false);
    }).catch(() => {
      setIterationDetailSubagentLoading(false);
      setIterationDetailSubagentTree(undefined);
      setIterationDetailSubagentStats(undefined);
      setIterationDetailHistoricContext(undefined);
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

  // Auto-dismiss info feedback after 4 seconds (longer for reading)
  useEffect(() => {
    if (!infoFeedback) return;
    const timer = setTimeout(() => {
      setInfoFeedback(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [infoFeedback]);

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Tab Bar - instance navigation (local + remotes) */}
      {instanceTabs && instanceTabs.length > 1 && (
        <TabBar
          tabs={instanceTabs}
          selectedIndex={selectedTabIndex}
        />
      )}

      {/* Header - compact design showing essential info + agent/tracker + fallback status */}
      <Header
        status={displayStatus}
        elapsedTime={elapsedTime}
        currentTaskId={displayCurrentTaskId}
        currentTaskTitle={displayCurrentTaskTitle}
        completedTasks={completedTasks}
        totalTasks={totalTasks}
        agentName={displayAgentName}
        trackerName={displayTrackerName}
        activeAgentState={isViewingRemote ? remoteActiveAgent : activeAgentState}
        rateLimitState={isViewingRemote ? remoteRateLimitState : rateLimitState}
        currentIteration={displayCurrentIteration}
        maxIterations={displayMaxIterations}
        currentModel={displayModel}
        sandboxConfig={isViewingRemote ? remoteSandboxConfig : sandboxConfig}
        resolvedSandboxMode={isViewingRemote ? remoteResolvedSandboxMode : resolvedSandboxMode}
        remoteInfo={
          isViewingRemote && instanceTabs?.[selectedTabIndex]
            ? {
                name: instanceTabs[selectedTabIndex].alias ?? instanceTabs[selectedTabIndex].label,
                host: instanceTabs[selectedTabIndex].host ?? 'unknown',
                port: instanceTabs[selectedTabIndex].port ?? 0,
              }
            : undefined
        }
      />

      {/* Progress Dashboard - toggleable with 'd' key */}
      {showDashboard && (
        <ProgressDashboard
          status={displayStatus}
          agentName={displayAgentName}
          currentModel={displayModel}
          trackerName={displayTrackerName || 'beads'}
          epicName={epicName}
          currentTaskId={displayCurrentTaskId}
          currentTaskTitle={displayCurrentTaskTitle}
          sandboxConfig={isViewingRemote ? remoteSandboxConfig : sandboxConfig}
          resolvedSandboxMode={isViewingRemote ? remoteResolvedSandboxMode : resolvedSandboxMode}
          remoteInfo={
            isViewingRemote && instanceTabs?.[selectedTabIndex]
              ? {
                  name: instanceTabs[selectedTabIndex].alias ?? instanceTabs[selectedTabIndex].label,
                  host: instanceTabs[selectedTabIndex].host ?? 'unknown',
                  port: instanceTabs[selectedTabIndex].port ?? 0,
                }
              : undefined
          }
          autoCommit={isViewingRemote ? remoteAutoCommit : storedConfig?.autoCommit}
          gitInfo={isViewingRemote ? remoteGitInfo : localGitInfo}
          activeWorkerCount={activeWorkerCount}
          totalWorkerCount={totalWorkerCount}
          aggregateUsage={displayAggregateUsage}
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
            historicContext={iterationDetailHistoricContext}
          />
        ) : viewMode === 'parallel-overview' ? (
          // Parallel workers overview
          <ParallelProgressView
            workers={parallelWorkers}
            mergeQueue={parallelMergeQueue}
            currentGroup={parallelCurrentGroup}
            totalGroups={parallelTotalGroups}
            maxWidth={width}
            selectedWorkerIndex={selectedWorkerIndex}
          />
        ) : viewMode === 'parallel-detail' && parallelWorkers[selectedWorkerIndex] ? (
          // Single worker detail view
          <WorkerDetailView
            worker={parallelWorkers[selectedWorkerIndex]!}
            workerIndex={selectedWorkerIndex}
            outputLines={parallelWorkerOutputs?.get(parallelWorkers[selectedWorkerIndex]!.id) ?? []}
            maxWidth={width}
            maxHeight={contentHeight}
          />
        ) : viewMode === 'merge-progress' ? (
          // Merge queue progress view
          <MergeProgressView
            mergeQueue={parallelMergeQueue}
            sessionBackupTag={parallelSessionBackupTag}
            maxWidth={width}
            maxHeight={contentHeight}
          />
        ) : viewMode === 'tasks' ? (
          <>
            <LeftPanel
              tasks={displayedTasks}
              selectedIndex={selectedIndex}
              isFocused={!subagentPanelVisible || focusedPane === 'output'}
              isViewingRemote={isViewingRemote}
              remoteConnectionStatus={instanceTabs?.[selectedTabIndex]?.status}
              remoteAlias={instanceTabs?.[selectedTabIndex]?.alias}
            />
            <RightPanel
              selectedTask={selectedTask}
              currentIteration={selectedTaskIteration.iteration}
              iterationOutput={displayIterationOutput}
              iterationSegments={selectedTaskIteration.segments}
              taskUsage={selectedTaskIteration.usage}
              viewMode={detailsViewMode}
              iterationTiming={selectedTaskIteration.timing}
              agentName={displayAgentInfo.agent}
              currentModel={displayAgentInfo.model}
              promptPreview={promptPreview}
              templateSource={templateSource}
              isViewingRemote={isViewingRemote}
              remoteConnectionStatus={instanceTabs?.[selectedTabIndex]?.status}
              remoteAlias={instanceTabs?.[selectedTabIndex]?.alias}
            />
            {/* Subagent Tree Panel - shown on right side when toggled with 'T' key */}
            {subagentPanelVisible && (
              <SubagentTreePanel
                tree={isViewingRemote ? remoteSubagentTree : subagentTree}
                activeSubagentId={focusedSubagentId}
                width={45}
                currentTaskId={displayCurrentTaskId}
                currentTaskTitle={displayCurrentTaskTitle}
                currentTaskStatus={displayStatus === 'executing' ? 'running' : displayStatus === 'complete' ? 'completed' : displayStatus === 'error' ? 'error' : 'idle'}
                selectedId={selectedSubagentId}
                onSelect={setSelectedSubagentId}
                isFocused={focusedPane === 'subagentTree'}
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
              iterationOutput={displayIterationOutput}
              iterationSegments={selectedTaskIteration.segments}
              taskUsage={selectedTaskIteration.usage}
              viewMode={detailsViewMode}
              iterationTiming={selectedTaskIteration.timing}
              agentName={displayAgentInfo.agent}
              currentModel={displayAgentInfo.model}
              promptPreview={promptPreview}
              templateSource={templateSource}
              isViewingRemote={isViewingRemote}
              remoteConnectionStatus={instanceTabs?.[selectedTabIndex]?.status}
              remoteAlias={instanceTabs?.[selectedTabIndex]?.alias}
            />
            {/* Subagent Tree Panel - shown on right side when toggled with 'T' key */}
            {subagentPanelVisible && (
              <SubagentTreePanel
                tree={isViewingRemote ? remoteSubagentTree : subagentTree}
                activeSubagentId={focusedSubagentId}
                width={45}
                currentTaskId={displayCurrentTaskId}
                currentTaskTitle={displayCurrentTaskTitle}
                currentTaskStatus={displayStatus === 'executing' ? 'running' : displayStatus === 'complete' ? 'completed' : displayStatus === 'error' ? 'error' : 'idle'}
                selectedId={selectedSubagentId}
                onSelect={setSelectedSubagentId}
                isFocused={focusedPane === 'subagentTree'}
              />
            )}
          </>
        )}
      </box>

      {/* Footer */}
      <Footer />

      {/* Subagent activity indicator - shows when panel is hidden but subagents are running */}
      {!subagentPanelVisible && runningSubagentCount > 0 && (
        <box
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: colors.bg.tertiary,
            border: true,
            borderColor: colors.status.info,
          }}
        >
          <text fg={colors.status.info}>
            ▸ {runningSubagentCount} subagent{runningSubagentCount > 1 ? 's' : ''} running (T to show)
          </text>
        </box>
      )}

      {/* Copy feedback toast - positioned at bottom right */}
      {copyFeedback && (
        <box
          style={{
            position: 'absolute',
            bottom: 2,
            right: copyFeedback && !subagentPanelVisible && runningSubagentCount > 0 ? 40 : 2,
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

      {/* Info feedback toast - positioned at bottom center */}
      {infoFeedback && (
        <box
          style={{
            position: 'absolute',
            bottom: 2,
            left: Math.max(2, Math.floor((width - infoFeedback.length - 6) / 2)),
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: colors.bg.tertiary,
            border: true,
            borderColor: colors.fg.muted,
          }}
        >
          <text fg={colors.fg.secondary}>ℹ {infoFeedback}</text>
        </box>
      )}

      {/* Connection toast - shows reconnection events (US-5) */}
      {connectionToast && (() => {
        const formatted = formatConnectionToast(connectionToast);
        return (
          <Toast
            visible={true}
            message={formatted.message}
            icon={formatted.icon}
            variant={formatted.variant}
            bottom={4}
            right={2}
          />
        );
      })()}

      {/* Parallel failure banner */}
      {isParallelMode && parallelFailureMessage && (
        <Toast
          visible={true}
          message={parallelFailureMessage}
          icon={'⚠'}
          variant="error"
          bottom={6}
          right={2}
        />
      )}

      {/* Interrupt Confirmation Dialog */}
      <ConfirmationDialog
        visible={showInterruptDialog}
        title="⚠ Interrupt Ralph?"
        message="Current iteration will be terminated."
        hint="[y] Yes  [n/Esc] No  [Ctrl+C] Force quit"
      />

      {/* Kill Confirmation Dialog (parallel mode) */}
      <ConfirmationDialog
        visible={showKillDialog}
        title="⚠ Kill all workers?"
        message="All running agents will be terminated immediately."
        hint="[y] Yes, kill all  [n/Esc] Cancel"
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

      {/* Conflict Resolution Panel */}
      <ConflictResolutionPanel
        visible={showConflictPanel}
        conflicts={parallelConflicts}
        resolutions={parallelConflictResolutions}
        taskId={parallelConflictTaskId}
        taskTitle={parallelConflictTaskTitle}
        aiResolving={parallelAiResolving}
        currentlyResolvingFile={parallelCurrentlyResolvingFile}
        selectedIndex={conflictSelectedIndex}
        onRetry={onConflictRetry}
        onSkip={onConflictSkip}
      />

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

      {/* Remote Config View */}
      <RemoteConfigView
        visible={showRemoteConfig}
        remoteAlias={isViewingRemote ? (instanceTabs?.[selectedTabIndex]?.alias ?? instanceTabs?.[selectedTabIndex]?.label ?? 'remote') : 'Local'}
        configData={remoteConfigData}
        loading={remoteConfigLoading}
        error={remoteConfigError}
        onClose={() => setShowRemoteConfig(false)}
      />

      {/* Epic Loader Overlay */}
      {epicLoaderMode === 'file-prompt' ? (
        <EpicLoaderOverlay
          visible={showEpicLoader}
          mode="file-prompt"
          error={epicLoaderError}
          trackerName={trackerName}
          currentEpicId={currentEpicId}
          onCancel={() => setShowEpicLoader(false)}
          onFilePath={async (path: string) => {
            if (onFilePathSwitch) {
              try {
                const success = await onFilePathSwitch(path);
                if (success) {
                  setShowEpicLoader(false);
                } else {
                  setEpicLoaderError(`Failed to load file: ${path}`);
                }
              } catch (err) {
                const detail = err instanceof Error ? ` (${err.message})` : '';
                setEpicLoaderError(`Failed to load file: ${path}${detail}`);
              }
            }
          }}
        />
      ) : (
        <EpicLoaderOverlay
          visible={showEpicLoader}
          mode="list"
          epics={epicLoaderEpics}
          loading={epicLoaderLoading}
          error={epicLoaderError}
          trackerName={trackerName}
          currentEpicId={currentEpicId}
          onCancel={() => setShowEpicLoader(false)}
          onSelect={async (epic) => {
            try {
              if (onEpicSwitch) {
                await onEpicSwitch(epic);
              }
            } catch (err) {
              setEpicLoaderError(err instanceof Error ? err.message : 'Failed to switch epic');
              return;
            } finally {
              setShowEpicLoader(false);
            }
          }}
        />
      )}

      {/* Remote Management Overlay (add/edit/delete) */}
      <RemoteManagementOverlay
        visible={showRemoteManagement}
        mode={remoteManagementMode}
        existingRemote={editingRemote}
        onSave={async (data) => {
          if (!instanceManager) {
            throw new Error('Instance manager not available');
          }

          if (remoteManagementMode === 'add') {
            // Add new remote to config
            const result = await addRemote(data.alias, data.host, data.port, data.token);
            if (!result.success) {
              throw new Error(result.error || 'Failed to add remote');
            }
            // Connect to the new remote via InstanceManager
            await instanceManager.addAndConnectRemote(data.alias, data.host, data.port, data.token);
            // Select the new tab
            const newIndex = instanceManager.getTabIndexByAlias(data.alias);
            if (newIndex !== -1 && onSelectTab) {
              onSelectTab(newIndex);
            }
          } else {
            // Edit existing remote
            // If alias changed, we need to remove old and add new
            if (editingRemote && editingRemote.alias !== data.alias) {
              // Remove old config
              await removeRemote(editingRemote.alias);
              // Remove old tab
              instanceManager.removeTab(editingRemote.alias);
              // Add new config
              const result = await addRemote(data.alias, data.host, data.port, data.token);
              if (!result.success) {
                throw new Error(result.error || 'Failed to add remote');
              }
              // Connect with new alias
              await instanceManager.addAndConnectRemote(data.alias, data.host, data.port, data.token);
            } else {
              // Same alias - just update config and reconnect
              await removeRemote(data.alias);
              const result = await addRemote(data.alias, data.host, data.port, data.token);
              if (!result.success) {
                throw new Error(result.error || 'Failed to update remote');
              }
              await instanceManager.reconnectRemote(data.alias, data.host, data.port, data.token);
            }
          }
          setShowRemoteManagement(false);
        }}
        onDelete={async (alias) => {
          if (!instanceManager) {
            throw new Error('Instance manager not available');
          }
          // Remove from config
          const result = await removeRemote(alias);
          if (!result.success) {
            throw new Error(result.error || 'Failed to remove remote');
          }
          // Remove tab and disconnect
          instanceManager.removeTab(alias);
          // Switch to local tab (index 0)
          if (onSelectTab) {
            onSelectTab(0);
          }
          setShowRemoteManagement(false);
        }}
        onClose={() => setShowRemoteManagement(false)}
      />
    </box>
  );
}
