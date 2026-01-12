/**
 * ABOUTME: RunApp component for the Ralph TUI execution view.
 * Integrates with the execution engine to display real-time progress.
 * Handles graceful interruption with confirmation dialog.
 */

import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { colors, layout } from '../theme.js';
import type { RalphStatus, TaskStatus } from '../theme.js';
import type { TaskItem, BlockerInfo } from '../types.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { LeftPanel } from './LeftPanel.js';
import { RightPanel } from './RightPanel.js';
import { IterationHistoryView } from './IterationHistoryView.js';
import { TaskDetailView } from './TaskDetailView.js';
import { IterationDetailView } from './IterationDetailView.js';
import { ProgressDashboard } from './ProgressDashboard.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import { HelpOverlay } from './HelpOverlay.js';
import { SettingsView } from './SettingsView.js';
import { EpicLoaderOverlay } from './EpicLoaderOverlay.js';
import type { EpicLoaderMode } from './EpicLoaderOverlay.js';
import type { ExecutionEngine, EngineEvent, IterationResult } from '../../engine/index.js';
import type { TrackerTask } from '../../plugins/trackers/types.js';
import type { StoredConfig } from '../../config/types.js';
import type { AgentPluginMeta } from '../../plugins/agents/types.js';
import type { TrackerPluginMeta } from '../../plugins/trackers/types.js';

/**
 * View modes for the RunApp component
 * - 'tasks': Show the task list (default)
 * - 'iterations': Show the iteration history
 * - 'task-detail': Show detailed view of a single task
 * - 'iteration-detail': Show detailed view of a single iteration
 */
type ViewMode = 'tasks' | 'iterations' | 'task-detail' | 'iteration-detail';

/**
 * Props for the RunApp component
 */
