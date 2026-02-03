/**
 * ABOUTME: Tests for the run command utilities.
 * Covers task range filtering and related utilities.
 */

import { describe, test, expect } from 'bun:test';
import { filterTasksByRange, parseRunArgs, printRunHelp, type TaskRangeFilter } from './run.js';
import type { TrackerTask } from '../plugins/trackers/types.js';

/**
 * Helper to create mock tasks for testing.
 */
function createTasks(count: number): TrackerTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    title: `Task ${i + 1}`,
    status: 'open' as const,
    priority: 2 as const,
  }));
}

describe('filterTasksByRange', () => {
  describe('basic filtering', () => {
    test('filters tasks within explicit range (1-3)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 1, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(3);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-1', 'task-2', 'task-3']);
      expect(result.message).toContain('1-3');
      expect(result.message).toContain('3 of 5');
    });

    test('filters tasks with only start specified (3-)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(3);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-3', 'task-4', 'task-5']);
      expect(result.message).toContain('3-');
    });

    test('filters tasks with only end specified (-2)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(2);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-1', 'task-2']);
      expect(result.message).toContain('-2');
    });

    test('returns all tasks when range is undefined/empty', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = {};

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toContain('all');
    });

    test('filters single task when start equals end', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(1);
      expect(result.filteredTasks[0].id).toBe('task-3');
      expect(result.message).toContain('3-3');
    });
  });

  describe('edge cases', () => {
    test('handles empty task list', () => {
      const tasks: TrackerTask[] = [];
      const range: TaskRangeFilter = { start: 1, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(0);
      expect(result.message).toContain('0 of 0');
    });

    test('returns original tasks for invalid range (start < 1)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 0, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toBe('Invalid task range, using all tasks');
    });

    test('returns original tasks for invalid range (end < start)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 4, end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toBe('Invalid task range, using all tasks');
    });

    test('handles range exceeding task count gracefully', () => {
      const tasks = createTasks(3);
      const range: TaskRangeFilter = { start: 1, end: 10 };

      const result = filterTasksByRange(tasks, range);

      // Should return all 3 tasks (doesn't fail on out-of-bounds)
      expect(result.filteredTasks).toHaveLength(3);
      expect(result.message).toContain('3 of 3');
    });

    test('handles start exceeding task count', () => {
      const tasks = createTasks(3);
      const range: TaskRangeFilter = { start: 10 };

      const result = filterTasksByRange(tasks, range);

      // No tasks match since start is beyond all tasks
      expect(result.filteredTasks).toHaveLength(0);
      expect(result.message).toContain('0 of 3');
    });
  });

  describe('message formatting', () => {
    test('formats message correctly for full range', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 2, end: 4 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range 2-4: 3 of 5 tasks selected');
    });

    test('formats message correctly for open-ended start', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range 3-: 3 of 5 tasks selected');
    });

    test('formats message correctly for open-ended end', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range -2: 2 of 5 tasks selected');
    });

    test('formats message correctly for all tasks', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = {};

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range all: 5 of 5 tasks selected');
    });
  });
});

describe('parseRunArgs', () => {
  describe('--task-range parsing', () => {
    test('parses full range "1-5"', () => {
      const result = parseRunArgs(['--task-range', '1-5']);

      expect(result.taskRange).toEqual({ start: 1, end: 5 });
    });

    test('parses start-only range "3-"', () => {
      const result = parseRunArgs(['--task-range', '3-']);

      expect(result.taskRange).toEqual({ start: 3, end: undefined });
    });

    test('parses end-only range "-10"', () => {
      const result = parseRunArgs(['--task-range', '-10']);

      expect(result.taskRange).toEqual({ start: undefined, end: 10 });
    });

    test('parses single task number "5"', () => {
      const result = parseRunArgs(['--task-range', '5']);

      expect(result.taskRange).toEqual({ start: 5, end: 5 });
    });

    test('parses range with same start and end "3-3"', () => {
      const result = parseRunArgs(['--task-range', '3-3']);

      expect(result.taskRange).toEqual({ start: 3, end: 3 });
    });

    test('handles missing value after --task-range', () => {
      const result = parseRunArgs(['--task-range']);

      expect(result.taskRange).toBeUndefined();
    });

    test('handles --task-range followed by another flag', () => {
      const result = parseRunArgs(['--task-range', '--parallel']);

      // --parallel should not be consumed as a range value
      expect(result.taskRange).toBeUndefined();
      expect(result.parallel).toBe(true);
    });

    test('handles invalid range format gracefully', () => {
      const result = parseRunArgs(['--task-range', 'abc']);

      // NaN parsing should not set taskRange
      expect(result.taskRange).toBeUndefined();
    });
  });

  describe('--parallel parsing', () => {
    test('parses --parallel without value as true', () => {
      const result = parseRunArgs(['--parallel']);

      expect(result.parallel).toBe(true);
    });

    test('parses --parallel with numeric value', () => {
      const result = parseRunArgs(['--parallel', '4']);

      expect(result.parallel).toBe(4);
    });

    test('parses --parallel with invalid value as true', () => {
      const result = parseRunArgs(['--parallel', 'abc']);

      expect(result.parallel).toBe(true);
    });

    test('parses --parallel followed by another flag', () => {
      const result = parseRunArgs(['--parallel', '--headless']);

      expect(result.parallel).toBe(true);
      expect(result.headless).toBe(true);
    });
  });

  describe('--direct-merge parsing', () => {
    test('parses --direct-merge flag', () => {
      const result = parseRunArgs(['--direct-merge']);

      expect(result.directMerge).toBe(true);
    });
  });

  describe('--serial/--sequential parsing', () => {
    test('parses --serial flag', () => {
      const result = parseRunArgs(['--serial']);

      expect(result.serial).toBe(true);
    });

    test('parses --sequential flag', () => {
      const result = parseRunArgs(['--sequential']);

      expect(result.serial).toBe(true);
    });
  });

  describe('--listen parsing', () => {
    test('parses --listen flag and sets headless', () => {
      const result = parseRunArgs(['--listen']);

      expect(result.listen).toBe(true);
      expect(result.headless).toBe(true);
    });

    test('parses --listen-port with valid port', () => {
      const result = parseRunArgs(['--listen-port', '8080']);

      expect(result.listenPort).toBe(8080);
    });

    test('ignores --listen-port with invalid port', () => {
      const result = parseRunArgs(['--listen-port', '0']);

      expect(result.listenPort).toBeUndefined();
    });

    test('ignores --listen-port with port > 65535', () => {
      const result = parseRunArgs(['--listen-port', '70000']);

      expect(result.listenPort).toBeUndefined();
    });
  });

  describe('combined options', () => {
    test('parses multiple options together', () => {
      const result = parseRunArgs([
        '--parallel',
        '3',
        '--task-range',
        '1-10',
        '--direct-merge',
        '--headless',
      ]);

      expect(result.parallel).toBe(3);
      expect(result.taskRange).toEqual({ start: 1, end: 10 });
      expect(result.directMerge).toBe(true);
      expect(result.headless).toBe(true);
    });
  });
});

describe('printRunHelp', () => {
  test('prints help without throwing', () => {
    // Capture console output
    const originalLog = console.log;
    const output: string[] = [];
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    };

    try {
      // Should not throw
      printRunHelp();

      // Should have printed something
      expect(output.length).toBeGreaterThan(0);

      // Should contain usage info
      const fullOutput = output.join('\n');
      expect(fullOutput).toContain('ralph-tui run');
      expect(fullOutput).toContain('--task-range');
      expect(fullOutput).toContain('--parallel');
    } finally {
      console.log = originalLog;
    }
  });
});
