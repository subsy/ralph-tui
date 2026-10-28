/**
 * ABOUTME: Tests for TUI state utility functions.
 * Tests status conversion, dependency checking, and state transitions
 * without requiring actual terminal rendering.
 */

import { describe, test, expect } from 'bun:test';
import type { TaskStatus } from '../../src/tui/theme.js';
import type { TaskItem, BlockerInfo } from '../../src/tui/types.js';

/**
 * Re-implemented utility functions from RunApp for testing.
 * These mirror the internal functions used for state management.
 */

/**
 * Convert tracker status to TUI task status (basic mapping).
 */
function trackerStatusToTaskStatus(trackerStatus: string): TaskStatus {
  switch (trackerStatus) {
    case 'open':
      return 'pending';
    case 'in_progress':
      return 'active';
    case 'completed':
      return 'closed';
    case 'blocked':
      return 'blocked';
    case 'cancelled':
      return 'closed';
    default:
      return 'pending';
  }
}

/**
 * Recalculate dependency status for all tasks.
 */
function recalculateDependencyStatus(tasks: TaskItem[]): TaskItem[] {
  const statusMap = new Map<string, { status: TaskStatus; title: string }>();
  for (const task of tasks) {
    statusMap.set(task.id, { status: task.status, title: task.title });
  }

  return tasks.map((task) => {
    if (task.status !== 'pending' && task.status !== 'blocked' && task.status !== 'actionable') {
      return task;
    }

    if (!task.dependsOn || task.dependsOn.length === 0) {
      return task.status === 'pending' ? { ...task, status: 'actionable' as TaskStatus } : task;
    }

    const blockers: BlockerInfo[] = [];
    for (const depId of task.dependsOn) {
      const dep = statusMap.get(depId);
      if (dep) {
        if (dep.status !== 'done' && dep.status !== 'closed') {
          blockers.push({
            id: depId,
            title: dep.title,
            status: dep.status,
          });
        }
      } else {
        blockers.push({
          id: depId,
          title: `(external: ${depId})`,
          status: 'unknown',
        });
      }
    }

    if (blockers.length > 0) {
      return {
        ...task,
        status: 'blocked' as TaskStatus,
        blockedByTasks: blockers,
      };
    }

    return {
      ...task,
      status: 'actionable' as TaskStatus,
      blockedByTasks: undefined,
    };
  });
}

