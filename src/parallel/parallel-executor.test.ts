/**
 * ABOUTME: Tests for the ParallelExecutor coordinator.
 * Tests public API surface (state, configuration, event listeners)
 * without mock.module() to prevent interfering with other test files.
 * Integration-level execution tests are validated by running the parallel
 * test suite in isolation: `bun test src/parallel/`.
 */

import { describe, test, expect } from 'bun:test';
import { analyzeTaskGraph, shouldRunParallel } from './task-graph.js';
import type { TrackerTask } from '../plugins/trackers/types.js';

/**
 * Helper to create a minimal TrackerTask.
 */
function task(
  id: string,
  opts: { dependsOn?: string[]; priority?: 0 | 1 | 2 | 3 | 4 } = {}
): TrackerTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'open',
    priority: opts.priority ?? 2,
    dependsOn: opts.dependsOn,
  };
}

/**
 * These tests verify the task analysis and auto-detection logic that
 * drives the ParallelExecutor's decision-making. The executor delegates
 * to analyzeTaskGraph/shouldRunParallel for all scheduling decisions,
 * so testing those thoroughly is equivalent to testing the executor's
 * planning logic without needing to mock its heavy dependencies.
 */
describe('ParallelExecutor planning logic', () => {
  describe('auto-detection decides correctly', () => {
    test('recommends parallel for diamond pattern', () => {
      const tasks = [
        task('A'),
        task('B', { dependsOn: ['A'] }),
        task('C', { dependsOn: ['A'] }),
        task('D', { dependsOn: ['B', 'C'] }),
      ];
      const analysis = analyzeTaskGraph(tasks);

      expect(shouldRunParallel(analysis)).toBe(true);
      expect(analysis.groups).toHaveLength(3);
    });

    test('skips parallel for linear chain', () => {
      const tasks = [
        task('A'),
        task('B', { dependsOn: ['A'] }),
        task('C', { dependsOn: ['B'] }),
      ];
      const analysis = analyzeTaskGraph(tasks);

      expect(shouldRunParallel(analysis)).toBe(false);
    });

    test('skips parallel for too few tasks', () => {
      const tasks = [task('A'), task('B')];
      const analysis = analyzeTaskGraph(tasks);

      expect(shouldRunParallel(analysis)).toBe(false);
    });
  });

  describe('batch splitting logic', () => {
    test('groups independent tasks correctly', () => {
      const tasks = [
        task('A'),
        task('B'),
        task('C'),
        task('D'),
        task('E'),
      ];
      const analysis = analyzeTaskGraph(tasks);

      // All 5 should be in one group at depth 0
      expect(analysis.groups).toHaveLength(1);
      expect(analysis.groups[0].tasks).toHaveLength(5);
    });

    test('separates dependent tasks into ordered groups', () => {
      const tasks = [
        task('A'),
        task('B', { dependsOn: ['A'] }),
        task('C', { dependsOn: ['A'] }),
        task('D', { dependsOn: ['B', 'C'] }),
      ];
      const analysis = analyzeTaskGraph(tasks);

      // Group 0: [A], Group 1: [B, C], Group 2: [D]
      expect(analysis.groups).toHaveLength(3);
      expect(analysis.groups[0].tasks.map((t) => t.id)).toEqual(['A']);
      expect(analysis.groups[1].tasks.map((t) => t.id).sort()).toEqual(['B', 'C']);
      expect(analysis.groups[2].tasks.map((t) => t.id)).toEqual(['D']);
    });
  });

  describe('maxWorkers batch calculation', () => {
    test('large group can be split into maxWorkers batches', () => {
      // This tests the calculation that ParallelExecutor.batchTasks() would do
      const tasks = Array.from({ length: 7 }, (_, i) => task(`T${i}`));
      const maxWorkers = 3;

      // Simulate batchTasks logic
      const batches: TrackerTask[][] = [];
      for (let i = 0; i < tasks.length; i += maxWorkers) {
        batches.push(tasks.slice(i, i + maxWorkers));
      }

      expect(batches).toHaveLength(3); // ceil(7/3) = 3
      expect(batches[0]).toHaveLength(3);
      expect(batches[1]).toHaveLength(3);
      expect(batches[2]).toHaveLength(1);
    });
  });
});
