/**
 * ABOUTME: Factory functions for creating TrackerTask test objects.
 * Provides type-safe builders with sensible defaults.
 */

import type {
  TrackerTask,
  TrackerTaskStatus,
  TaskPriority,
  TaskCompletionResult,
  SyncResult,
  TaskFilter,
} from '../../src/plugins/trackers/types.js';

/**
 * Default values for TrackerTask
 */
export const DEFAULT_TRACKER_TASK: TrackerTask = {
  id: 'task-001',
  title: 'Test Task',
  status: 'open',
  priority: 1,
  description: 'A test task for unit testing',
  labels: ['test'],
  type: 'task',
};

/**
 * Create a TrackerTask with optional overrides
 */
export function createTrackerTask(
  overrides: Partial<TrackerTask> = {},
): TrackerTask {
  return {
    ...DEFAULT_TRACKER_TASK,
    ...overrides,
  };
}

/**
 * Create multiple tracker tasks with sequential IDs
 */
export function createTrackerTasks(
  count: number,
  baseOverrides: Partial<TrackerTask> = {},
): TrackerTask[] {
  return Array.from({ length: count }, (_, i) =>
    createTrackerTask({
      id: `task-${String(i + 1).padStart(3, '0')}`,
      title: `Task ${i + 1}`,
      priority: Math.min(i + 1, 4) as TaskPriority,
      ...baseOverrides,
    }),
  );
}

/**
 * Create an open task
 */
export function createOpenTask(
  overrides: Partial<TrackerTask> = {},
): TrackerTask {
  return createTrackerTask({
    status: 'open',
    ...overrides,
  });
}

/**
 * Create an in-progress task
 */
export function createInProgressTask(
  overrides: Partial<TrackerTask> = {},
): TrackerTask {
  return createTrackerTask({
    status: 'in_progress',
    ...overrides,
  });
}

/**
 * Create a blocked task
 */
export function createBlockedTask(
  blockedBy: string[] = ['task-000'],
  overrides: Partial<TrackerTask> = {},
): TrackerTask {
  return createTrackerTask({
    status: 'blocked',
    dependsOn: blockedBy,
    ...overrides,
  });
}

/**
 * Create a completed task
 */
export function createCompletedTask(
  overrides: Partial<TrackerTask> = {},
): TrackerTask {
  return createTrackerTask({
    status: 'completed',
    updatedAt: new Date().toISOString(),
    ...overrides,
  });
}

/**
 * Create an epic task
 */
export function createEpicTask(
  overrides: Partial<TrackerTask> = {},
): TrackerTask {
  return createTrackerTask({
    type: 'epic',
    priority: 0,
    ...overrides,
  });
}

/**
 * Create a child task with a parent
 */
export function createChildTask(
  parentId: string,
  overrides: Partial<TrackerTask> = {},
): TrackerTask {
  return createTrackerTask({
    parentId,
    ...overrides,
  });
}

/**
 * Create a successful TaskCompletionResult
 */
export function createSuccessfulCompletion(
  task: Partial<TrackerTask> = {},
  message = 'Task completed successfully',
): TaskCompletionResult {
  return {
    success: true,
    message,
    task: createCompletedTask(task),
  };
}

/**
 * Create a failed TaskCompletionResult
 */
export function createFailedCompletion(
  error = 'Task completion failed',
  message = 'Failed to complete task',
): TaskCompletionResult {
  return {
    success: false,
    message,
    error,
  };
}

/**
 * Create a successful SyncResult
 */
export function createSuccessfulSync(
  counts: { added?: number; updated?: number; removed?: number } = {},
): SyncResult {
  return {
    success: true,
    message: 'Sync completed successfully',
    added: counts.added ?? 0,
    updated: counts.updated ?? 0,
    removed: counts.removed ?? 0,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Create a failed SyncResult
 */
export function createFailedSync(error = 'Sync failed'): SyncResult {
  return {
    success: false,
    message: 'Failed to sync with tracker',
    error,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Create a TaskFilter with optional overrides
 */
export function createTaskFilter(
  overrides: Partial<TaskFilter> = {},
): TaskFilter {
  return {
    ...overrides,
  };
}

/**
 * Create a filter for open tasks
 */
export function createOpenTaskFilter(
  overrides: Partial<TaskFilter> = {},
): TaskFilter {
  return createTaskFilter({
    status: 'open',
    ready: true,
    ...overrides,
  });
}