describe('state-utils', () => {
  describe('trackerStatusToTaskStatus', () => {
    test('should convert open to pending', () => {
      expect(trackerStatusToTaskStatus('open')).toBe('pending');
    });

    test('should convert in_progress to active', () => {
      expect(trackerStatusToTaskStatus('in_progress')).toBe('active');
    });

    test('should convert completed to closed', () => {
      expect(trackerStatusToTaskStatus('completed')).toBe('closed');
    });

    test('should convert blocked to blocked', () => {
      expect(trackerStatusToTaskStatus('blocked')).toBe('blocked');
    });

    test('should convert cancelled to closed', () => {
      expect(trackerStatusToTaskStatus('cancelled')).toBe('closed');
    });

    test('should default unknown statuses to pending', () => {
      expect(trackerStatusToTaskStatus('unknown')).toBe('pending');
      expect(trackerStatusToTaskStatus('')).toBe('pending');
      expect(trackerStatusToTaskStatus('random')).toBe('pending');
    });
  });

  describe('recalculateDependencyStatus', () => {
    test('should mark task without dependencies as actionable', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending' },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('actionable');
    });

    test('should mark task with empty dependencies as actionable', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending', dependsOn: [] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('actionable');
    });

    test('should mark task as blocked if dependency not complete', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending' },
        { id: 'task-2', title: 'Task 2', status: 'pending', dependsOn: ['task-1'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[1]?.status).toBe('blocked');
      expect(result[1]?.blockedByTasks).toHaveLength(1);
      expect(result[1]?.blockedByTasks?.[0]?.id).toBe('task-1');
    });

    test('should mark task as actionable if dependency is done', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'done' },
        { id: 'task-2', title: 'Task 2', status: 'pending', dependsOn: ['task-1'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[1]?.status).toBe('actionable');
      expect(result[1]?.blockedByTasks).toBeUndefined();
    });

    test('should mark task as actionable if dependency is closed', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'closed' },
        { id: 'task-2', title: 'Task 2', status: 'pending', dependsOn: ['task-1'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[1]?.status).toBe('actionable');
    });

    test('should handle multiple dependencies', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'done' },
        { id: 'task-2', title: 'Task 2', status: 'pending' },
        { id: 'task-3', title: 'Task 3', status: 'pending', dependsOn: ['task-1', 'task-2'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[2]?.status).toBe('blocked');
      expect(result[2]?.blockedByTasks).toHaveLength(1);
      expect(result[2]?.blockedByTasks?.[0]?.id).toBe('task-2');
    });

    test('should mark as actionable when all multiple dependencies are complete', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'done' },
        { id: 'task-2', title: 'Task 2', status: 'closed' },
        { id: 'task-3', title: 'Task 3', status: 'pending', dependsOn: ['task-1', 'task-2'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[2]?.status).toBe('actionable');
    });

    test('should not modify active status', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'active', dependsOn: ['task-2'] },
        { id: 'task-2', title: 'Task 2', status: 'pending' },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('active');
    });

    test('should not modify done status', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'done' },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('done');
    });

    test('should not modify error status', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'error' },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('error');
    });

    test('should not modify closed status', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'closed', dependsOn: ['task-2'] },
        { id: 'task-2', title: 'Task 2', status: 'pending' },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('closed');
    });

    test('should handle external dependencies as blockers', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending', dependsOn: ['external-task'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('blocked');
      expect(result[0]?.blockedByTasks?.[0]?.title).toContain('external');
    });

    test('should handle empty task list', () => {
      const result = recalculateDependencyStatus([]);
      expect(result).toEqual([]);
    });

    test('should handle circular dependencies without infinite loop', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending', dependsOn: ['task-2'] },
        { id: 'task-2', title: 'Task 2', status: 'pending', dependsOn: ['task-1'] },
      ];
      // Should complete without hanging
      const result = recalculateDependencyStatus(tasks);
      expect(result).toHaveLength(2);
      expect(result[0]?.status).toBe('blocked');
      expect(result[1]?.status).toBe('blocked');
    });

    test('should preserve task with actionable status if no dependencies', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'actionable' },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[0]?.status).toBe('actionable');
    });

    test('should update blocked task to actionable when blocker completes', () => {
      // Initial state: task-2 blocked by task-1
      const initialTasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending' },
        { id: 'task-2', title: 'Task 2', status: 'blocked', dependsOn: ['task-1'] },
      ];

      // After task-1 completes
      const updatedTasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'done' },
        { id: 'task-2', title: 'Task 2', status: 'blocked', dependsOn: ['task-1'] },
      ];

      const result = recalculateDependencyStatus(updatedTasks);
      expect(result[1]?.status).toBe('actionable');
    });
  });

  describe('state transitions', () => {
    test('pending -> actionable when no dependencies', () => {
      const task: TaskItem = { id: '1', title: 'Test', status: 'pending' };
      const result = recalculateDependencyStatus([task]);
      expect(result[0]?.status).toBe('actionable');
    });

    test('pending -> blocked when has incomplete dependencies', () => {
      const tasks: TaskItem[] = [
        { id: '1', title: 'Dep', status: 'pending' },
        { id: '2', title: 'Test', status: 'pending', dependsOn: ['1'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[1]?.status).toBe('blocked');
    });

    test('blocked -> actionable when dependencies complete', () => {
      const tasks: TaskItem[] = [
        { id: '1', title: 'Dep', status: 'done' },
        { id: '2', title: 'Test', status: 'blocked', dependsOn: ['1'] },
      ];
      const result = recalculateDependencyStatus(tasks);
      expect(result[1]?.status).toBe('actionable');
    });
  });

  describe('TaskItem type validation', () => {
    test('should accept minimal TaskItem', () => {
      const task: TaskItem = {
        id: 'task-1',
        title: 'Test Task',
        status: 'pending',
      };
      expect(task.id).toBe('task-1');
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('pending');
    });

    test('should accept full TaskItem with all optional fields', () => {
      const task: TaskItem = {
        id: 'task-1',
        title: 'Test Task',
        status: 'active',
        description: 'Task description',
        iteration: 1,
        priority: 1,
        labels: ['label1', 'label2'],
        type: 'feature',
        dependsOn: ['task-0'],
        blocks: ['task-2'],
        blockedByTasks: [{ id: 'task-0', title: 'Blocker', status: 'pending' }],
        closeReason: undefined,
        acceptanceCriteria: '- [ ] Criteria 1',
        assignee: 'user@example.com',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        parentId: 'epic-1',
        metadata: { custom: 'value' },
      };

      expect(task.description).toBe('Task description');
      expect(task.priority).toBe(1);
      expect(task.labels).toEqual(['label1', 'label2']);
      expect(task.dependsOn).toEqual(['task-0']);
      expect(task.blockedByTasks).toHaveLength(1);
    });
  });

  describe('BlockerInfo type validation', () => {
    test('should create valid BlockerInfo', () => {
      const blocker: BlockerInfo = {
        id: 'blocker-1',
        title: 'Blocking Task',
        status: 'in_progress',
      };
      expect(blocker.id).toBe('blocker-1');
      expect(blocker.title).toBe('Blocking Task');
      expect(blocker.status).toBe('in_progress');
    });
  });

  describe('computeBlocksMap', () => {
    /**
     * Compute the inverse relationship: which tasks does each task block?
     * If task A dependsOn task B, then B blocks A.
     * This mirrors the logic added to convertTasksWithDependencyStatus in RunApp.tsx.
     */
    function computeBlocksMap(tasks: Array<{ id: string; dependsOn?: string[] }>): Map<string, string[]> {
      const blocksMap = new Map<string, string[]>();
      for (const task of tasks) {
        if (task.dependsOn && task.dependsOn.length > 0) {
          for (const depId of task.dependsOn) {
            const existing = blocksMap.get(depId) || [];
            existing.push(task.id);
            blocksMap.set(depId, existing);
          }
        }
      }
      return blocksMap;
    }

    test('should return empty map for tasks with no dependencies', () => {
      const tasks = [
        { id: 'task-1' },
        { id: 'task-2' },
      ];
      const result = computeBlocksMap(tasks);
      expect(result.size).toBe(0);
    });

    test('should compute blocks for single dependency', () => {
      const tasks = [
        { id: 'task-1' },
        { id: 'task-2', dependsOn: ['task-1'] },
      ];
      const result = computeBlocksMap(tasks);
      expect(result.get('task-1')).toEqual(['task-2']);
      expect(result.get('task-2')).toBeUndefined();
    });

    test('should compute blocks for multiple tasks depending on same task', () => {
      const tasks = [
        { id: 'task-1' },
        { id: 'task-2', dependsOn: ['task-1'] },
        { id: 'task-3', dependsOn: ['task-1'] },
      ];
      const result = computeBlocksMap(tasks);
      expect(result.get('task-1')).toEqual(['task-2', 'task-3']);
    });

    test('should compute blocks for chained dependencies', () => {
      // task-3 depends on task-2, which depends on task-1
      const tasks = [
        { id: 'task-1' },
        { id: 'task-2', dependsOn: ['task-1'] },
        { id: 'task-3', dependsOn: ['task-2'] },
      ];
      const result = computeBlocksMap(tasks);
      expect(result.get('task-1')).toEqual(['task-2']);
      expect(result.get('task-2')).toEqual(['task-3']);
      expect(result.get('task-3')).toBeUndefined();
    });

    test('should compute blocks for task with multiple dependencies', () => {
      // task-3 depends on both task-1 and task-2
      const tasks = [
        { id: 'task-1' },
        { id: 'task-2' },
        { id: 'task-3', dependsOn: ['task-1', 'task-2'] },
      ];
      const result = computeBlocksMap(tasks);
      expect(result.get('task-1')).toEqual(['task-3']);
      expect(result.get('task-2')).toEqual(['task-3']);
    });

    test('should handle empty dependsOn array', () => {
      const tasks = [
        { id: 'task-1', dependsOn: [] },
        { id: 'task-2', dependsOn: [] },
      ];
      const result = computeBlocksMap(tasks);
      expect(result.size).toBe(0);
    });

    test('should handle complex dependency graph', () => {
      // US-001 to US-004: no dependencies (completed)
      // US-005 depends on US-001
      // US-011 depends on US-005 and US-002
      // US-012 depends on US-011
      // US-013 depends on US-012
      const tasks = [
        { id: 'US-001' },
        { id: 'US-002' },
        { id: 'US-003' },
        { id: 'US-004' },
        { id: 'US-005', dependsOn: ['US-001'] },
        { id: 'US-011', dependsOn: ['US-005', 'US-002'] },
        { id: 'US-012', dependsOn: ['US-011'] },
        { id: 'US-013', dependsOn: ['US-012'] },
      ];
      const result = computeBlocksMap(tasks);

      // US-001 blocks US-005
      expect(result.get('US-001')).toEqual(['US-005']);
      // US-002 blocks US-011
      expect(result.get('US-002')).toEqual(['US-011']);
      // US-005 blocks US-011
      expect(result.get('US-005')).toEqual(['US-011']);
      // US-011 blocks US-012
      expect(result.get('US-011')).toEqual(['US-012']);
      // US-012 blocks US-013
      expect(result.get('US-012')).toEqual(['US-013']);
      // US-013 blocks nothing
      expect(result.get('US-013')).toBeUndefined();
      // US-003 and US-004 block nothing
      expect(result.get('US-003')).toBeUndefined();
      expect(result.get('US-004')).toBeUndefined();
    });

    test('should handle external dependencies (not in task list)', () => {
      const tasks = [
        { id: 'task-1', dependsOn: ['external-task'] },
      ];
      const result = computeBlocksMap(tasks);
      // external-task blocks task-1
      expect(result.get('external-task')).toEqual(['task-1']);
    });
  });

  describe('applyBlocksToTasks', () => {
    /**
     * Apply computed blocks to tasks, but only if tracker didn't provide blocks.
     * This mirrors the logic in convertTasksWithDependencyStatus in RunApp.tsx.
     */
    function applyBlocksToTasks(
      tasks: TaskItem[],
      blocksMap: Map<string, string[]>
    ): TaskItem[] {
      return tasks.map((task) => {
        // Only apply computed blocks if tracker didn't provide them
        if (!task.blocks || task.blocks.length === 0) {
          const blocksIds = blocksMap.get(task.id);
          if (blocksIds && blocksIds.length > 0) {
            return { ...task, blocks: blocksIds };
          }
        }
        return task;
      });
    }

    test('should add computed blocks to task without blocks', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending' },
        { id: 'task-2', title: 'Task 2', status: 'pending', dependsOn: ['task-1'] },
      ];
      const blocksMap = new Map([['task-1', ['task-2']]]);

      const result = applyBlocksToTasks(tasks, blocksMap);
      expect(result[0]?.blocks).toEqual(['task-2']);
      expect(result[1]?.blocks).toBeUndefined();
    });

    test('should preserve tracker-provided blocks', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending', blocks: ['task-2', 'task-3'] },
      ];
      const blocksMap = new Map([['task-1', ['task-2']]]);

      const result = applyBlocksToTasks(tasks, blocksMap);
      // Should preserve the tracker-provided blocks, not overwrite
      expect(result[0]?.blocks).toEqual(['task-2', 'task-3']);
    });

    test('should apply blocks when tracker provided empty array', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending', blocks: [] },
      ];
      const blocksMap = new Map([['task-1', ['task-2']]]);

      const result = applyBlocksToTasks(tasks, blocksMap);
      // Empty array counts as "not provided", so computed value is used
      expect(result[0]?.blocks).toEqual(['task-2']);
    });

    test('should not add blocks if none computed', () => {
      const tasks: TaskItem[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending' },
      ];
      const blocksMap = new Map<string, string[]>();

      const result = applyBlocksToTasks(tasks, blocksMap);
      expect(result[0]?.blocks).toBeUndefined();
    });
  });
});
