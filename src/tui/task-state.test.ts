/**
 * ABOUTME: Tests for TUI task-state reconciliation helpers.
 * Verifies tracker refreshes preserve current-session completion markers.
 */

import { describe, expect, test } from 'bun:test';
import type { TaskItem } from './types.js';
import { preserveCurrentSessionCompletions } from './task-state.js';

function createTaskItem(id: string, status: TaskItem['status']): TaskItem {
  return {
    id,
    title: id,
    status,
  };
}

describe('preserveCurrentSessionCompletions', () => {
  test('preserves done for tasks completed in the current session', () => {
    const previousTasks: TaskItem[] = [
      createTaskItem('task-1', 'done'),
      createTaskItem('task-2', 'actionable'),
    ];
    const refreshedTasks: TaskItem[] = [
      createTaskItem('task-1', 'closed'),
      createTaskItem('task-2', 'actionable'),
    ];

    const result = preserveCurrentSessionCompletions(previousTasks, refreshedTasks);

    expect(result.map((task) => task.status)).toEqual(['done', 'actionable']);
  });

  test('leaves historical closed tasks unchanged', () => {
    const previousTasks: TaskItem[] = [
      createTaskItem('task-1', 'closed'),
    ];
    const refreshedTasks: TaskItem[] = [
      createTaskItem('task-1', 'closed'),
    ];

    const result = preserveCurrentSessionCompletions(previousTasks, refreshedTasks);

    expect(result[0]?.status).toBe('closed');
  });

  test('passes through newly discovered tasks unchanged', () => {
    const previousTasks: TaskItem[] = [
      createTaskItem('task-1', 'done'),
    ];
    const refreshedTasks: TaskItem[] = [
      createTaskItem('task-1', 'closed'),
      createTaskItem('task-2', 'actionable'),
    ];

    const result = preserveCurrentSessionCompletions(previousTasks, refreshedTasks);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(createTaskItem('task-2', 'actionable'));
  });

  test('keeps refreshed regressed statuses instead of coercing them back to done', () => {
    const previousTasks: TaskItem[] = [
      createTaskItem('task-1', 'done'),
    ];
    const refreshedTasks: TaskItem[] = [
      createTaskItem('task-1', 'active'),
    ];

    const result = preserveCurrentSessionCompletions(previousTasks, refreshedTasks);

    expect(result[0]?.status).toBe('active');
  });
});
