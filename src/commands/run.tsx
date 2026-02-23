/**
 * ABOUTME: Run command implementation for ralph-tui.
 * Handles CLI argument parsing, configuration loading, session management,
 * and starting the execution engine with TUI.
 * Implements graceful interruption with Ctrl+C confirmation dialog.
 */

import { useState, useEffect, useMemo } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { buildConfig, validateConfig, loadStoredConfig, saveProjectConfig } from '../config/index.js';
import type { RuntimeOptions, StoredConfig, SandboxConfig } from '../config/types.js';
import {
  checkSession,
  createSession,
  resumeSession,
  endSession,
  hasPersistedSession,
  loadPersistedSession,
  savePersistedSession,
  deletePersistedSession,
  createPersistedSession,
  updateSessionAfterIteration,
  pauseSession,
  completeSession,
  failSession,
  isSessionResumable,
  getSessionSummary,
  addActiveTask,
  removeActiveTask,
  clearActiveTasks,
  getActiveTasks,
  setSubagentPanelVisible,
  acquireLockWithPrompt,
  releaseLockNew,
  registerLockCleanupHandlers,
  checkLock,
  detectAndRecoverStaleSession,
  registerSession,
  unregisterSession,
  updateRegistryStatus,
  type PersistedSessionState,
} from '../session/index.js';
import { ExecutionEngine } from '../engine/index.js';
import { ParallelExecutor, analyzeTaskGraph, shouldRunParallel, recommendParallelism } from '../parallel/index.js';
import { createAiResolver } from '../parallel/ai-resolver.js';
import type {
  WorkerDisplayState,
  MergeOperation,
  FileConflict,
  ConflictResolutionResult,
  ParallelExecutorStatus,
} from '../parallel/types.js';
import type { ParallelEvent } from '../parallel/events.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import { registerBuiltinTrackers } from '../plugins/trackers/builtin/index.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { getTrackerRegistry } from '../plugins/trackers/registry.js';
import { RunApp } from '../tui/components/RunApp.js';
import { EpicSelectionApp } from '../tui/components/EpicSelectionApp.js';
import type { TrackerPlugin, TrackerTask } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';
import { projectConfigExists, runSetupWizard, checkAndMigrate } from '../setup/index.js';
import { createInterruptHandler } from '../interruption/index.js';
import type { InterruptHandler } from '../interruption/types.js';
import { createStructuredLogger, clearProgress } from '../logs/index.js';
import { sendCompletionNotification, sendMaxIterationsNotification, sendErrorNotification, resolveNotificationsEnabled } from '../notifications.js';
import type { NotificationSoundMode } from '../config/types.js';
import { detectSandboxMode } from '../sandbox/index.js';
import type { SandboxMode } from '../sandbox/index.js';
import {
  createRemoteServer,
  getOrCreateServerToken,
  getServerTokenInfo,
  rotateServerToken,
  DEFAULT_LISTEN_OPTIONS,
  InstanceManager,
  type RemoteServer,
  type InstanceTab,
} from '../remote/index.js';
import { initializeTheme } from '../tui/theme.js';
import type { ConnectionToastMessage } from '../tui/components/Toast.js';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { getEnvExclusionReport, formatEnvExclusionReport } from '../plugins/agents/base.js';

type PersistState = (state: PersistedSessionState) => void | Promise<void>;

type ParallelFailureCarrier = {
  failureMessage: string | null;
};

export function applyParallelFailureState(
  currentState: PersistedSessionState,
  parallelState: ParallelFailureCarrier,
  failureMessage: string,
  persistState: PersistState
): PersistedSessionState {
  const nextFailureMessage = parallelState.failureMessage ?? failureMessage;
  parallelState.failureMessage = nextFailureMessage;
  const nextState = failSession(currentState, nextFailureMessage);
  persistState(nextState);
  return nextState;
}

/**
 * Determine if all tasks are complete based on parallel/sequential mode state.
 *
 * In parallel mode, `parallelAllComplete` is set by the parallel executor.
 * In sequential mode (parallelAllComplete is null), we check task counts.
 *
 * Note: The engine status is always 'idle' after runLoop exits (set in finally block),
 * so completion must be determined by task counts, not engine status.
 * See: https://github.com/subsy/ralph-tui/issues/247
 *
 * @param parallelAllComplete - Completion flag from parallel mode, or null for sequential
 * @param tasksCompleted - Number of tasks completed
 * @param totalTasks - Total number of tasks
 * @returns true if session should be considered complete
 */
export function isSessionComplete(
  parallelAllComplete: boolean | null,
  tasksCompleted: number,
  totalTasks: number
): boolean {
  return parallelAllComplete ?? (tasksCompleted >= totalTasks);
}

/**
 * Determine whether a worker result should be shown as completed-locally.
 *
 * A completed-locally task needs only an agent-level completion signal.
 * Merge success/failure is tracked separately via merge events.
 */
export function shouldMarkCompletedLocally(
  taskCompleted: boolean,
  _commitCount: number
): boolean {
  return taskCompleted;
}

/**
 * Compute the next completed-locally task ID set for a worker completion event.
 */
export function updateCompletedLocallyTaskIds(
  completedLocallyTaskIds: Set<string>,
  taskId: string,
  taskCompleted: boolean,
  commitCount: number
): Set<string> {
  if (shouldMarkCompletedLocally(taskCompleted, commitCount)) {
    return new Set([...completedLocallyTaskIds, taskId]);
  }

  const nextCompletedLocally = new Set(completedLocallyTaskIds);
  nextCompletedLocally.delete(taskId);
  return nextCompletedLocally;
}

/**
 * Apply persisted-session state changes when parallel execution emits completed.
 *
 * The executor can emit `parallel:completed` after interruption as part of shutdown,
 * so completion must be based on final executor status.
 */
export function applyParallelCompletionState(
  currentState: PersistedSessionState,
  executorStatus: ParallelExecutorStatus
): PersistedSessionState {
  if (executorStatus === 'completed') {
    return completeSession(currentState);
  }

  return {
    ...currentState,
    status: 'interrupted',
    isPaused: false,
    activeTaskIds: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Determine whether a parallel run is fully complete.
 * Requires both completed status and completed task counts.
 */
export function isParallelExecutionComplete(
  executorStatus: ParallelExecutorStatus,
  totalTasksCompleted: number,
  totalTasks: number
): boolean {
  return executorStatus === 'completed' && totalTasksCompleted >= totalTasks;
}

/**
 * Apply task-tracking set updates after a conflict:resolved event.
 *
 * When resolution results are empty, the conflict was skipped and the task must
 * remain in completed-locally state (not merged).
 */
export function applyConflictResolvedTaskTracking(
  completedLocallyTaskIds: Set<string>,
  mergedTaskIds: Set<string>,
  taskId: string,
  resolutionCount: number
): { completedLocallyTaskIds: Set<string>; mergedTaskIds: Set<string> } {
  if (resolutionCount < 1) {
    return {
      completedLocallyTaskIds,
      mergedTaskIds,
    };
  }

  const nextCompletedLocally = new Set(completedLocallyTaskIds);
  nextCompletedLocally.delete(taskId);
  const nextMerged = new Set([...mergedTaskIds, taskId]);

  return {
    completedLocallyTaskIds: nextCompletedLocally,
    mergedTaskIds: nextMerged,
  };
}

/**
 * Propagate runtime-updateable settings from stored config to a running engine.
 * Called after saving settings to ensure the engine picks up changes immediately.
 */
export function propagateSettingsToEngine(
  engine: ExecutionEngine | null | undefined,
  newConfig: StoredConfig,
): void {
  if (!engine) return;
  if (newConfig.autoCommit !== undefined) {
    engine.setAutoCommit(newConfig.autoCommit);
  }
}

/**
 * Get git repository information for the current working directory.
 * Returns undefined values if not a git repository or git command fails.
 */
function getGitInfo(cwd: string): {
  repoName?: string;
  branch?: string;
  isDirty?: boolean;
  commitHash?: string;
} {
  try {
    // Get repository root name
    const repoRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });
    const repoName = repoRoot.status === 0 ? basename(repoRoot.stdout.trim()) : undefined;

    // Get current branch
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });
    const branch = branchResult.status === 0 ? branchResult.stdout.trim() : undefined;

    // Check for uncommitted changes
    const statusResult = spawnSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });
    const isDirty = statusResult.status === 0 ? statusResult.stdout.trim().length > 0 : undefined;

    // Get short commit hash
    const hashResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    });
    const commitHash = hashResult.status === 0 ? hashResult.stdout.trim() : undefined;

    return { repoName, branch, isDirty, commitHash };
  } catch {
    return {};
  }
}

/**
 * Task range filter for --task-range flag.
 * Allows filtering tasks by 1-indexed position (e.g., 1-5, 3-, -10).
 */
export interface TaskRangeFilter {
  /** Starting task number (1-indexed, inclusive). Undefined means from beginning. */
  start?: number;
  /** Ending task number (1-indexed, inclusive). Undefined means to the end. */
  end?: number;
}

/**
 * Extended runtime options with noSetup, verify, and listen flags
 */
interface ExtendedRuntimeOptions extends RuntimeOptions {
  noSetup?: boolean;
  verify?: boolean;
  /** Enable remote listener (implies headless) */
  listen?: boolean;
  /** Port for remote listener (default: 7890) */
  listenPort?: number;
  /** Rotate server token before starting listener */
  rotateToken?: boolean;
  /** Merge directly to current branch instead of creating session branch (parallel mode) */
  directMerge?: boolean;
  /** Filter tasks by index range (e.g., 1-5, 3-, -10) */
  taskRange?: TaskRangeFilter;
}

/**
 * Parse CLI arguments for the run command
 */
export function parseRunArgs(args: string[]): ExtendedRuntimeOptions {
  const options: ExtendedRuntimeOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg.startsWith('--sandbox=')) {
      const mode = arg.split('=')[1];
      if (mode === 'bwrap' || mode === 'sandbox-exec') {
        options.sandbox = {
          ...options.sandbox,
          enabled: true,
          mode,
        };
      }
      continue;
    }

    switch (arg) {
      case '--epic':
        if (nextArg && !nextArg.startsWith('-')) {
          options.epicId = nextArg;
          i++;
        }
        break;

      case '--prd':
        if (nextArg && !nextArg.startsWith('-')) {
          options.prdPath = nextArg;
          i++;
        }
        break;

      case '--agent':
        if (nextArg && !nextArg.startsWith('-')) {
          options.agent = nextArg;
          i++;
        }
        break;

      case '--model':
        if (nextArg && !nextArg.startsWith('-')) {
          options.model = nextArg;
          i++;
        }
        break;

      case '--variant':
        if (nextArg && !nextArg.startsWith('-')) {
          options.variant = nextArg;
          i++;
        }
        break;

      case '--tracker':
        if (nextArg && !nextArg.startsWith('-')) {
          options.tracker = nextArg;
          i++;
        }
        break;

      case '--iterations':
        if (nextArg && !nextArg.startsWith('-')) {
          const parsed = parseInt(nextArg, 10);
          if (!isNaN(parsed)) {
            options.iterations = parsed;
          }
          i++;
        }
        break;

      case '--delay':
        if (nextArg && !nextArg.startsWith('-')) {
          const parsed = parseInt(nextArg, 10);
          if (!isNaN(parsed)) {
            options.iterationDelay = parsed;
          }
          i++;
        }
        break;

      case '--cwd':
        if (nextArg && !nextArg.startsWith('-')) {
          options.cwd = nextArg;
          i++;
        }
        break;

      case '--resume':
        options.resume = true;
        break;

      case '--force':
        options.force = true;
        break;

      case '--headless':
      case '--no-tui':
        options.headless = true;
        break;

      case '--no-setup':
        options.noSetup = true;
        break;

      case '--sandbox':
        options.sandbox = {
          ...options.sandbox,
          enabled: true,
          mode: 'auto',
        };
        break;

      case '--no-sandbox':
        options.sandbox = {
          ...options.sandbox,
          enabled: false,
          mode: 'off',
        };
        break;

      case '--no-network':
        options.sandbox = {
          ...options.sandbox,
          enabled: true,
          network: false,
        };
        break;

      case '--prompt':
        if (nextArg && !nextArg.startsWith('-')) {
          options.promptPath = nextArg;
          i++;
        }
        break;

      case '--output-dir':
      case '--log-dir':
        if (nextArg && !nextArg.startsWith('-')) {
          options.outputDir = nextArg;
          i++;
        }
        break;

      case '--progress-file':
        if (nextArg && !nextArg.startsWith('-')) {
          options.progressFile = nextArg;
          i++;
        }
        break;

      case '--notify':
        options.notify = true;
        break;

      case '--no-notify':
        options.notify = false;
        break;

      case '--verify':
        options.verify = true;
        break;

      case '--listen':
        options.listen = true;
        options.headless = true; // Listen mode implies headless
        break;

      case '--listen-port':
        if (nextArg && !nextArg.startsWith('-')) {
          const parsed = parseInt(nextArg, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
            options.listenPort = parsed;
          }
          i++;
        }
        break;

      case '--rotate-token':
        options.rotateToken = true;
        break;

      case '--theme':
        if (nextArg && !nextArg.startsWith('-')) {
          options.themePath = nextArg;
          i++;
        }
        break;

      case '--serial':
      case '--sequential':
        options.serial = true;
        break;

      case '--parallel': {
        // --parallel or --parallel N
        if (nextArg && !nextArg.startsWith('-')) {
          const parsed = parseInt(nextArg, 10);
          if (!isNaN(parsed) && parsed > 0) {
            options.parallel = parsed;
            i++;
          } else {
            options.parallel = true;
          }
        } else {
          options.parallel = true;
        }
        break;
      }

      case '--direct-merge':
        options.directMerge = true;
        break;

      case '--task-range':
        // Allow nextArg if it exists and either doesn't start with '-' OR matches a negative-integer pattern (e.g., "-10")
        if (nextArg && (!nextArg.startsWith('-') || /^-\d+$/.test(nextArg))) {
          const range = nextArg;
          // Parse range formats: "1-5", "3-", "-10", "5"
          if (range.includes('-')) {
            const dashIndex = range.indexOf('-');
            const startPart = range.substring(0, dashIndex);
            const endPart = range.substring(dashIndex + 1);

            // Parse and validate start/end values
            const parsedStart = startPart ? parseInt(startPart, 10) : undefined;
            const parsedEnd = endPart ? parseInt(endPart, 10) : undefined;

            // Only set taskRange if at least one value is valid
            if (
              (parsedStart === undefined || !isNaN(parsedStart)) &&
              (parsedEnd === undefined || !isNaN(parsedEnd)) &&
              (parsedStart !== undefined || parsedEnd !== undefined)
            ) {
              options.taskRange = {
                start: parsedStart,
                end: parsedEnd,
              };
            }
          } else {
            // Single number means just that task
            const num = parseInt(range, 10);
            if (!isNaN(num)) {
              options.taskRange = { start: num, end: num };
            }
          }
          i++;
        }
        break;
    }
  }

  return options;
}

