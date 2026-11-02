/**
 * ABOUTME: Helpers for reconciling task state between tracker refreshes and TUI-only status.
 * Preserves session-local display semantics like "done" when tracker data is refreshed.
 */

import type { TaskItem } from './types.js';

/**
 * Preserve current-session completion markers when tracker refreshes task data.
 *
 * Tracker refreshes report completed tasks as historical `closed`, but the TUI
 * uses `done` to distinguish tasks completed in the current session.
 */
export function preserveCurrentSessionCompletions(
  previousTasks: TaskItem[],
  refreshedTasks: TaskItem[],
): TaskItem[] {
  const previousTaskMap = new Map(
    previousTasks.map((task) => [task.id, task.status] as const)
  );

  return refreshedTasks.map((task) => {
    if (
      previousTaskMap.get(task.id) === 'done' &&
      task.status === 'closed'
    ) {
      return { ...task, status: 'done' };
    }

    return task;
  });
}