export interface RunAppProps {
  /** The execution engine instance */
  engine: ExecutionEngine;
  /** Callback when quit is requested */
  onQuit?: () => Promise<void>;
  /** Callback when Enter is pressed on a task to drill into details */
  onTaskDrillDown?: (task: TaskItem) => void;
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
  /** Callback when user wants to start the engine (Enter/s in ready state) */
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
  /** Current epic ID for highlighting in the loader */
  currentEpicId?: string;
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
  };
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
  onQuit,
  onTaskDrillDown,
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
  currentEpicId,
}: RunAppProps): ReactNode {
  const { width, height } = useTerminalDimensions();
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
  const [currentOutput, setCurrentOutput] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [epicName] = useState('Ralph');
  const [trackerName] = useState('beads');
  const [agentName] = useState('claude');
  // Dashboard visibility state
  const [showDashboard, setShowDashboard] = useState(true);
  // Completed iterations count for ETA calculation
  const [completedIterations, setCompletedIterations] = useState(0);
  // Iteration history state
  const [iterations, setIterations] = useState<IterationResult[]>([]);
  const [totalIterations] = useState(10); // Default max iterations for display
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [iterationSelectedIndex, setIterationSelectedIndex] = useState(0);
  // Task detail view state
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null);
  // Iteration detail view state
  const [detailIteration, setDetailIteration] = useState<IterationResult | null>(null);
  // Help overlay state
  const [showHelp, setShowHelp] = useState(false);
  // Settings view state
  const [showSettings, setShowSettings] = useState(false);
  // Show/hide closed tasks filter (default: show closed tasks)
  const [showClosedTasks, setShowClosedTasks] = useState(true);
  // Current task info for status display
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>(undefined);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string | undefined>(undefined);
  // Epic loader overlay state
  const [showEpicLoader, setShowEpicLoader] = useState(false);
  const [epicLoaderEpics, setEpicLoaderEpics] = useState<TrackerTask[]>([]);
  const [epicLoaderLoading, setEpicLoaderLoading] = useState(false);
  const [epicLoaderError, setEpicLoaderError] = useState<string | undefined>(undefined);
  // Determine epic loader mode based on tracker type
  const epicLoaderMode: EpicLoaderMode = trackerType === 'json' ? 'file-prompt' : 'list';

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
      done: 4,
      closed: 5,
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
          // Set current task info for display
          setCurrentTaskId(event.task.id);
          setCurrentTaskTitle(event.task.title);
          setStatus('executing');
          // Update task list to show current task as active
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'active' as TaskStatus } : t
            )
          );
          // Select the current task
          setTasks((prev) => {
            const idx = prev.findIndex((t) => t.id === event.task.id);
            if (idx !== -1) {
              setSelectedIndex(idx);
            }
            return prev;
          });
          break;

        case 'iteration:completed':
          // Increment completed iterations for ETA calculation
          setCompletedIterations((prev) => prev + 1);
          // Clear current task info and transition back to selecting
          setCurrentTaskId(undefined);
          setCurrentTaskTitle(undefined);
          setStatus('selecting');
          if (event.result.taskCompleted) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === event.result.task.id
                  ? { ...t, status: 'done' as TaskStatus }
                  : t
              )
            );
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
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'blocked' as TaskStatus } : t
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
            setCurrentOutput((prev) => prev + event.data);
          }
          break;

        case 'tasks:refreshed':
          // Update task list with fresh data from tracker
          setTasks(convertTasksWithDependencyStatus(event.tasks));
          break;
      }
    });

    return unsubscribe;
  }, [engine]);

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Get initial state from engine
  useEffect(() => {
    const state = engine.getState();
    setCurrentIteration(state.currentIteration);
    setCurrentOutput(state.currentOutput);
  }, [engine]);

  // Calculate the number of items in iteration history (iterations + pending)
  const iterationHistoryLength = Math.max(iterations.length, totalIterations);

  // Handle keyboard navigation
  const handleKeyboard = useCallback(
    (key: { name: string }) => {
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
          // Quit the application
          onQuit?.();
          break;

        case 'escape':
          // In detail view, Esc goes back to list view
          if (viewMode === 'task-detail') {
            setViewMode('tasks');
            setDetailTask(null);
          } else if (viewMode === 'iteration-detail') {
            setViewMode('iterations');
            setDetailIteration(null);
          } else {
            onQuit?.();
          }
          break;

        case 'up':
        case 'k':
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.max(0, prev - 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.max(0, prev - 1));
          }
          // No navigation in task-detail view (scrollbox handles it)
          break;

        case 'down':
        case 'j':
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.min(displayedTasks.length - 1, prev + 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.min(iterationHistoryLength - 1, prev + 1));
          }
          // No navigation in task-detail view (scrollbox handles it)
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

        case 'c':
          // Ctrl+C to stop
          if (key.name === 'c') {
            engine.stop();
          }
          break;

        case 'v':
          // Toggle between tasks and iterations view (only if not in detail view)
          if (viewMode !== 'task-detail' && viewMode !== 'iteration-detail') {
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
          // Start execution when in ready state
          if (status === 'ready' && onStart) {
            setStatus('running');
            onStart();
          }
          break;

        case 'r':
          // Refresh task list from tracker
          engine.refreshTasks();
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

        case 'return':
        case 'enter':
          // When in ready state, Enter starts the execution
          if (status === 'ready' && onStart) {
            setStatus('running');
            onStart();
            break;
          }

          if (viewMode === 'tasks') {
            // Drill into selected task details (use displayedTasks for filtered list)
            if (displayedTasks[selectedIndex]) {
              setDetailTask(displayedTasks[selectedIndex]);
              setViewMode('task-detail');
              onTaskDrillDown?.(displayedTasks[selectedIndex]);
            }
          } else if (viewMode === 'iterations') {
            // Drill into selected iteration details
            if (iterations[iterationSelectedIndex]) {
              setDetailIteration(iterations[iterationSelectedIndex]);
              setViewMode('iteration-detail');
              onIterationDrillDown?.(iterations[iterationSelectedIndex]);
            }
          }
          // In detail views, Enter does nothing
          break;
      }
    },
    [displayedTasks, selectedIndex, status, engine, onQuit, onTaskDrillDown, viewMode, iterations, iterationSelectedIndex, iterationHistoryLength, onIterationDrillDown, showInterruptDialog, onInterruptConfirm, onInterruptCancel, showHelp, showSettings, showEpicLoader, onStart, storedConfig, onSaveSettings, onLoadEpics]
  );

  useKeyboard(handleKeyboard);

  // Calculate layout - account for dashboard height when visible
  const dashboardHeight = showDashboard ? layout.progressDashboard.height : 0;
  const contentHeight = Math.max(
    1,
    height - layout.header.height - layout.footer.height - dashboardHeight
  );
  const isCompact = width < 80;

  // Calculate progress (counting both 'done' and 'closed' as completed)
  // 'done' = completed in current session, 'closed' = historically completed
  const completedTasks = tasks.filter(
    (t) => t.status === 'done' || t.status === 'closed'
  ).length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Get selected task from filtered list
  const selectedTask = displayedTasks[selectedIndex] ?? null;

  // Compute the iteration output to show for the selected task
  // - If selected task is currently executing: show live currentOutput
  // - If selected task has a completed iteration: show that iteration's output
  // - Otherwise: undefined (will show "waiting" or appropriate message)
  const selectedTaskIteration = useMemo(() => {
    if (!selectedTask) return { iteration: currentIteration, output: undefined };

    // Check if this task is currently being executed
    if (currentTaskId === selectedTask.id) {
      return { iteration: currentIteration, output: currentOutput };
    }

    // Look for a completed iteration for this task
    const taskIteration = iterations.find((iter) => iter.task.id === selectedTask.id);
    if (taskIteration) {
      return {
        iteration: taskIteration.iteration,
        output: taskIteration.agentResult?.stdout ?? '',
      };
    }

    // Task hasn't been run yet
    return { iteration: 0, output: undefined };
  }, [selectedTask, currentTaskId, currentIteration, currentOutput, iterations]);

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Header */}
      <Header
        status={status}
        epicName={epicName}
        elapsedTime={elapsedTime}
        trackerName={trackerName || 'beads'}
        currentTaskId={currentTaskId}
        currentTaskTitle={currentTaskTitle}
        currentIteration={currentIteration}
      />

      {/* Progress Dashboard - toggleable with 'd' key */}
      {showDashboard && (
        <ProgressDashboard
          status={status}
          completedTasks={completedTasks}
          totalTasks={totalTasks}
          currentIteration={currentIteration}
          maxIterations={totalIterations}
          elapsedTimeSeconds={elapsedTime}
          agentName={agentName}
          trackerName={trackerName || 'beads'}
          epicName={epicName}
          completedIterations={completedIterations}
          currentTaskId={currentTaskId}
          currentTaskTitle={currentTaskTitle}
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
        {viewMode === 'task-detail' && detailTask ? (
          // Full-screen task detail view
          <TaskDetailView
            task={detailTask}
            onBack={() => {
              setViewMode('tasks');
              setDetailTask(null);
            }}
          />
        ) : viewMode === 'iteration-detail' && detailIteration ? (
          // Full-screen iteration detail view
          <IterationDetailView
            iteration={detailIteration}
            totalIterations={totalIterations}
            onBack={() => {
              setViewMode('iterations');
              setDetailIteration(null);
            }}
          />
        ) : viewMode === 'tasks' ? (
          <>
            <LeftPanel tasks={displayedTasks} selectedIndex={selectedIndex} />
            <RightPanel
              selectedTask={selectedTask}
              currentIteration={selectedTaskIteration.iteration}
              iterationOutput={selectedTaskIteration.output}
            />
          </>
        ) : (
          <>
            <IterationHistoryView
              iterations={iterations}
              totalIterations={totalIterations}
              selectedIndex={iterationSelectedIndex}
              runningIteration={currentIteration}
              width={isCompact ? width : Math.floor(width * 0.5)}
            />
            <RightPanel
              selectedTask={selectedTask}
              currentIteration={selectedTaskIteration.iteration}
              iterationOutput={selectedTaskIteration.output}
            />
          </>
        )}
      </box>

      {/* Footer */}
      <Footer
        progress={progress}
        totalTasks={totalTasks}
        completedTasks={completedTasks}
      />

      {/* Interrupt Confirmation Dialog */}
      <ConfirmationDialog
        visible={showInterruptDialog}
        title="⚠ Interrupt Ralph?"
        message="Current iteration will be terminated."
        hint="[y] Yes  [n/Esc] No  [Ctrl+C] Force quit"
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