/**
 * Print run command help
 */
export function printRunHelp(): void {
  console.log(`
ralph-tui run - Start Ralph execution

Usage: ralph-tui run [options]

Options:
  --epic <id>         Epic ID for beads tracker (if omitted, shows epic selection)
  --prd <path>        PRD file path (auto-switches to json tracker)
  --agent <name>      Override agent plugin (e.g., claude, opencode)
  --model <name>      Override model (e.g., opus, sonnet)
  --variant <level>   Model variant/reasoning effort (minimal, high, max)
  --tracker <name>    Override tracker plugin (e.g., beads, beads-bv, json)
  --prompt <path>     Custom prompt file (default: based on tracker mode)
  --output-dir <path> Directory for iteration logs (default: .ralph-tui/iterations)
  --progress-file <path> Progress file for cross-iteration context (default: .ralph-tui/progress.md)
  --theme <name|path> Theme name (bright, catppuccin, dracula, high-contrast, solarized-light) or path to custom JSON theme file
  --iterations <n>    Maximum iterations (0 = unlimited)
  --delay <ms>        Delay between iterations in milliseconds
  --cwd <path>        Working directory
  --resume            Resume existing session
  --force             Force start even if locked
  --headless          Run without TUI (alias: --no-tui)
  --no-tui            Run without TUI, output structured logs to stdout
  --no-setup          Skip interactive setup even if no config exists
  --verify            Run agent preflight check before starting
  --notify            Force enable desktop notifications
  --no-notify         Force disable desktop notifications
  --sandbox           Enable sandboxing (auto mode)
  --sandbox=bwrap     Force Bubblewrap sandboxing (Linux)
  --sandbox=sandbox-exec  Force sandbox-exec (macOS)
  --no-sandbox        Disable sandboxing
  --no-network        Disable network access in sandbox
  --serial            Force sequential execution (default behavior)
  --sequential        Alias for --serial
  --parallel [N]      Force parallel execution with optional max workers (default workers: 3)
  --direct-merge      Merge directly to current branch (skip session branch creation)
  --task-range <range> Filter tasks by index (e.g., 1-5, 3-, -10)
  --listen            Enable remote listener (implies --headless)
  --listen-port <n>   Port for remote listener (default: 7890)
  --rotate-token      Rotate server token before starting listener

Log Output Format (--no-tui mode):
  [timestamp] [level] [component] message

  Levels: INFO, WARN, ERROR, DEBUG
  Components: progress, agent, engine, tracker, session, system

  Example output:
    [10:42:15] [INFO] [engine] Ralph started. Total tasks: 5
    [10:42:15] [INFO] [progress] Iteration 1/10: Working on US-001 - Add login
    [10:42:15] [INFO] [agent] Building prompt for task...
    [10:42:30] [INFO] [progress] Iteration 1 finished. Task US-001: COMPLETED. Duration: 15s

Examples:
  ralph-tui run                              # Start with defaults
  ralph-tui run --epic ralph-tui-45r         # Run with specific epic
  ralph-tui run --prd ./prd.json             # Run with PRD file
  ralph-tui run --agent claude --model opus  # Override agent settings
  ralph-tui run --tracker beads-bv           # Use beads-bv tracker
  ralph-tui run --iterations 20              # Limit to 20 iterations
  ralph-tui run --resume                     # Resume previous session
  ralph-tui run --no-tui                     # Run headless for CI/scripts
  ralph-tui run --listen --prd ./prd.json    # Run with remote listener enabled
`);
}

/**
 * Resolve parallel execution mode from CLI flags and stored config.
 * CLI flags take precedence over stored config.
 *
 * @returns 'auto' | 'always' | 'never'
 */
function resolveParallelMode(
  options: ExtendedRuntimeOptions,
  storedConfig?: StoredConfig | null
): 'auto' | 'always' | 'never' {
  // CLI flags take absolute precedence
  if (options.serial) return 'never';
  if (options.parallel) return 'always';

  // Fall back to stored config. Default to serial execution when unset.
  return storedConfig?.parallel?.mode ?? 'never';
}

/**
 * Filter tasks by index range.
 * Task indices are 1-indexed for user friendliness (e.g., --task-range 1-5).
 *
 * @param tasks - Full list of tasks to filter
 * @param taskRange - Range filter (start/end are 1-indexed, inclusive)
 * @returns Filtered tasks and a message describing the filter applied
 */
export function filterTasksByRange(
  tasks: TrackerTask[],
  taskRange: TaskRangeFilter
): { filteredTasks: TrackerTask[]; message: string } {
  const start = taskRange.start ?? 1;
  const end = taskRange.end ?? tasks.length;

  // Validate range
  if (start < 1 || (taskRange.end !== undefined && end < start)) {
    return {
      filteredTasks: tasks,
      message: 'Invalid task range, using all tasks',
    };
  }

  // Filter tasks (convert to 0-indexed)
  const filteredTasks = tasks.filter((_, idx) => {
    const taskNum = idx + 1; // 1-indexed for users
    return taskNum >= start && taskNum <= end;
  });

  // Build message describing the filter
  let rangeStr: string;
  if (taskRange.start !== undefined && taskRange.end !== undefined) {
    rangeStr = `${taskRange.start}-${taskRange.end}`;
  } else if (taskRange.start !== undefined) {
    rangeStr = `${taskRange.start}-`;
  } else if (taskRange.end !== undefined) {
    rangeStr = `-${taskRange.end}`;
  } else {
    rangeStr = 'all';
  }

  const message = `Task range ${rangeStr}: ${filteredTasks.length} of ${tasks.length} tasks selected`;

  return { filteredTasks, message };
}

// ─── Conflict Resolution Helpers ────────────────────────────────────────────────
// These functions encapsulate the conflict resolution logic for testability.
// They are used by the parallel execution callbacks in RunAppWrapper.

/**
 * State shape for parallel conflict tracking.
 * Matches the parallelState object used in parallel execution.
 */
export interface ParallelConflictState {
  conflicts: FileConflict[];
  conflictResolutions: ConflictResolutionResult[];
  conflictTaskId: string;
  conflictTaskTitle: string;
  aiResolving: boolean;
}

/**
 * Clear all conflict-related state after abort or resolution.
 * Called when user aborts conflict resolution or when conflicts are fully resolved.
 *
 * @param state - The parallel state object to clear
 */
export function clearConflictState(state: ParallelConflictState): void {
  state.conflicts = [];
  state.conflictResolutions = [];
  state.conflictTaskId = '';
  state.conflictTaskTitle = '';
  state.aiResolving = false;
}

/**
 * Find a conflict resolution result by file path.
 * Used when accepting a specific file's AI resolution.
 *
 * @param resolutions - Array of resolution results
 * @param filePath - Path of the file to find
 * @returns The resolution result if found, undefined otherwise
 */
export function findResolutionByPath(
  resolutions: ConflictResolutionResult[],
  filePath: string
): ConflictResolutionResult | undefined {
  return resolutions.find((r) => r.filePath === filePath);
}

/**
 * Check if all conflicts have been successfully resolved.
 *
 * @param conflicts - Array of file conflicts
 * @param resolutions - Array of resolution results
 * @returns true if all conflicts have successful resolutions
 */
export function areAllConflictsResolved(
  conflicts: FileConflict[],
  resolutions: ConflictResolutionResult[]
): boolean {
  if (conflicts.length === 0) return true;
  if (resolutions.length < conflicts.length) return false;
  return conflicts.every((conflict) => {
    const resolution = resolutions.find((r) => r.filePath === conflict.filePath);
    return resolution?.success === true;
  });
}

/**
 * Initialize plugin registries
 */
async function initializePlugins(): Promise<void> {
  // Register built-in plugins
  registerBuiltinAgents();
  registerBuiltinTrackers();

  // Initialize registries (discovers user plugins)
  const agentRegistry = getAgentRegistry();
  const trackerRegistry = getTrackerRegistry();

  await Promise.all([agentRegistry.initialize(), trackerRegistry.initialize()]);
}

/**
 * Result of detecting stale in_progress tasks
 */
interface StaleTasksResult {
  /** Task IDs that are stale in_progress from a crashed session */
  staleTasks: string[];
  /** Whether any tasks were reset */
  tasksReset: boolean;
  /** Count of tasks that were reset */
  resetCount: number;
}

/**
 * Detect and handle stale in_progress tasks from crashed sessions.
 *
 * This checks:
 * 1. If there's a persisted session file from a previous run
 * 2. If the lock is stale (previous process no longer running)
 * 3. If that session had any tasks marked as "active" (in_progress)
 *
 * If stale tasks are found, prompts the user whether to reset them back to open.
 *
 * @param cwd - Working directory
 * @param tracker - Tracker plugin instance
 * @param headless - Whether running in headless mode (auto-reset without prompt)
 * @returns Information about any stale tasks found and reset
 */
async function detectAndHandleStaleTasks(
  cwd: string,
  tracker: TrackerPlugin,
  headless: boolean
): Promise<StaleTasksResult> {
  const result: StaleTasksResult = {
    staleTasks: [],
    tasksReset: false,
    resetCount: 0,
  };

  // Check for persisted session from a previous run
  const hasSession = await hasPersistedSession(cwd);
  if (!hasSession) {
    return result;
  }

  const persistedState = await loadPersistedSession(cwd);
  if (!persistedState) {
    return result;
  }

  // Get active task IDs from the previous session
  const activeTaskIds = getActiveTasks(persistedState);
  if (activeTaskIds.length === 0) {
    return result;
  }

  // Check if the previous session's lock is stale (process no longer running)
  const lockStatus = await checkLock(cwd);

  // If the lock is still held by a running process, don't touch the tasks
  if (lockStatus.isLocked && !lockStatus.isStale) {
    return result;
  }

  // Found stale in_progress tasks from a crashed session!
  result.staleTasks = activeTaskIds;

  // Get task details for display
  const taskDetails: Array<{ id: string; title: string }> = [];
  for (const taskId of activeTaskIds) {
    try {
      const task = await tracker.getTask(taskId);
      if (task) {
        taskDetails.push({ id: task.id, title: task.title });
      } else {
        taskDetails.push({ id: taskId, title: '(task not found)' });
      }
    } catch {
      taskDetails.push({ id: taskId, title: '(error loading task)' });
    }
  }

  // Display warning
  console.log('');
  console.log('⚠️  Stale in_progress tasks detected');
  console.log('');
  console.log('A previous Ralph session did not exit cleanly.');
  console.log(`Found ${activeTaskIds.length} task(s) stuck in "in_progress" status:`);
  console.log('');
  for (const task of taskDetails) {
    console.log(`  • ${task.id}: ${task.title}`);
  }
  console.log('');

  // In headless mode, auto-reset with warning
  if (headless) {
    console.log('Headless mode: automatically resetting tasks to open...');
    for (const taskId of activeTaskIds) {
      try {
        await tracker.updateTaskStatus(taskId, 'open');
        result.resetCount++;
      } catch {
        // Continue on individual failures
      }
    }
    result.tasksReset = result.resetCount > 0;

    // Update the persisted state to clear active tasks
    if (result.tasksReset) {
      const updatedState = clearActiveTasks(persistedState);
      await savePersistedSession(updatedState);
    }

    console.log(`Reset ${result.resetCount} task(s) to open.`);
    console.log('');
    return result;
  }

  // Interactive mode: prompt user
  const { promptBoolean } = await import('../setup/prompts.js');
  const shouldReset = await promptBoolean(
    'Reset these tasks back to "open" status?',
    { default: true }
  );

  if (!shouldReset) {
    console.log('Tasks left as-is. They may need manual cleanup.');
    console.log('');
    return result;
  }

  // Reset tasks
  console.log('Resetting tasks...');
  for (const taskId of activeTaskIds) {
    try {
      await tracker.updateTaskStatus(taskId, 'open');
      result.resetCount++;
    } catch {
      console.log(`  Warning: Failed to reset ${taskId}`);
    }
  }
  result.tasksReset = result.resetCount > 0;

  // Update the persisted state to clear active tasks
  if (result.tasksReset) {
    const updatedState = clearActiveTasks(persistedState);
    await savePersistedSession(updatedState);
  }

  console.log(`Reset ${result.resetCount} task(s) to open.`);
  console.log('');

  return result;
}

/**
 * Handle session resume prompt
 * Checks for persisted session state and prompts user
 */
async function promptResumeOrNew(cwd: string): Promise<'resume' | 'new' | 'abort'> {
  // Check for persisted session file first
  const hasPersistedSessionFile = await hasPersistedSession(cwd);

  if (!hasPersistedSessionFile) {
    return 'new';
  }

  const persistedState = await loadPersistedSession(cwd);
  if (!persistedState) {
    return 'new';
  }

  const summary = getSessionSummary(persistedState);
  const resumable = isSessionResumable(persistedState);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                  Existing Session Found                        ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Status:      ${summary.status.toUpperCase()}`);
  console.log(`  Started:     ${new Date(summary.startedAt).toLocaleString()}`);
  console.log(`  Progress:    ${summary.tasksCompleted}/${summary.totalTasks} tasks complete`);
  console.log(`  Iteration:   ${summary.currentIteration}${summary.maxIterations > 0 ? `/${summary.maxIterations}` : ''}`);
  console.log(`  Agent:       ${summary.agentPlugin}`);
  console.log(`  Tracker:     ${summary.trackerPlugin}`);
  if (summary.epicId) {
    console.log(`  Epic:        ${summary.epicId}`);
  }
  console.log('');

  // Check for lock conflict
  const sessionCheck = await checkSession(cwd);
  if (sessionCheck.isLocked && !sessionCheck.isStale) {
    console.log('  WARNING: Session is currently locked by another process.');
    console.log(`           PID: ${sessionCheck.lock?.pid}`);
    console.log('');
    console.log('Cannot start while another instance is running.');
    return 'abort';
  }

  if (resumable) {
    console.log('This session can be resumed.');
    console.log('');
    console.log('  To resume:  ralph-tui resume');
    console.log('  To start fresh: ralph-tui run --force');
    console.log('');
    console.log('Starting fresh session...');
    console.log('(Use --resume flag or "ralph-tui resume" command to continue)');
    return 'new';
  } else {
    console.log('This session has completed and cannot be resumed.');
    console.log('Starting fresh session...');
    return 'new';
  }
}

/**
 * Show epic selection TUI and wait for user to select an epic.
 * Returns the selected epic, or undefined if user quits.
 */
async function showEpicSelectionTui(
  tracker: TrackerPlugin
): Promise<TrackerTask | undefined> {
  return new Promise(async (resolve) => {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
    });

    const root = createRoot(renderer);

    const cleanup = () => {
      renderer.destroy();
    };

    const handleEpicSelected = (epic: TrackerTask) => {
      cleanup();
      resolve(epic);
    };

    const handleQuit = () => {
      cleanup();
      resolve(undefined);
    };

    // Handle Ctrl+C during epic selection
    const handleSigint = () => {
      cleanup();
      resolve(undefined);
    };

    process.on('SIGINT', handleSigint);

    root.render(
      <EpicSelectionApp
        tracker={tracker}
        onEpicSelected={handleEpicSelected}
        onQuit={handleQuit}
      />
    );
  });
}

/**
 * Props for the RunAppWrapper component
 */
interface RunAppWrapperProps {
  engine?: ExecutionEngine;
  interruptHandler: InterruptHandler;
  onQuit: () => Promise<void>;
  onInterruptConfirmed: () => Promise<void>;
  /** Initial tasks to display before engine starts */
  initialTasks?: TrackerTask[];
  /** Callback when user wants to start the engine (Enter/s in ready state) */
  onStart?: () => Promise<void>;
  /** Current stored configuration (for settings view) */
  storedConfig?: StoredConfig;
  /** Working directory for saving settings */
  cwd?: string;
  /** Tracker type for epic loader mode */
  trackerType?: string;
  /** Agent plugin name (from resolved config, includes CLI override) */
  agentPlugin?: string;
  /** Custom command path for the agent (if configured) */
  agentCommand?: string;
  /** Current epic ID for highlighting */
  currentEpicId?: string;
  /** Initial subagent panel visibility (from persisted session) */
  initialSubagentPanelVisible?: boolean;
  /** Callback to update persisted session state */
  onUpdatePersistedState?: (updater: (state: PersistedSessionState) => PersistedSessionState) => void;
  /** Current model being used (provider/model format, e.g., "anthropic/claude-3-5-sonnet") */
  currentModel?: string;
  /** Sandbox configuration for display in header */
  sandboxConfig?: SandboxConfig;
  /** Resolved sandbox mode (when mode is 'auto', this shows what it resolved to) */
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>;
  /** Whether to show the epic loader immediately on startup (for json tracker without PRD path) */
  initialShowEpicLoader?: boolean;
  /** Whether parallel execution mode is active */
  isParallelMode?: boolean;
  /** Parallel workers display state */
  parallelWorkers?: WorkerDisplayState[];
  /** Worker output lines keyed by worker ID */
  parallelWorkerOutputs?: Map<string, string[]>;
  /** Merge queue state */
  parallelMergeQueue?: MergeOperation[];
  /** Current parallel group index */
  parallelCurrentGroup?: number;
  /** Total number of parallel groups */
  parallelTotalGroups?: number;
  /** Session backup tag for rollback */
  parallelSessionBackupTag?: string;
  /** Active file conflicts during merge */
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
  /** Callback when user requests conflict resolution retry */
  onConflictRetry?: () => Promise<void>;
  /** Callback when user requests to skip a failed merge */
  onConflictSkip?: () => void;
}

/**
 * Wrapper component that manages interrupt dialog state and passes it to RunApp.
 * This is needed because we need React state management for the dialog visibility.
 */
function RunAppWrapper({
  engine,
  interruptHandler,
  onQuit,
  onInterruptConfirmed,
  initialTasks,
  onStart,
  storedConfig: initialStoredConfig,
  cwd = process.cwd(),
  trackerType,
  agentPlugin,
  agentCommand,
  currentEpicId: initialEpicId,
  initialSubagentPanelVisible = false,
  onUpdatePersistedState,
  currentModel,
  sandboxConfig,
  resolvedSandboxMode,
  initialShowEpicLoader = false,
  isParallelMode = false,
  parallelWorkers,
  parallelWorkerOutputs,
  parallelMergeQueue,
  parallelCurrentGroup,
  parallelTotalGroups,
  parallelSessionBackupTag,
  parallelConflicts,
  parallelConflictResolutions,
  parallelConflictTaskId,
  parallelConflictTaskTitle,
  parallelAiResolving,
  parallelCurrentlyResolvingFile,
  parallelShowConflicts,
  parallelTaskIdToWorkerId,
  parallelCompletedLocallyTaskIds,
  parallelAutoCommitSkippedTaskIds,
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
}: RunAppWrapperProps) {
  const [showInterruptDialog, setShowInterruptDialog] = useState(false);
  const [storedConfig, setStoredConfig] = useState<StoredConfig | undefined>(initialStoredConfig);
  const [tasks, setTasks] = useState<TrackerTask[]>(initialTasks ?? []);
  const [currentEpicId, setCurrentEpicId] = useState<string | undefined>(initialEpicId);

  // Local git info (computed once on mount, static for the session)
  const localGitInfo = useMemo(() => getGitInfo(cwd), [cwd]);

  // Remote instance management
  const [instanceManager] = useState(() => new InstanceManager());
  const [instanceTabs, setInstanceTabs] = useState<InstanceTab[]>([]);
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [connectionToast, setConnectionToast] = useState<ConnectionToastMessage | null>(null);

  // Initialize instance manager on mount
  useEffect(() => {
    instanceManager.onStateChange((tabs, selectedIndex) => {
      setInstanceTabs(tabs);
      setSelectedTabIndex(selectedIndex);
    });
    instanceManager.onToast((toast) => {
      setConnectionToast(toast as ConnectionToastMessage);
      // Auto-clear toast after 3 seconds
      setTimeout(() => setConnectionToast(null), 3000);
    });
    instanceManager.initialize().then(() => {
      setInstanceTabs(instanceManager.getTabs());
      setSelectedTabIndex(instanceManager.getSelectedIndex());
    });

    // Cleanup on unmount
    return () => {
      instanceManager.disconnectAll();
    };
  }, []);

  // Handle tab selection
  const handleSelectTab = async (index: number): Promise<void> => {
    await instanceManager.selectTab(index);
  };

  // Get available plugins from registries
  const agentRegistry = getAgentRegistry();
  const trackerRegistry = getTrackerRegistry();
  const availableAgents = agentRegistry.getRegisteredPlugins();
  const availableTrackers = trackerRegistry.getRegisteredPlugins();
  const configuredAgentNames = useMemo(
    () =>
      Array.from(
        new Set(
          (storedConfig?.agents ?? [])
            .map((agent) => agent.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0),
        ),
      ),
    [storedConfig?.agents],
  );
  const availableAgentNames = useMemo(
    () =>
      Array.from(
        new Set(
          [...availableAgents.map((agent) => agent.id), ...configuredAgentNames],
        ),
      ),
    [availableAgents, configuredAgentNames],
  );

  // Handle settings save
  const handleSaveSettings = async (newConfig: StoredConfig): Promise<void> => {
    await saveProjectConfig(newConfig, cwd);
    setStoredConfig(newConfig);
    propagateSettingsToEngine(engine, newConfig);
  };

  // Handle loading available epics (engine absent in parallel mode)
  const handleLoadEpics = async (): Promise<TrackerTask[]> => {
    if (!engine) throw new Error('Epic loading not available in parallel mode');
    const tracker = engine.getTracker();
    if (!tracker) {
      throw new Error('Tracker not available');
    }
    return tracker.getEpics();
  };

  // Handle epic switch (engine absent in parallel mode)
  const handleEpicSwitch = async (epic: TrackerTask): Promise<void> => {
    if (!engine) throw new Error('Epic switching not available in parallel mode');
    const tracker = engine.getTracker();
    if (!tracker) {
      throw new Error('Tracker not available');
    }

    // Stop engine if running
    const state = engine.getState();
    if (state.status === 'running') {
      engine.stop();
    }

    // Set new epic ID
    if (tracker.setEpicId) {
      tracker.setEpicId(epic.id);
    }

    // Update current epic ID
    setCurrentEpicId(epic.id);

    // Refresh tasks from tracker (including completed for display)
    const newTasks = await tracker.getTasks({ status: ['open', 'in_progress', 'completed'] });
    setTasks(newTasks);

    // Trigger task refresh in engine
    engine.refreshTasks();
  };

  // Handle file path switch (for json tracker — engine absent in parallel mode)
  const handleFilePathSwitch = async (path: string): Promise<boolean> => {
    if (!engine) return false;
    const tracker = engine.getTracker();
    if (!tracker) {
      return false;
    }

    // Check if tracker has setFilePath method (JsonTrackerPlugin)
    const jsonTracker = tracker as { setFilePath?: (path: string) => Promise<boolean> };
    if (jsonTracker.setFilePath) {
      const success = await jsonTracker.setFilePath(path);
      if (success) {
        // Refresh tasks from tracker (including completed for display)
        const newTasks = await tracker.getTasks({ status: ['open', 'in_progress', 'completed'] });
        setTasks(newTasks);
        engine.refreshTasks();
      }
      return success;
    }

    return false;
  };

  // Handle subagent panel visibility change - persists to session state
  const handleSubagentPanelVisibilityChange = (visible: boolean): void => {
    if (onUpdatePersistedState) {
      onUpdatePersistedState((state) => setSubagentPanelVisible(state, visible));
    }
  };

  // These callbacks are passed to the interrupt handler
  const handleShowDialog = () => setShowInterruptDialog(true);
  const handleHideDialog = () => setShowInterruptDialog(false);
  const handleCancelled = () => setShowInterruptDialog(false);

  // Set up the interrupt handler callbacks
  // Note: We use a ref-like pattern here since these need to be stable references
  // that the handler can call, but the handler was created before this component mounted
  (interruptHandler as { _showDialog?: () => void })._showDialog = handleShowDialog;
  (interruptHandler as { _hideDialog?: () => void })._hideDialog = handleHideDialog;
  (interruptHandler as { _cancelled?: () => void })._cancelled = handleCancelled;

  return (
    <RunApp
      engine={engine}
      cwd={cwd}
      onQuit={onQuit}
      showInterruptDialog={showInterruptDialog}
      onInterruptConfirm={async () => {
        setShowInterruptDialog(false);
        await onInterruptConfirmed();
      }}
      onInterruptCancel={() => {
        setShowInterruptDialog(false);
        interruptHandler.reset();
      }}
      initialTasks={tasks}
      onStart={onStart}
      storedConfig={storedConfig}
      availableAgents={availableAgentNames}
      availableTrackers={availableTrackers}
      onSaveSettings={handleSaveSettings}
      onLoadEpics={handleLoadEpics}
      onEpicSwitch={handleEpicSwitch}
      onFilePathSwitch={handleFilePathSwitch}
      trackerType={trackerType}
      agentPlugin={agentPlugin}
      agentCommand={agentCommand}
      currentEpicId={currentEpicId}
      initialSubagentPanelVisible={initialSubagentPanelVisible}
      onSubagentPanelVisibilityChange={handleSubagentPanelVisibilityChange}
      currentModel={currentModel}
      sandboxConfig={sandboxConfig}
      resolvedSandboxMode={resolvedSandboxMode}
      instanceTabs={instanceTabs}
      selectedTabIndex={selectedTabIndex}
      onSelectTab={handleSelectTab}
      connectionToast={connectionToast}
      instanceManager={instanceManager}
      initialShowEpicLoader={initialShowEpicLoader}
      localGitInfo={localGitInfo}
      isParallelMode={isParallelMode}
      parallelWorkers={parallelWorkers}
      parallelWorkerOutputs={parallelWorkerOutputs}
      parallelMergeQueue={parallelMergeQueue}
      parallelCurrentGroup={parallelCurrentGroup}
      parallelTotalGroups={parallelTotalGroups}
      parallelSessionBackupTag={parallelSessionBackupTag}
      parallelConflicts={parallelConflicts}
      parallelConflictResolutions={parallelConflictResolutions}
      parallelConflictTaskId={parallelConflictTaskId}
      parallelConflictTaskTitle={parallelConflictTaskTitle}
      parallelAiResolving={parallelAiResolving}
      parallelCurrentlyResolvingFile={parallelCurrentlyResolvingFile}
      parallelShowConflicts={parallelShowConflicts}
      parallelTaskIdToWorkerId={parallelTaskIdToWorkerId}
      parallelCompletedLocallyTaskIds={parallelCompletedLocallyTaskIds}
      parallelAutoCommitSkippedTaskIds={parallelAutoCommitSkippedTaskIds}
      parallelMergedTaskIds={parallelMergedTaskIds}
      parallelFailureMessage={parallelFailureMessage}
      activeWorkerCount={activeWorkerCount}
      totalWorkerCount={totalWorkerCount}
      onParallelPause={onParallelPause}
      onParallelResume={onParallelResume}
      onParallelKill={onParallelKill}
      onParallelStart={onParallelStart}
      onConflictRetry={onConflictRetry}
      onConflictSkip={onConflictSkip}
    />
  );
}

/**
 * Run the execution engine with TUI
 *
 * IMPORTANT: The TUI now launches in a "ready" state by default (interactive mode).
 * The engine does NOT auto-start. Users must press Enter or 's' to start execution.
 * This allows users to review available tasks before committing to a run.
 *
 * The TUI stays open until the user explicitly quits (q key or Ctrl+C).
 * The engine may stop for various reasons (all tasks done, max iterations, no tasks, error)
 * but the TUI remains visible so the user can review results before exiting.
 */
/**
 * Notification options for run command
 */
interface NotificationRunOptions {
  /** Whether notifications are enabled (resolved from config + CLI) */
  notificationsEnabled: boolean;
  /** Sound mode for notifications */
  soundMode: NotificationSoundMode;
}

async function runWithTui(
  engine: ExecutionEngine,
  persistedState: PersistedSessionState,
  config: RalphConfig,
  initialTasks: TrackerTask[],
  storedConfig?: StoredConfig,
  notificationOptions?: NotificationRunOptions
): Promise<PersistedSessionState> {
  let currentState = persistedState;
  // Track when engine starts for duration calculation
  let engineStartTime: Date | null = null;
  // Track last error for error notification
  let lastError: string | null = null;
  let showDialogCallback: (() => void) | null = null;
  let hideDialogCallback: (() => void) | null = null;
  let cancelledCallback: (() => void) | null = null;
  let resolveQuitPromise: (() => void) | null = null;
  let engineStarted = false;
  let executionPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle this ourselves
  });

  const root = createRoot(renderer);

  // Subscribe to engine events to save state and track active tasks
  engine.on((event) => {
    if (event.type === 'iteration:completed') {
      currentState = updateSessionAfterIteration(currentState, event.result);
      // If task was completed, remove it from active tasks
      if (event.result.taskCompleted) {
        currentState = removeActiveTask(currentState, event.result.task.id);
      }
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'task:activated') {
      // Track task as active when set to in_progress
      currentState = addActiveTask(currentState, event.task.id);
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'task:completed') {
      // Task completed - remove from active tasks
      currentState = removeActiveTask(currentState, event.task.id);
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'engine:paused') {
      // Save paused state to session file
      currentState = pauseSession(currentState);
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'engine:resumed') {
      // Clear paused state when resuming
      currentState = { ...currentState, status: 'running', isPaused: false, pausedAt: undefined };
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'engine:started') {
      // Track when engine started for duration calculation
      engineStartTime = new Date();
    } else if (event.type === 'engine:warning') {
      // Log configuration warnings to stderr (visible after TUI exits)
      console.error(`\n⚠️  ${event.message}\n`);
    } else if (event.type === 'all:complete') {
      // Send completion notification if enabled
      if (notificationOptions?.notificationsEnabled && engineStartTime) {
        const durationMs = Date.now() - engineStartTime.getTime();
        sendCompletionNotification({
          durationMs,
          taskCount: event.totalCompleted,
          sound: notificationOptions.soundMode,
        });
      }
    } else if (event.type === 'engine:stopped' && event.reason === 'max_iterations') {
      // Send max iterations notification if enabled
      if (notificationOptions?.notificationsEnabled && engineStartTime) {
        const durationMs = Date.now() - engineStartTime.getTime();
        const engineState = engine.getState();
        const tasksRemaining = engineState.totalTasks - event.tasksCompleted;
        sendMaxIterationsNotification({
          iterationsRun: event.totalIterations,
          tasksCompleted: event.tasksCompleted,
          tasksRemaining,
          durationMs,
          sound: notificationOptions.soundMode,
        });
      }
    } else if (event.type === 'iteration:failed' && event.action === 'abort') {
      // Track the error for notification when engine stops
      lastError = event.error;
    } else if (event.type === 'engine:stopped' && event.reason === 'error') {
      // Send error notification if enabled
      if (notificationOptions?.notificationsEnabled && engineStartTime) {
        const durationMs = Date.now() - engineStartTime.getTime();
        sendErrorNotification({
          errorSummary: lastError ?? 'Unknown error',
          tasksCompleted: event.tasksCompleted,
          durationMs,
          sound: notificationOptions.soundMode,
        });
      }
    }
  });

  // Create cleanup function
  const cleanup = async (): Promise<void> => {
    interruptHandler.dispose();
    // Note: don't dispose engine here - it may already be stopped
    renderer.destroy();
  };

  // Graceful shutdown: reset active tasks, save state, clean up, and resolve the quit promise
  // This is called when the user explicitly quits (q key or Ctrl+C confirmation)
  const gracefulShutdown = async (): Promise<void> => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
      const status = engine.getStatus();
      if (status === 'running' || status === 'pausing' || status === 'paused' || status === 'stopping') {
        try {
          await engine.stop();
        } catch {
          // Keep shutdown resilient even if stop() fails.
        }
      }

      const exec = executionPromise;
      if (exec) {
        try {
          await exec;
        } catch {
          // Execution errors are already surfaced through engine events.
        }
      }

      try {
        // Reset any active (in_progress) tasks back to open.
        // This prevents tasks from being stuck in_progress after shutdown.
        const activeTasks = getActiveTasks(currentState);
        if (activeTasks.length > 0) {
          const resetCount = await engine.resetTasksToOpen(activeTasks);
          if (resetCount > 0) {
            // Clear active tasks from state now that they've been reset.
            currentState = clearActiveTasks(currentState);
          }
        }
      } catch {
        // Continue shutdown even if task reset fails.
      }

      try {
        // Save current state (may be completed, interrupted, etc.)
        await savePersistedSession(currentState);
      } catch {
        // Continue shutdown even if state persistence fails.
      }

      try {
        await cleanup();
      } catch {
        // Ensure quit promise still resolves when cleanup fails.
      }

      // Resolve the quit promise to let the main function continue
      resolveQuitPromise?.();
    })();

    await shutdownPromise;
  };

  // Force quit: immediate exit
  const forceQuit = (): void => {
    // Synchronous cleanup - just exit immediately
    process.exit(1);
  };

  // Create interrupt handler with callbacks
  const interruptHandler = createInterruptHandler({
    doublePressWindowMs: 1000,
    onConfirmed: gracefulShutdown,
    onCancelled: () => {
      cancelledCallback?.();
    },
    onShowDialog: () => {
      showDialogCallback?.();
    },
    onHideDialog: () => {
      hideDialogCallback?.();
    },
    onForceQuit: forceQuit,
  });

  // Handle SIGTERM separately (always graceful)
  process.on('SIGTERM', gracefulShutdown);

  // onStart callback - called when user presses Enter or 's' to start execution
  const handleStart = async (): Promise<void> => {
    if (engineStarted) return; // Prevent double-start
    engineStarted = true;
    // Start the engine (this runs the loop in the background)
    // The TUI will show running status via engine events
    const runPromise = engine.start();
    executionPromise = runPromise;
    try {
      await runPromise;
    } finally {
      if (executionPromise === runPromise) {
        executionPromise = null;
      }
    }
  };

  // Handler to update persisted state and save it
  // Used by subagent panel visibility toggle to persist state changes
  const handleUpdatePersistedState = (
    updater: (state: PersistedSessionState) => PersistedSessionState
  ): void => {
    currentState = updater(currentState);
    savePersistedSession(currentState).catch(() => {
      // Log but don't fail on save errors
    });
  };

  // Detect actual sandbox mode at startup (resolve 'auto' to concrete mode)
  const resolvedSandboxMode = config.sandbox?.enabled
    ? await detectSandboxMode()
    : undefined;

  // Render the TUI with wrapper that manages dialog state
  // Pass initialTasks for display in "ready" state and onStart callback
  root.render(
    <RunAppWrapper
      engine={engine}
      interruptHandler={interruptHandler}
      onQuit={gracefulShutdown}
      onInterruptConfirmed={gracefulShutdown}
      initialTasks={initialTasks}
      onStart={handleStart}
      storedConfig={storedConfig}
      cwd={config.cwd}
      trackerType={config.tracker.plugin}
      agentPlugin={config.agent.plugin}
      agentCommand={config.agent.command}
      currentEpicId={config.epicId}
      initialSubagentPanelVisible={persistedState.subagentPanelVisible ?? false}
      onUpdatePersistedState={handleUpdatePersistedState}
      currentModel={config.model}
      sandboxConfig={config.sandbox}
      resolvedSandboxMode={resolvedSandboxMode}
      initialShowEpicLoader={config.tracker.plugin === 'json' && !config.prdPath}
    />
  );

  // Extract callback setters from the wrapper component
  // The wrapper will set these when it mounts
  const checkCallbacks = setInterval(() => {
    const handler = interruptHandler as {
      _showDialog?: () => void;
      _hideDialog?: () => void;
      _cancelled?: () => void;
    };
    if (handler._showDialog) {
      showDialogCallback = handler._showDialog;
    }
    if (handler._hideDialog) {
      hideDialogCallback = handler._hideDialog;
    }
    if (handler._cancelled) {
      cancelledCallback = handler._cancelled;
    }
  }, 10);

  // NOTE: We do NOT auto-start the engine here anymore.
  // The engine starts when user presses Enter or 's' (via handleStart callback).
  // This allows users to review tasks before starting.

  // Wait for user to explicitly quit (q key or Ctrl+C)
  // This promise resolves when gracefulShutdown is called
  await new Promise<void>((resolve) => {
    resolveQuitPromise = resolve;
  });

  clearInterval(checkCallbacks);
  process.removeListener('SIGTERM', gracefulShutdown);

  return currentState;
}

/**
 * Run the parallel executor with TUI visualization.
 *
 * Similar to runWithTui but tailored for parallel execution:
 * - No single ExecutionEngine — the ParallelExecutor manages multiple workers
 * - Subscribes to ParallelExecutor events and translates them to React state
 * - Passes parallel-specific props (workers, merge queue, conflicts) to RunApp
 * - Starts execution automatically (no "ready" state — parallel is always auto-start)
 */
async function runParallelWithTui(
  parallelExecutor: ParallelExecutor,
  persistedState: PersistedSessionState,
  config: RalphConfig,
  initialTasks: TrackerTask[],
  storedConfig?: StoredConfig,
): Promise<PersistedSessionState> {
  let currentState = persistedState;
  let resolveQuitPromise: (() => void) | null = null;
  let showDialogCallback: (() => void) | null = null;
  let hideDialogCallback: (() => void) | null = null;
  let cancelledCallback: (() => void) | null = null;

  // Shared mutable state object for parallel props.
  // Using a single object ref avoids closure staleness: the React component holds a reference
  // to this object and reads current values on each render, even if renders are delayed by
  // synchronous operations (like execSync in worktree/merge commands) blocking the event loop.
  const parallelState = {
    workers: [] as WorkerDisplayState[],
    workerOutputs: new Map<string, string[]>(),
    mergeQueue: [] as MergeOperation[],
    currentGroup: 0,
    totalGroups: 0,
    conflicts: [] as FileConflict[],
    conflictResolutions: [] as ConflictResolutionResult[],
    conflictTaskId: '',
    conflictTaskTitle: '',
    aiResolving: false,
    /** The file currently being resolved by AI */
    currentlyResolvingFile: '' as string,
    /** Whether to show the conflict panel (set true at Phase 2 start, false when resolved) */
    showConflicts: false,
    /** Maps task IDs to their assigned worker IDs for output routing */
    taskIdToWorkerId: new Map<string, string>(),
    failureMessage: null as string | null,
    /** Task IDs that completed locally but merge failed (shows ⚠ in TUI) */
    completedLocallyTaskIds: new Set<string>(),
    /** Task IDs where auto-commit was skipped (e.g., files were gitignored) */
    autoCommitSkippedTaskIds: new Set<string>(),
    /** Task IDs that have been successfully merged (shows ✓ done in TUI) */
    mergedTaskIds: new Set<string>(),
    /** Session branch name (e.g., "ralph-session/a4d1aae7") */
    sessionBranch: null as string | null,
    /** Original branch before session branch was created */
    originalBranch: null as string | null,
  };

  // Render trigger — forces React to re-render with updated parallel state.
  // When null, events are queued implicitly in the shared state object and picked up
  // on the next render (no events are lost even if the trigger isn't set yet).
  let triggerRerender: (() => void) | null = null;
  let executionPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const resetParallelStateForRestart = (): void => {
    parallelState.failureMessage = null;
    parallelState.workers = [];
    parallelState.workerOutputs = new Map();
    parallelState.mergeQueue = [];
    parallelState.currentGroup = 0;
    parallelState.totalGroups = 0;
    parallelState.conflicts = [];
    parallelState.conflictResolutions = [];
    parallelState.conflictTaskId = '';
    parallelState.conflictTaskTitle = '';
    parallelState.aiResolving = false;
    parallelState.currentlyResolvingFile = '';
    parallelState.showConflicts = false;
    parallelState.taskIdToWorkerId = new Map();
    parallelState.completedLocallyTaskIds = new Set();
    parallelState.autoCommitSkippedTaskIds = new Set();
    parallelState.mergedTaskIds = new Set();
    parallelState.sessionBranch = null;
    parallelState.originalBranch = null;
  };

  const startParallelExecution = (): void => {
    const runPromise = parallelExecutor.execute().then(() => {
      // Execution finished — TUI stays open for user review
      triggerRerender?.();
    }).catch(() => {
      // Error already emitted as parallel:failed event, but keep this as a fallback
      // for engines that reject without emitting the event.
      currentState = applyParallelFailureState(
        currentState,
        parallelState,
        'Parallel execution failed before startup',
        (state) => {
          savePersistedSession(state).catch(() => {});
        }
      );
      triggerRerender?.();
    });

    executionPromise = runPromise;
    void runPromise.finally(() => {
      if (executionPromise === runPromise) {
        executionPromise = null;
      }
    });
  };

  const handleShutdownError = (context: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    // Surface a best-effort message in the parallel UI instead of throwing.
    parallelState.failureMessage = parallelState.failureMessage ?? `${context}: ${message}`;
    triggerRerender?.();
  };

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  const root = createRoot(renderer);

  // Subscribe to parallel events and translate to TUI state.
  // All mutations target the shared parallelState object so values are visible
  // to the React component on its next render, regardless of timing.
  parallelExecutor.on((event: ParallelEvent) => {
    switch (event.type) {
      case 'parallel:started':
        parallelState.failureMessage = null;
        parallelState.totalGroups = event.totalGroups;
        break;

      case 'parallel:session-branch-created':
        // Track session branch info in local state and persisted session
        parallelState.sessionBranch = event.sessionBranch;
        parallelState.originalBranch = event.originalBranch;
        // Note: Session state is managed by the caller; branch info will be
        // retrieved from parallelExecutor after completion
        break;

      case 'parallel:group-started':
        parallelState.currentGroup = event.groupIndex;
        break;

      case 'worker:created': {
        // Worker created but not yet started — refresh from executor
        parallelState.workers = parallelExecutor.getWorkerStates();
        // Record task→worker mapping for output routing in the TUI
        // Create new Map so React's memoization detects the change
        const newTaskMap = new Map(parallelState.taskIdToWorkerId);
        newTaskMap.set(event.task.id, event.workerId);
        parallelState.taskIdToWorkerId = newTaskMap;
        break;
      }

      case 'worker:started':
        // Refresh workers from executor state
        parallelState.workers = parallelExecutor.getWorkerStates();
        // Mark task as active in persisted session state
        currentState = addActiveTask(currentState, event.task.id);
        savePersistedSession(currentState).catch(() => {});
        break;

      case 'worker:progress':
        // Refresh workers from executor state
        parallelState.workers = parallelExecutor.getWorkerStates();
        break;

      case 'worker:output':
        // Append output to the worker's output buffer
        // Replace the Map instance so downstream memos observe the change
        if (event.stream === 'stdout' && event.data.trim()) {
          const existing = parallelState.workerOutputs.get(event.workerId) ?? [];
          // Keep last 500 lines per worker to prevent memory bloat
          const lines = [...existing, ...event.data.split('\n').filter((l: string) => l.trim())];
          // Create new Map from existing entries, then set the updated lines
          const newMap = new Map(parallelState.workerOutputs);
          newMap.set(event.workerId, lines.slice(-500));
          parallelState.workerOutputs = newMap;
        }
        break;

      case 'worker:completed':
        // Refresh workers from executor state
        parallelState.workers = parallelExecutor.getWorkerStates();
        // Remove task from active list in persisted session state
        currentState = removeActiveTask(currentState, event.result.task.id);
        savePersistedSession(currentState).catch(() => {});
        parallelState.completedLocallyTaskIds = updateCompletedLocallyTaskIds(
          parallelState.completedLocallyTaskIds,
          event.result.task.id,
          event.result.taskCompleted,
          event.result.commitCount
        );
        break;

      case 'worker:failed':
        // Refresh workers from executor state
        parallelState.workers = parallelExecutor.getWorkerStates();
        // Remove task from active list in persisted session state
        currentState = removeActiveTask(currentState, event.task.id);
        savePersistedSession(currentState).catch(() => {});
        break;

      case 'merge:queued':
      case 'merge:started':
        // Refresh merge queue from executor state
        parallelState.mergeQueue = [...parallelExecutor.getState().mergeQueue];
        break;

      case 'merge:completed': {
        // Refresh merge queue from executor state
        parallelState.mergeQueue = [...parallelExecutor.getState().mergeQueue];
        // Task successfully merged — remove from completedLocally set (it's now fully done)
        // Create new Set so React detects the change
        const newSet = new Set(parallelState.completedLocallyTaskIds);
        newSet.delete(event.taskId);
        parallelState.completedLocallyTaskIds = newSet;
        // Add to merged set so TUI shows ✓ done even if worker state was cleared
        parallelState.mergedTaskIds = new Set([
          ...parallelState.mergedTaskIds,
          event.taskId,
        ]);
        break;
      }

      case 'merge:failed':
      case 'merge:rolled-back':
        // Refresh merge queue from executor state
        parallelState.mergeQueue = [...parallelExecutor.getState().mergeQueue];
        // Note: completedLocallyTaskIds already has this task if worker completed it,
        // so it will show ⚠ icon (completed locally but merge failed)
        break;

      case 'conflict:detected':
        parallelState.conflicts = event.conflicts;
        parallelState.conflictTaskId = event.taskId;
        // Task title is not on the event — look up from initial tasks
        parallelState.conflictTaskTitle = initialTasks.find((t) => t.id === event.taskId)?.title ?? event.taskId;
        // Clear prior resolution state so UI reflects only the new conflict
        parallelState.conflictResolutions = [];
        parallelState.aiResolving = false;
        break;

      case 'conflict:ai-resolving':
        parallelState.aiResolving = true;
        parallelState.currentlyResolvingFile = event.filePath;
        // Show the conflict panel now that Phase 2 (resolution) has started
        parallelState.showConflicts = true;
        break;

      case 'conflict:ai-resolved':
        parallelState.aiResolving = false;
        parallelState.currentlyResolvingFile = '';
        parallelState.conflictResolutions = [...parallelState.conflictResolutions, event.result];
        break;

      case 'conflict:ai-failed':
        parallelState.aiResolving = false;
        parallelState.currentlyResolvingFile = '';
        break;

      case 'conflict:resolved': {
        parallelState.conflicts = [];
        parallelState.conflictResolutions = event.results;
        parallelState.conflictTaskId = '';
        parallelState.conflictTaskTitle = '';
        parallelState.aiResolving = false;
        parallelState.currentlyResolvingFile = '';
        // Hide the conflict panel now that resolution is complete
        parallelState.showConflicts = false;
        // Refresh merge queue to show updated status (conflicted -> completed)
        parallelState.mergeQueue = [...parallelExecutor.getState().mergeQueue];
        const taskTracking = applyConflictResolvedTaskTracking(
          parallelState.completedLocallyTaskIds,
          parallelState.mergedTaskIds,
          event.taskId,
          event.results.length
        );
        parallelState.completedLocallyTaskIds = taskTracking.completedLocallyTaskIds;
        parallelState.mergedTaskIds = taskTracking.mergedTaskIds;
        break;
      }

      case 'parallel:completed':
        currentState = applyParallelCompletionState(
          currentState,
          parallelExecutor.getState().status
        );
        savePersistedSession(currentState).catch(() => {});
        break;

      case 'parallel:failed':
        currentState = applyParallelFailureState(
          currentState,
          parallelState,
          event.error,
          (state) => {
            savePersistedSession(state).catch(() => {});
          }
        );
        break;
    }

    // Trigger React re-render (may be null if React hasn't committed yet —
    // that's OK because the shared state object will have the latest values
    // when React does render)
    triggerRerender?.();
  });

  // Subscribe to engine events forwarded from workers to catch auto-commit-skipped.
  // This provides early warning when files are gitignored and won't be committed.
  parallelExecutor.onEngineEvent((event) => {
    if (event.type === 'task:auto-commit-skipped') {
      // Create new Set so React detects the change
      parallelState.autoCommitSkippedTaskIds = new Set([
        ...parallelState.autoCommitSkippedTaskIds,
        event.task.id,
      ]);
      triggerRerender?.();
    }
  });

  // Cleanup function
  const cleanup = async (): Promise<void> => {
    interruptHandler.dispose();
    renderer.destroy();
  };

  // Graceful shutdown
  const gracefulShutdown = async (): Promise<void> => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = (async () => {
      // Wait for execute() to unwind so cleanup() runs (worktrees, branches, tags).
      const exec = executionPromise;
      if (exec) {
        try {
          await parallelExecutor.stop();
        } catch (error) {
          handleShutdownError('Failed to stop parallel executor', error);
        }

        try {
          await exec;
        } catch (error) {
          handleShutdownError('Parallel executor failed during shutdown', error);
        }
      }

      try {
        await savePersistedSession(currentState);
      } catch (error) {
        handleShutdownError('Failed to persist session during shutdown', error);
      }

      try {
        await cleanup();
      } catch (error) {
        handleShutdownError('Failed to cleanup TUI during shutdown', error);
      }

      resolveQuitPromise?.();
    })();

    await shutdownPromise;
  };

  // Force quit
  const forceQuit = (): void => {
    process.exit(1);
  };

  // Create interrupt handler
  const interruptHandler = createInterruptHandler({
    doublePressWindowMs: 1000,
    onConfirmed: gracefulShutdown,
    onCancelled: () => {
      cancelledCallback?.();
    },
    onShowDialog: () => {
      showDialogCallback?.();
    },
    onHideDialog: () => {
      hideDialogCallback?.();
    },
    onForceQuit: forceQuit,
  });

  process.on('SIGTERM', gracefulShutdown);

  // Detect actual sandbox mode at startup
  const resolvedSandboxMode = config.sandbox?.enabled
    ? await detectSandboxMode()
    : undefined;

  // Wrapper component that re-renders when parallel state changes.
  // Reads from the shared parallelState object on each render, so it always
  // sees the latest values even if some event-driven triggerRerender calls
  // were missed during synchronous blocking operations.
  function ParallelRunAppWrapper(): ReturnType<typeof RunAppWrapper> {
    // State trigger for re-renders from parallel events
    const [, setTick] = useState(0);

    // Register the re-render trigger + set up a polling interval as safety net.
    // The polling ensures the TUI stays updated even when execSync calls in
    // worktree-manager/merge-engine block the event loop and prevent event-driven
    // re-renders from firing promptly.
    useEffect(() => {
      triggerRerender = () => setTick((t) => t + 1);

      // Poll every 500ms to catch any state changes that were missed
      // while the event loop was blocked by synchronous git operations
      const pollInterval = setInterval(() => {
        setTick((t) => t + 1);
      }, 500);

      return () => {
        triggerRerender = null;
        clearInterval(pollInterval);
      };
    }, []);

    return (
      <RunAppWrapper
        interruptHandler={interruptHandler}
        onQuit={gracefulShutdown}
        onInterruptConfirmed={gracefulShutdown}
        initialTasks={initialTasks}
        storedConfig={storedConfig}
        cwd={config.cwd}
        trackerType={config.tracker.plugin}
        agentPlugin={config.agent.plugin}
        agentCommand={config.agent.command}
        currentEpicId={config.epicId}
        currentModel={config.model}
        sandboxConfig={config.sandbox}
        resolvedSandboxMode={resolvedSandboxMode}
        isParallelMode={true}
        parallelWorkers={parallelState.workers}
        parallelWorkerOutputs={parallelState.workerOutputs}
        parallelMergeQueue={parallelState.mergeQueue}
        parallelCurrentGroup={parallelState.currentGroup}
        parallelTotalGroups={parallelState.totalGroups}
        parallelConflicts={parallelState.conflicts}
        parallelConflictResolutions={parallelState.conflictResolutions}
        parallelConflictTaskId={parallelState.conflictTaskId}
        parallelConflictTaskTitle={parallelState.conflictTaskTitle}
        parallelAiResolving={parallelState.aiResolving}
        parallelCurrentlyResolvingFile={parallelState.currentlyResolvingFile}
        parallelShowConflicts={parallelState.showConflicts}
        parallelTaskIdToWorkerId={parallelState.taskIdToWorkerId}
        parallelCompletedLocallyTaskIds={parallelState.completedLocallyTaskIds}
        parallelAutoCommitSkippedTaskIds={parallelState.autoCommitSkippedTaskIds}
        parallelMergedTaskIds={parallelState.mergedTaskIds}
        parallelFailureMessage={parallelState.failureMessage ?? undefined}
        activeWorkerCount={parallelState.workers.filter((w) => w.status === 'running').length}
        totalWorkerCount={parallelState.workers.length}
        onParallelPause={() => parallelExecutor.pause()}
        onParallelResume={() => parallelExecutor.resume()}
        onParallelKill={async () => {
          const exec = executionPromise;
          if (exec) {
            try {
              await parallelExecutor.stop();
            } catch (error) {
              handleShutdownError('Failed to stop parallel executor', error);
            }

            try {
              await exec;
            } catch (error) {
              handleShutdownError('Parallel executor failed while stopping', error);
            }
          }
        }}
        onParallelStart={() => {
          if (executionPromise) {
            return;
          }
          // Reset executor state and re-run
          resetParallelStateForRestart();
          currentState = {
            ...currentState,
            status: 'running',
            isPaused: false,
            pausedAt: undefined,
            updatedAt: new Date().toISOString(),
          };
          savePersistedSession(currentState).catch(() => {});
          parallelExecutor.reset();
          startParallelExecution();
        }}
        onConflictRetry={async () => {
          // Re-attempt AI conflict resolution
          parallelState.aiResolving = true;
          triggerRerender?.();
          try {
            await parallelExecutor.retryConflictResolution();
            // State updates handled by conflict:resolved event
          } catch {
            // Retry failed - state updates handled by conflict:ai-failed event
          } finally {
            parallelState.aiResolving = false;
            triggerRerender?.();
          }
        }}
        onConflictSkip={() => {
          // Skip this failed merge and continue
          parallelExecutor.skipFailedConflict();
          // Clear conflict state
          clearConflictState(parallelState);
          triggerRerender?.();
        }}
      />
    );
  }

  // Render the parallel TUI
  root.render(<ParallelRunAppWrapper />);

  // Set up interrupt handler callbacks
  const checkCallbacks = setInterval(() => {
    const handler = interruptHandler as {
      _showDialog?: () => void;
      _hideDialog?: () => void;
      _cancelled?: () => void;
    };
    if (handler._showDialog) showDialogCallback = handler._showDialog;
    if (handler._hideDialog) hideDialogCallback = handler._hideDialog;
    if (handler._cancelled) cancelledCallback = handler._cancelled;
  }, 10);

  // Start parallel execution (non-blocking — runs in background while TUI renders).
  // Errors are reported via the parallel:failed event, which updates the shared state.
  // We must NOT use console.error here — it would corrupt the TUI output.
  startParallelExecution();

  // Wait for user to quit
  await new Promise<void>((resolve) => {
    resolveQuitPromise = resolve;
  });

  clearInterval(checkCallbacks);
  process.removeListener('SIGTERM', gracefulShutdown);

  return currentState;
}

/**
 * Run in headless mode (no TUI) with structured log output.
 * In headless mode, Ctrl+C immediately triggers graceful shutdown (no confirmation dialog).
 * Double Ctrl+C within 1 second forces immediate exit.
 *
 * Log output format: [timestamp] [level] [component] message
 * This is designed for CI/scripts that need machine-parseable output.
 */
interface HeadlessOptions {
  notificationOptions?: NotificationRunOptions;
  /** If true, keep process alive after engine completes (for remote listener) */
  listenMode?: boolean;
  /** Remote server instance to stop on shutdown */
  remoteServer?: RemoteServer | null;
}

async function runHeadless(
  engine: ExecutionEngine,
  persistedState: PersistedSessionState,
  config: RalphConfig,
  headlessOptions?: HeadlessOptions
): Promise<PersistedSessionState> {
  const notificationOptions = headlessOptions?.notificationOptions;
  const listenMode = headlessOptions?.listenMode ?? false;
  const remoteServer = headlessOptions?.remoteServer;
  let currentState = persistedState;
  let lastSigintTime = 0;
  const DOUBLE_PRESS_WINDOW_MS = 1000;
  // Track when engine starts for duration calculation
  let engineStartTime: Date | null = null;
  // Track last error for error notification
  let lastError: string | null = null;

  // Create structured logger for headless output
  const logger = createStructuredLogger();

  // Subscribe to events for structured log output and state persistence
  engine.on((event) => {
    switch (event.type) {
      case 'engine:started':
        logger.engineStarted(event.totalTasks);
        // Track when engine started for duration calculation
        engineStartTime = new Date();
        break;

      case 'engine:warning':
        logger.warn('engine', event.message);
        break;

      case 'iteration:started':
        // Progress update in required format
        logger.progress(
          event.iteration,
          config.maxIterations,
          event.task.id,
          event.task.title
        );
        break;

      case 'iteration:completed':
        // Log iteration completion
        logger.iterationComplete(
          event.result.iteration,
          event.result.task.id,
          event.result.taskCompleted,
          event.result.durationMs
        );

        // Log task completion if applicable
        if (event.result.taskCompleted) {
          logger.taskCompleted(event.result.task.id, event.result.iteration);
          // Remove from active tasks
          currentState = removeActiveTask(currentState, event.result.task.id);
        }

        // Save state after each iteration
        currentState = updateSessionAfterIteration(currentState, event.result);
        savePersistedSession(currentState).catch(() => {
          // Silently continue on save errors
        });
        break;

      case 'task:activated':
        // Track task as active when set to in_progress
        currentState = addActiveTask(currentState, event.task.id);
        savePersistedSession(currentState).catch(() => {
          // Silently continue on save errors
        });
        break;

      case 'iteration:failed':
        logger.iterationFailed(
          event.iteration,
          event.task.id,
          event.error,
          event.action
        );
        // Track error for notification if this will abort
        if (event.action === 'abort') {
          lastError = event.error;
        }
        break;

      case 'iteration:retrying':
        logger.iterationRetrying(
          event.iteration,
          event.task.id,
          event.retryAttempt,
          event.maxRetries,
          event.delayMs
        );
        break;

      case 'iteration:skipped':
        logger.iterationSkipped(event.iteration, event.task.id, event.reason);
        break;

      case 'agent:output':
        // Stream agent output with [AGENT] prefix
        if (event.stream === 'stdout') {
          logger.agentOutput(event.data);
        } else {
          logger.agentError(event.data);
        }
        break;

      case 'task:selected':
        logger.taskSelected(event.task.id, event.task.title, event.iteration);
        break;

      case 'engine:paused':
        logger.enginePaused(event.currentIteration);
        currentState = pauseSession(currentState);
        savePersistedSession(currentState).catch(() => {
          // Silently continue on save errors
        });
        break;

      case 'engine:resumed':
        logger.engineResumed(event.fromIteration);
        currentState = { ...currentState, status: 'running', isPaused: false, pausedAt: undefined };
        savePersistedSession(currentState).catch(() => {
          // Silently continue on save errors
        });
        break;

      case 'engine:stopped':
        logger.engineStopped(event.reason, event.totalIterations, event.tasksCompleted);
        // Send max iterations notification if enabled
        if (event.reason === 'max_iterations' && notificationOptions?.notificationsEnabled && engineStartTime) {
          const durationMs = Date.now() - engineStartTime.getTime();
          const engineState = engine.getState();
          const tasksRemaining = engineState.totalTasks - event.tasksCompleted;
          sendMaxIterationsNotification({
            iterationsRun: event.totalIterations,
            tasksCompleted: event.tasksCompleted,
            tasksRemaining,
            durationMs,
            sound: notificationOptions.soundMode,
          });
        }
        // Send error notification if enabled
        if (event.reason === 'error' && notificationOptions?.notificationsEnabled && engineStartTime) {
          const durationMs = Date.now() - engineStartTime.getTime();
          sendErrorNotification({
            errorSummary: lastError ?? 'Unknown error',
            tasksCompleted: event.tasksCompleted,
            durationMs,
            sound: notificationOptions.soundMode,
          });
        }
        break;

      case 'all:complete':
        logger.allComplete(event.totalCompleted, event.totalIterations);
        // Send completion notification if enabled
        if (notificationOptions?.notificationsEnabled && engineStartTime) {
          const durationMs = Date.now() - engineStartTime.getTime();
          sendCompletionNotification({
            durationMs,
            taskCount: event.totalCompleted,
            sound: notificationOptions.soundMode,
          });
        }
        break;

      case 'task:completed':
        // Already logged in iteration:completed handler
        // Remove from active tasks (redundant with iteration:completed but safe)
        currentState = removeActiveTask(currentState, event.task.id);
        savePersistedSession(currentState).catch(() => {
          // Silently continue on save errors
        });
        break;
    }
  });

  // Graceful shutdown handler
  const gracefulShutdown = async (): Promise<void> => {
    logger.info('system', 'Interrupted, stopping gracefully...');
    logger.info('system', '(Press Ctrl+C again within 1s to force quit)');

    // Reset any active (in_progress) tasks back to open
    const activeTasks = getActiveTasks(currentState);
    if (activeTasks.length > 0) {
      logger.info('system', `Resetting ${activeTasks.length} in_progress task(s) to open...`);
      const resetCount = await engine.resetTasksToOpen(activeTasks);
      if (resetCount > 0) {
        currentState = clearActiveTasks(currentState);
      }
    }

    // Save interrupted state
    currentState = { ...currentState, status: 'interrupted' };
    await savePersistedSession(currentState);

    // Stop remote server if running
    if (remoteServer) {
      await remoteServer.stop();
    }

    await engine.dispose();
    process.exit(0);
  };

  // Handle SIGINT with double-press detection
  const handleSigint = async (): Promise<void> => {
    const now = Date.now();
    const timeSinceLastSigint = now - lastSigintTime;
    lastSigintTime = now;

    // Check for double-press - force quit immediately
    if (timeSinceLastSigint < DOUBLE_PRESS_WINDOW_MS) {
      logger.warn('system', 'Force quit!');
      process.exit(1);
    }

    // Single press - graceful shutdown
    await gracefulShutdown();
  };

  // Handle SIGTERM (always graceful, no double-press)
  const handleSigterm = async (): Promise<void> => {
    logger.info('system', 'Received SIGTERM, stopping gracefully...');

    // Reset any active (in_progress) tasks back to open
    const activeTasks = getActiveTasks(currentState);
    if (activeTasks.length > 0) {
      logger.info('system', `Resetting ${activeTasks.length} in_progress task(s) to open...`);
      const resetCount = await engine.resetTasksToOpen(activeTasks);
      if (resetCount > 0) {
        currentState = clearActiveTasks(currentState);
      }
    }

    currentState = { ...currentState, status: 'interrupted' };
    await savePersistedSession(currentState);

    // Stop remote server if running
    if (remoteServer) {
      await remoteServer.stop();
    }

    await engine.dispose();
    process.exit(0);
  };

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  // Log session start
  logger.sessionCreated(
    currentState.sessionId,
    config.agent.plugin,
    config.tracker.plugin
  );

  // Start the engine
  await engine.start();

  // In listen mode, keep process alive for remote connections
  if (listenMode) {
    logger.info('system', 'Engine idle. Waiting for remote commands (Ctrl+C to stop)...');

    // Keep process alive until signal received
    await new Promise<void>((_resolve) => {
      // The existing SIGINT/SIGTERM handlers will call process.exit()
      // This promise just keeps the event loop alive indefinitely
    });
  }

  await engine.dispose();

  return currentState;
}

/**
 * Execute the run command
 */
export async function executeRunCommand(args: string[]): Promise<void> {
  // Check for help
  if (args.includes('--help') || args.includes('-h')) {
    printRunHelp();
    return;
  }

  // Parse arguments
  const options = parseRunArgs(args);
  const cwd = options.cwd ?? process.cwd();

  // Detect markdown PRD files and show helpful guidance
  if (options.prdPath && /\.(?:md|markdown)$/i.test(options.prdPath)) {
    console.error('');
    console.error('Error: Markdown PRD files cannot be used directly with --prd.');
    console.error('');
    console.error('The --prd flag expects a JSON file (prd.json format).');
    console.error('');
    console.error('To convert your markdown PRD, use one of these commands:');
    console.error('');
    console.error(`  ralph-tui convert --to json --input ${options.prdPath}`);
    console.error(`  ralph-tui convert --to beads --input ${options.prdPath}`);
    console.error('');
    console.error('The "json" format creates a prd.json file for the JSON tracker.');
    console.error('The "beads" format imports tasks directly into your .beads database.');
    console.error('');
    process.exit(1);
  }

  // Check if project config exists
  const configExists = await projectConfigExists(cwd);

  if (!configExists && !options.noSetup) {
    // No config found - offer to run setup
    console.log('');
    console.log('No .ralph-tui/config.toml configuration found in this project.');
    console.log('');

    // Run the setup wizard
    const result = await runSetupWizard({ cwd });

    if (!result.success) {
      if (result.cancelled) {
        console.log('Run "ralph-tui setup" to configure later,');
        console.log('or use "ralph-tui run --no-setup" to skip setup.');
        return;
      }
      console.error('Setup failed:', result.error);
      process.exit(1);
    }

    // Setup completed, continue with run
    console.log('');
    console.log('Setup complete! Starting Ralph...');
    console.log('');
  } else if (!configExists && options.noSetup) {
    console.log('No .ralph-tui/config.toml found. Using default configuration.');
  }

  // Check for config migrations (auto-upgrade on version changes)
  if (configExists) {
    const migrationResult = await checkAndMigrate(cwd, { quiet: false });
    if (migrationResult?.error) {
      console.warn(`Warning: Config migration failed: ${migrationResult.error}`);
    }
  }

  console.log('Initializing Ralph TUI...');

  // Initialize theme before any TUI components render
  // This must happen early to ensure colors are available when components load
  if (options.themePath) {
    try {
      await initializeTheme(options.themePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nTheme loading failed: ${message}`);
      process.exit(1);
    }
  }

  // Initialize plugins
  await initializePlugins();

  // Build configuration
  const config = await buildConfig(options);
  if (!config) {
    process.exit(1);
  }

  // Load stored config for settings view (used when TUI is running)
  const storedConfig = await loadStoredConfig(cwd);

  // Validate configuration
  const validation = await validateConfig(config);
  if (!validation.valid) {
    console.error('\nConfiguration errors:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Show warnings
  for (const warning of validation.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  // Show environment variable exclusion report upfront (using resolved agent config)
  const envReport = getEnvExclusionReport(
    process.env,
    config.agent.envPassthrough,
    config.agent.envExclude
  );
  const envLines = formatEnvExclusionReport(envReport);
  for (const line of envLines) {
    console.log(line);
  }

  // Block until Enter so user can read blocked vars before TUI clears screen.
  // Only block in interactive TUI mode (stdin is TTY and not headless).
  if (envReport.blocked.length > 0 && process.stdin.isTTY && !options.headless) {
    const { createInterface } = await import('node:readline');
    await new Promise<void>(resolve => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('  Press Enter to continue...', () => {
        rl.close();
        resolve();
      });
    });
  }
  console.log('');

  // Run preflight check if --verify flag is specified
  if (options.verify) {
    console.log('');
    console.log('Running agent preflight check...');

    const agentRegistry = getAgentRegistry();
    const agentInstance = await agentRegistry.getInstance(config.agent);

    const preflightResult = await agentInstance.preflight({ timeout: 30000 });

    if (preflightResult.success) {
      console.log('✓ Agent is ready');
      if (preflightResult.durationMs) {
        console.log(`  Response time: ${preflightResult.durationMs}ms`);
      }
      console.log('');
    } else {
      console.error('');
      console.error('❌ Agent preflight check failed');
      if (preflightResult.error) {
        console.error(`   ${preflightResult.error}`);
      }
      if (preflightResult.suggestion) {
        console.error('');
        console.error('Suggestions:');
        for (const line of preflightResult.suggestion.split('\n')) {
          console.error(`  ${line}`);
        }
      }
      console.error('');
      console.error('Run "ralph-tui doctor" for detailed diagnostics.');
      process.exit(1);
    }
  }

  // If using beads tracker without epic, show epic selection TUI
  const isBeadsTracker = config.tracker.plugin === 'beads' || config.tracker.plugin === 'beads-bv' || config.tracker.plugin === 'beads-rust';
  if (isBeadsTracker && !config.epicId && config.showTui) {
    console.log('No epic specified. Loading epic selection...');

    // Get tracker instance for epic selection
    const trackerRegistry = getTrackerRegistry();
    const tracker = await trackerRegistry.getInstance(config.tracker);

    // Show epic selection TUI
    const selectedEpic = await showEpicSelectionTui(tracker);

    if (!selectedEpic) {
      console.log('Epic selection cancelled.');
      process.exit(0);
    }

    // Update config with selected epic
    config.epicId = selectedEpic.id;
    config.tracker.options.epicId = selectedEpic.id;

    // If the tracker has a setEpicId method, call it
    if (tracker.setEpicId) {
      tracker.setEpicId(selectedEpic.id);
    }

    console.log(`Selected epic: ${selectedEpic.id} - ${selectedEpic.title}`);
    console.log('');
  }

  // Detect and recover stale sessions EARLY (before any prompts)
  // This fixes the issue where killing the TUI mid-task leaves activeTaskIds populated
  const staleRecovery = await detectAndRecoverStaleSession(config.cwd, checkLock);
  if (staleRecovery.wasStale) {
    console.log('');
    console.log('⚠️  Recovered stale session');
    if (staleRecovery.clearedTaskCount > 0) {
      console.log(`   Cleared ${staleRecovery.clearedTaskCount} stuck in-progress task(s)`);
    }
    console.log('   Session status set to "interrupted" (resumable)');
    console.log('');
  }

  // Check for existing persisted session file
  const sessionCheck = await checkSession(config.cwd);
  const hasPersistedSessionFile = await hasPersistedSession(config.cwd);

  // Handle existing persisted session prompt first (before lock acquisition)
  if (hasPersistedSessionFile && !options.force && !options.resume) {
    const choice = await promptResumeOrNew(config.cwd);
    if (choice === 'abort') {
      process.exit(1);
    }
    // Delete old session file if starting fresh
    if (choice === 'new') {
      await deletePersistedSession(config.cwd);
    }
  }

  // Generate session ID early for lock acquisition
  const { randomUUID } = await import('node:crypto');
  const newSessionId = randomUUID();

  // Acquire lock with proper error messages and stale lock handling
  const lockResult = await acquireLockWithPrompt(config.cwd, newSessionId, {
    force: options.force,
    nonInteractive: options.headless,
  });

  if (!lockResult.acquired) {
    console.error(`\nError: ${lockResult.error}`);
    if (lockResult.existingPid) {
      console.error('  Use --force to override.');
    }
    process.exit(1);
  }

  // Register cleanup handlers to release lock on exit/crash
  const cleanupLockHandlers = registerLockCleanupHandlers(config.cwd);

  // Handle resume or new session
  let session;
  if (options.resume && sessionCheck.hasSession) {
    console.log('Resuming previous session...');
    session = await resumeSession(config.cwd);
    if (!session) {
      console.error('Failed to resume session');
      await releaseLockNew(config.cwd);
      cleanupLockHandlers();
      process.exit(1);
    }
  } else {
    // Create new session (task count will be updated after tracker init)
    // Note: Lock already acquired above, so createSession won't re-acquire

    // Clear progress file for fresh start with new epic
    await clearProgress(config.cwd);

    session = await createSession({
      agentPlugin: config.agent.plugin,
      trackerPlugin: config.tracker.plugin,
      epicId: config.epicId,
      prdPath: config.prdPath,
      maxIterations: config.maxIterations,
      totalTasks: 0, // Will be updated
      cwd: config.cwd,
    });
  }

  // Set session ID on config for use in iteration log filenames
  config.sessionId = session.id;

  console.log(`Session: ${session.id}`);
  console.log(`Agent: ${config.agent.plugin}`);
  console.log(`Tracker: ${config.tracker.plugin}`);
  if (config.epicId) {
    console.log(`Epic: ${config.epicId}`);
  }
  if (config.prdPath) {
    console.log(`PRD: ${config.prdPath}`);
  }
  console.log(`Max iterations: ${config.maxIterations || 'unlimited'}`);
  console.log('');

  // Create and initialize engine
  const engine = new ExecutionEngine(config);

  let tasks: TrackerTask[] = [];
  let tracker: TrackerPlugin;
  try {
    await engine.initialize();
    // Get tasks for persisted state
    const trackerRegistry = getTrackerRegistry();
    tracker = await trackerRegistry.getInstance(config.tracker);

    // Detect and handle stale in_progress tasks from crashed sessions
    // This must happen before we fetch tasks, so they reflect any resets
    await detectAndHandleStaleTasks(config.cwd, tracker, options.headless ?? false);

    tasks = await tracker.getTasks({ status: ['open', 'in_progress', 'completed'] });

    // Apply task range filter if specified
    if (options.taskRange) {
      const { filteredTasks, message } = filterTasksByRange(tasks, options.taskRange);
      tasks = filteredTasks;
      console.log(`📊 ${message}`);

      // Set filtered task IDs on config so ExecutionEngine respects the filter
      // This is needed because ExecutionEngine calls tracker.getNextTask() directly
      config.filteredTaskIds = filteredTasks.map((t) => t.id);
    }
  } catch (error) {
    console.error(
      'Failed to initialize engine:',
      error instanceof Error ? error.message : error
    );
    await endSession(config.cwd, 'failed');
    await releaseLockNew(config.cwd);
    cleanupLockHandlers();
    process.exit(1);
  }

  // Warn if --rotate-token is used without --listen
  if (options.rotateToken && !options.listen) {
    console.warn('Warning: --rotate-token has no effect without --listen');
  }

  // Start remote listener if --listen flag is set
  let remoteServer: RemoteServer | null = null;
  if (options.listen) {
    try {
      const listenPort = options.listenPort ?? DEFAULT_LISTEN_OPTIONS.port;

      // Handle token rotation if requested
      let token;
      let isNew = false;
      if (options.rotateToken) {
        token = await rotateServerToken();
        isNew = true; // Treat rotated token as new (show it once)
        console.log('');
        console.log('Token rotated successfully.');
      } else {
        const result = await getOrCreateServerToken();
        token = result.token;
        isNew = result.isNew;
      }

      // Get git info for remote display
      const gitInfo = getGitInfo(cwd);

      // Resolve sandbox mode for remote display
      const resolvedSandboxModeForRemote = config.sandbox?.enabled
        ? (config.sandbox.mode === 'auto' ? await detectSandboxMode() : config.sandbox.mode)
        : undefined;

      // Create and start the remote server
      remoteServer = await createRemoteServer({
        port: listenPort,
        engine,
        tracker,
        agentName: config.agent.plugin,
        trackerName: config.tracker.plugin,
        currentModel: config.model,
        autoCommit: storedConfig?.autoCommit,
        sandboxConfig: config.sandbox?.enabled ? {
          enabled: true,
          mode: config.sandbox.mode,
          network: config.sandbox.network,
        } : undefined,
        resolvedSandboxMode: resolvedSandboxModeForRemote,
        gitInfo,
        cwd,
      });
      // Enable remote orchestration by setting parallel config
      remoteServer.setParallelConfig({
        baseConfig: config,
        tracker,
      });

      const serverState = await remoteServer.start();
      const actualPort = serverState.port;

      // Display connection info
      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('                    Remote Listener Enabled                     ');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');
      if (actualPort !== listenPort) {
        console.log(`  Port: ${actualPort} (requested ${listenPort} was in use)`);
      } else {
        console.log(`  Port: ${actualPort}`);
      }
      if (isNew) {
        // First time or rotated - show full token
        console.log('');
        console.log('  New server token generated:');
        console.log(`  ${token.value}`);
        console.log('');
        console.log('  ⚠️  Save this token securely - it won\'t be shown again!');
      } else {
        // Subsequent runs - show preview only (security: avoid showing in logs/screen shares)
        const tokenPreview = token.value.substring(0, 8) + '...';
        console.log(`  Token: ${tokenPreview}`);
        const tokenInfo = await getServerTokenInfo();
        if (tokenInfo.daysRemaining !== undefined && tokenInfo.daysRemaining <= 7) {
          console.log(`  ⚠️  Token expires in ${tokenInfo.daysRemaining} day${tokenInfo.daysRemaining !== 1 ? 's' : ''}!`);
        }
        console.log('');
        console.log('  Hint: Use --rotate-token to generate a new token and see the full value.');
      }
      console.log('');
      console.log('  Connect from another machine:');
      console.log(`    ralph-tui remote add <alias> <this-host>:${actualPort} --token <token>`);
      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');
    } catch (error) {
      console.error(
        'Failed to start remote listener:',
        error instanceof Error ? error.message : error
      );
      await endSession(config.cwd, 'failed');
      await releaseLockNew(config.cwd);
      cleanupLockHandlers();
      process.exit(1);
    }
  }

  // Create persisted session state
  let persistedState = createPersistedSession({
    sessionId: session.id,
    agentPlugin: config.agent.plugin,
    model: config.model,
    trackerPlugin: config.tracker.plugin,
    epicId: config.epicId,
    prdPath: config.prdPath,
    maxIterations: config.maxIterations,
    tasks,
    cwd: config.cwd,
  });

  // Save initial state
  await savePersistedSession(persistedState);

  // Register session in global registry for cross-directory resume
  await registerSession({
    sessionId: session.id,
    cwd: config.cwd,
    status: 'running',
    startedAt: persistedState.startedAt,
    updatedAt: persistedState.updatedAt,
    agentPlugin: config.agent.plugin,
    trackerPlugin: config.tracker.plugin,
    epicId: config.epicId,
    prdPath: config.prdPath,
    sandbox: config.sandbox?.enabled,
  });

  // Resolve notification settings from config + CLI flags
  const notificationsEnabled = resolveNotificationsEnabled(
    storedConfig?.notifications,
    options.notify
  );
  const soundMode: NotificationSoundMode = storedConfig?.notifications?.sound ?? 'off';
  const notificationRunOptions: NotificationRunOptions = {
    notificationsEnabled,
    soundMode,
  };

  // Determine parallel vs sequential execution mode
  const parallelMode = resolveParallelMode(options, storedConfig);

  // Get actionable tasks for parallel analysis (used by both analysis and heuristics)
  const actionableTasks = tasks.filter(
    (t) => t.status === 'open' || t.status === 'in_progress'
  );

  // Check if parallel execution should be used
  let useParallel = false;
  let taskGraphAnalysis: ReturnType<typeof analyzeTaskGraph> | null = null;

  if (parallelMode !== 'never' && actionableTasks.length >= 2) {
    taskGraphAnalysis = analyzeTaskGraph(actionableTasks);

    if (parallelMode === 'always') {
      useParallel = taskGraphAnalysis.maxParallelism >= 2;
    } else {
      // 'auto' mode
      useParallel = shouldRunParallel(taskGraphAnalysis);
    }

    if (useParallel && !config.showTui) {
      // Only log to console in headless mode — TUI mode shows this in the header
      console.log(`Parallel execution enabled: ${taskGraphAnalysis.groups.length} group(s), max parallelism ${taskGraphAnalysis.maxParallelism}`);
    }
  }

  // Track parallel completion state for final check (set inside useParallel block)
  let parallelAllComplete: boolean | null = null;

  // Run parallel or sequential execution
  try {
    if (useParallel) {
      // Check if autoCommit is enabled — required for parallel mode
      if (!config.autoCommit) {
        console.log('\n⚠️  Auto-commit is currently disabled.');
        console.log('Parallel mode requires auto-commit to merge worker changes back to main.\n');

        const { promptSelect } = await import('../setup/prompts.js');
        const choice = await promptSelect<'enable' | 'sequential' | 'quit'>(
          'How would you like to proceed?',
          [
            { value: 'enable', label: 'Enable auto-commit for this session (recommended)' },
            { value: 'sequential', label: 'Fall back to sequential mode (no auto-commit)' },
            { value: 'quit', label: 'Quit' },
          ]
        );

        if (choice === 'quit') {
          process.exit(0);
        } else if (choice === 'sequential') {
          console.log('\nSwitching to sequential mode...\n');
          // Fall through to sequential execution below
          useParallel = false;
        } else {
          // choice === 'enable' — continue with parallel, workers will force autoCommit
          console.log('\nAuto-commit will be enabled for parallel workers.\n');
        }
      }
    }

    if (useParallel) {
      // Parallel execution path
      let maxWorkers = typeof options.parallel === 'number'
        ? options.parallel
        : storedConfig?.parallel?.maxWorkers ?? 3;

      // Apply smart parallelism heuristics to adjust worker count
      if (taskGraphAnalysis) {
        const heuristics = recommendParallelism(actionableTasks, taskGraphAnalysis, maxWorkers);

        if (heuristics.recommendedWorkers < maxWorkers && heuristics.confidence !== 'low') {
          if (!config.showTui) {
            console.log(`📊 Smart heuristics: ${heuristics.reason}`);
            console.log(`   Adjusting workers: ${maxWorkers} → ${heuristics.recommendedWorkers}`);
          }
          maxWorkers = heuristics.recommendedWorkers;
        }
      }

      // Resolve directMerge: CLI flag takes precedence over config
      const directMerge = options.directMerge ?? storedConfig?.parallel?.directMerge ?? false;

      // Get filtered task IDs for ParallelExecutor (if --task-range was used)
      const filteredTaskIds = options.taskRange
        ? actionableTasks.map((t) => t.id)
        : undefined;

      const parallelExecutor = new ParallelExecutor(config, tracker, {
        maxWorkers,
        worktreeDir: storedConfig?.parallel?.worktreeDir,
        directMerge,
        filteredTaskIds,
      });

      // Wire up AI conflict resolution if enabled (default: true)
      const conflictResolutionEnabled = storedConfig?.conflictResolution?.enabled !== false;
      if (conflictResolutionEnabled) {
        // Pass conflict resolution config to RalphConfig for the resolver
        const configWithConflictRes = {
          ...config,
          conflictResolution: storedConfig?.conflictResolution,
        };
        parallelExecutor.setAiResolver(createAiResolver(configWithConflictRes));
      }

      // Track session branch info for completion guidance
      let sessionBranchForGuidance: string | null = null;
      let originalBranchForGuidance: string | null = null;

      if (config.showTui) {
        // Parallel TUI mode — visualize workers, merges, and conflicts
        persistedState = await runParallelWithTui(
          parallelExecutor, persistedState, config, tasks, storedConfig
        );
        // Get branch info after execution completes
        sessionBranchForGuidance = parallelExecutor.getSessionBranch();
        originalBranchForGuidance = parallelExecutor.getOriginalBranch();
      } else {
        // Parallel headless mode — log events to console
        let parallelSignalInterrupted = false;
        let parallelExecutionPromise: Promise<void> | null = null;

        parallelExecutor.on((event) => {
          const time = new Date(event.timestamp).toLocaleTimeString();
          switch (event.type) {
            case 'parallel:started':
              console.log(`[${time}] [INFO] [parallel] Parallel execution started: ${event.totalTasks} tasks, ${event.totalGroups} groups, ${event.maxWorkers} workers`);
              break;
            case 'parallel:session-branch-created':
              console.log(`[${time}] [INFO] [parallel] Session branch created: ${event.sessionBranch} (from ${event.originalBranch})`);
              break;
            case 'parallel:group-started':
              console.log(`[${time}] [INFO] [parallel] Group ${event.groupIndex + 1}/${event.totalGroups} started: ${event.workerCount} workers`);
              break;
            case 'worker:started':
              console.log(`[${time}] [INFO] [worker] Worker ${event.workerId} started: ${event.task.title}`);
              // Mark task as active in persisted session state
              persistedState = addActiveTask(persistedState, event.task.id);
              savePersistedSession(persistedState).catch(() => {});
              break;
            case 'worker:completed':
              console.log(`[${time}] [INFO] [worker] Worker ${event.workerId} completed: ${event.result.task.title}`);
              // Remove task from active list in persisted session state
              persistedState = removeActiveTask(persistedState, event.result.task.id);
              savePersistedSession(persistedState).catch(() => {});
              break;
            case 'worker:failed':
              console.log(`[${time}] [ERROR] [worker] Worker ${event.workerId} failed: ${event.error}`);
              // Remove task from active list in persisted session state
              persistedState = removeActiveTask(persistedState, event.task.id);
              savePersistedSession(persistedState).catch(() => {});
              break;
            case 'merge:completed':
              console.log(`[${time}] [INFO] [merge] Merge completed: ${event.result.strategy} (${event.result.filesChanged} files)`);
              break;
            case 'merge:failed':
              console.log(`[${time}] [ERROR] [merge] Merge failed: ${event.error}`);
              break;
            case 'parallel:completed':
              console.log(`[${time}] [INFO] [parallel] Parallel execution completed: ${event.totalTasksCompleted} tasks, ${event.totalMergesCompleted} merges, ${event.durationMs}ms`);
              break;
            case 'parallel:failed':
              console.log(`[${time}] [ERROR] [parallel] Parallel execution failed: ${event.error}`);
              break;
          }
        });

        // Signal handlers for graceful shutdown in parallel headless mode
        const handleParallelSignal = async (): Promise<void> => {
          if (parallelSignalInterrupted) {
            return;
          }
          parallelSignalInterrupted = true;
          console.log('\n[INFO] [parallel] Received signal, stopping parallel execution...');

          // Stop the parallel executor
          await parallelExecutor.stop();

          // Wait for execute() to unwind so cleanup (worktrees/branches/tags) completes.
          if (parallelExecutionPromise) {
            await parallelExecutionPromise.catch(() => {});
          }

          // Reset any in_progress tasks back to open
          const activeTasks = getActiveTasks(persistedState);
          if (activeTasks.length > 0) {
            console.log(`[INFO] [parallel] Resetting ${activeTasks.length} in_progress task(s) to open...`);
            for (const taskId of activeTasks) {
              try {
                await tracker.updateTaskStatus(taskId, 'open');
              } catch {
                // Best effort reset
              }
            }
            persistedState = clearActiveTasks(persistedState);
          }

          // Save interrupted state
          persistedState = { ...persistedState, status: 'interrupted' };
          await savePersistedSession(persistedState);
        };

        process.on('SIGINT', handleParallelSignal);
        process.on('SIGTERM', handleParallelSignal);

        try {
          parallelExecutionPromise = parallelExecutor.execute();
          await parallelExecutionPromise;
          // Get branch info after execution completes
          sessionBranchForGuidance = parallelExecutor.getSessionBranch();
          originalBranchForGuidance = parallelExecutor.getOriginalBranch();
        } finally {
          parallelExecutionPromise = null;
          // Remove handlers after execution completes
          process.removeListener('SIGINT', handleParallelSignal);
          process.removeListener('SIGTERM', handleParallelSignal);
        }
      }

      // Show completion guidance if a session branch was created
      if (
        sessionBranchForGuidance &&
        originalBranchForGuidance &&
        parallelExecutor.getState().status === 'completed'
      ) {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('                   Session Complete!                            ');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');
        console.log(`  Changes are on branch: ${sessionBranchForGuidance}`);
        console.log(`  You are now on branch: ${originalBranchForGuidance}`);
        console.log('');
        console.log('  Next steps:');
        console.log('');
        console.log(`    To merge to ${originalBranchForGuidance}:`);
        console.log(`      git merge ${sessionBranchForGuidance}`);
        console.log('');
        console.log('    To create a PR:');
        console.log(`      git push -u origin ${sessionBranchForGuidance}`);
        console.log(`      gh pr create --head ${sessionBranchForGuidance}`);
        console.log('');
        console.log('    To discard all changes:');
        console.log(`      git branch -D ${sessionBranchForGuidance}`);
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');
      }

      // Set parallel completion state for final check
      const pState = parallelExecutor.getState();
      parallelAllComplete = isParallelExecutionComplete(
        pState.status,
        pState.totalTasksCompleted,
        pState.totalTasks
      );
    } else if (config.showTui) {
      // Sequential TUI mode (existing path)
      // Pass tasks for initial TUI display in "ready" state
      // Also pass storedConfig for settings view
      persistedState = await runWithTui(engine, persistedState, config, tasks, storedConfig, notificationRunOptions);
    } else {
      // Sequential headless mode (existing path)
      persistedState = await runHeadless(engine, persistedState, config, {
        notificationOptions: notificationRunOptions,
        listenMode: options.listen,
        remoteServer,
      });
    }
  } catch (error) {
    console.error(
      'Execution error:',
      error instanceof Error ? error.message : error
    );
    // Save failed state
    persistedState = failSession(persistedState);
    await savePersistedSession(persistedState);
    // Update registry status to failed
    await updateRegistryStatus(session.id, 'failed');
    await endSession(config.cwd, 'failed');
    await releaseLockNew(config.cwd);
    cleanupLockHandlers();
    process.exit(1);
  }

  // Check if all tasks completed successfully
  const finalState = engine.getState();
  const allComplete = isSessionComplete(
    parallelAllComplete,
    finalState.tasksCompleted,
    finalState.totalTasks
  );

  if (allComplete) {
    // Mark as completed and clean up session file
    persistedState = completeSession(persistedState);
    await savePersistedSession(persistedState);
    // Delete session file on successful completion
    await deletePersistedSession(config.cwd);
    // Remove from registry on completion
    await unregisterSession(session.id);
    console.log('\nSession completed successfully. Session file cleaned up.');
  } else {
    // Save current state (session remains resumable)
    await savePersistedSession(persistedState);
    // Update registry with current status
    await updateRegistryStatus(session.id, persistedState.status);
    console.log('\nSession state saved. Use "ralph-tui resume" to continue.');
  }

  // Stop remote server if running
  if (remoteServer) {
    await remoteServer.stop();
  }

  // End session and clean up lock
  await endSession(config.cwd, allComplete ? 'completed' : 'interrupted');
  await releaseLockNew(config.cwd);
  cleanupLockHandlers();
  console.log('\nRalph TUI finished.');

  // Explicitly exit - event listeners may keep process alive otherwise
  process.exit(0);
}
