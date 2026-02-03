/**
 * ABOUTME: Tests for task dependency graph analysis (Kahn's algorithm).
 * Verifies topological sort, cycle detection, parallel group computation,
 * and the auto-detection heuristic for deciding when parallel execution is worthwhile.
 */

import { describe, test, expect } from 'bun:test';
import { analyzeTaskGraph, shouldRunParallel, recommendParallelism } from './task-graph.js';
import type { TrackerTask } from '../plugins/trackers/types.js';

/**
 * Helper to create a minimal TrackerTask for testing.
 */
function task(
  id: string,
  opts: { dependsOn?: string[]; blocks?: string[]; priority?: 0 | 1 | 2 | 3 | 4 } = {}
): TrackerTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'open',
    priority: opts.priority ?? 2,
    dependsOn: opts.dependsOn,
    blocks: opts.blocks,
  };
}

describe('analyzeTaskGraph', () => {
  test('handles an empty task list', () => {
    const result = analyzeTaskGraph([]);

    expect(result.nodes.size).toBe(0);
    expect(result.groups).toHaveLength(0);
    expect(result.cyclicTaskIds).toHaveLength(0);
    expect(result.actionableTaskCount).toBe(0);
    expect(result.maxParallelism).toBe(0);
    expect(result.recommendParallel).toBe(false);
  });

  test('handles a single task', () => {
    const result = analyzeTaskGraph([task('A')]);

    expect(result.nodes.size).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].tasks).toHaveLength(1);
    expect(result.groups[0].tasks[0].id).toBe('A');
    expect(result.groups[0].depth).toBe(0);
    expect(result.cyclicTaskIds).toHaveLength(0);
    expect(result.actionableTaskCount).toBe(1);
    expect(result.recommendParallel).toBe(false); // Not enough tasks
  });

  test('groups independent tasks at the same depth', () => {
    const tasks = [task('A'), task('B'), task('C')];
    const result = analyzeTaskGraph(tasks);

    // All independent tasks should be at depth 0 in one group
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].tasks).toHaveLength(3);
    expect(result.groups[0].depth).toBe(0);
    expect(result.maxParallelism).toBe(3);
  });

  test('creates sequential groups for linear dependency chain', () => {
    // A → B → C (C depends on B, B depends on A)
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['B'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.groups).toHaveLength(3);
    expect(result.groups[0].tasks[0].id).toBe('A');
    expect(result.groups[0].depth).toBe(0);
    expect(result.groups[1].tasks[0].id).toBe('B');
    expect(result.groups[1].depth).toBe(1);
    expect(result.groups[2].tasks[0].id).toBe('C');
    expect(result.groups[2].depth).toBe(2);
    expect(result.maxParallelism).toBe(1);
    expect(result.recommendParallel).toBe(false); // No parallel group has ≥2 tasks
  });

  test('detects diamond dependency pattern', () => {
    //       A
    //      / \
    //     B   C
    //      \ /
    //       D
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['A'] }),
      task('D', { dependsOn: ['B', 'C'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    // Depth 0: A | Depth 1: B, C (parallel) | Depth 2: D
    expect(result.groups).toHaveLength(3);
    expect(result.groups[0].tasks.map((t) => t.id)).toEqual(['A']);
    expect(result.groups[1].tasks.map((t) => t.id).sort()).toEqual(['B', 'C']);
    expect(result.groups[2].tasks.map((t) => t.id)).toEqual(['D']);
    expect(result.maxParallelism).toBe(2);
  });

  test('handles the blocks field (reverse direction)', () => {
    // A blocks B and C (meaning B and C depend on A)
    const tasks = [
      task('A', { blocks: ['B', 'C'] }),
      task('B'),
      task('C'),
    ];
    const result = analyzeTaskGraph(tasks);

    // A should be at depth 0, B and C at depth 1
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].tasks[0].id).toBe('A');
    expect(result.groups[1].tasks.map((t) => t.id).sort()).toEqual(['B', 'C']);
  });

  test('handles both dependsOn and blocks simultaneously', () => {
    // A blocks B (B depends on A) + C dependsOn A
    const tasks = [
      task('A', { blocks: ['B'] }),
      task('B'),
      task('C', { dependsOn: ['A'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].tasks[0].id).toBe('A');
    expect(result.groups[1].tasks.map((t) => t.id).sort()).toEqual(['B', 'C']);
  });

  test('ignores dependencies on tasks outside the input set', () => {
    // B depends on 'X' which doesn't exist in our task set
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['X'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    // Both A and B should be at depth 0 since X doesn't exist
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].tasks).toHaveLength(2);
  });

  test('detects a simple cycle (A ↔ B)', () => {
    const tasks = [
      task('A', { dependsOn: ['B'] }),
      task('B', { dependsOn: ['A'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.cyclicTaskIds.sort()).toEqual(['A', 'B']);
    expect(result.groups).toHaveLength(0); // Cyclic tasks excluded from groups
    expect(result.actionableTaskCount).toBe(0);
    expect(result.recommendParallel).toBe(false);
  });

  test('detects a 3-node cycle', () => {
    // A → B → C → A
    const tasks = [
      task('A', { dependsOn: ['C'] }),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['B'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.cyclicTaskIds.sort()).toEqual(['A', 'B', 'C']);
    expect(result.actionableTaskCount).toBe(0);
  });

  test('isolates cyclic tasks from non-cyclic tasks', () => {
    // D and E are independent, A ↔ B form a cycle
    const tasks = [
      task('A', { dependsOn: ['B'] }),
      task('B', { dependsOn: ['A'] }),
      task('D'),
      task('E'),
      task('F'),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.cyclicTaskIds.sort()).toEqual(['A', 'B']);
    // D, E, F should form a group at depth 0
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].tasks).toHaveLength(3);
    expect(result.actionableTaskCount).toBe(3);
  });

  test('sorts tasks within a group by priority', () => {
    const tasks = [
      task('A', { priority: 3 }),
      task('B', { priority: 1 }),
      task('C', { priority: 2 }),
    ];
    const result = analyzeTaskGraph(tasks);

    // Within the group, tasks should be sorted by priority (lower = higher priority)
    const groupIds = result.groups[0].tasks.map((t) => t.id);
    expect(groupIds).toEqual(['B', 'C', 'A']);
  });

  test('computes maxPriority for each group', () => {
    const tasks = [
      task('A', { priority: 3 }),
      task('B', { priority: 1 }),
    ];
    const result = analyzeTaskGraph(tasks);

    // maxPriority should be the highest priority (lowest number) in the group
    expect(result.groups[0].maxPriority).toBe(1);
  });

  test('handles a wide fan-out pattern', () => {
    // A is the root, B through G all depend on A
    const dependents = ['B', 'C', 'D', 'E', 'F', 'G'];
    const tasks = [
      task('A'),
      ...dependents.map((id) => task(id, { dependsOn: ['A'] })),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].tasks).toHaveLength(1); // A
    expect(result.groups[1].tasks).toHaveLength(6); // B through G
    expect(result.maxParallelism).toBe(6);
  });

  test('handles a wide fan-in pattern', () => {
    // B through G all feed into A (A depends on all of them)
    const dependencies = ['B', 'C', 'D', 'E', 'F', 'G'];
    const tasks = [
      task('A', { dependsOn: dependencies }),
      ...dependencies.map((id) => task(id)),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].tasks).toHaveLength(6); // B through G (depth 0)
    expect(result.groups[1].tasks).toHaveLength(1); // A (depth 1)
    expect(result.maxParallelism).toBe(6);
  });

  test('assigns correct depth indices to groups', () => {
    // A (d0) → B (d1) → C (d2), D (d0) is independent
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['B'] }),
      task('D'),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.groups).toHaveLength(3);
    expect(result.groups[0].index).toBe(0);
    expect(result.groups[1].index).toBe(1);
    expect(result.groups[2].index).toBe(2);

    // Group at depth 0 should have both A and D
    expect(result.groups[0].tasks.map((t) => t.id).sort()).toEqual(['A', 'D']);
  });

  test('correctly sets node dependency and dependent lists', () => {
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['A'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    const nodeA = result.nodes.get('A')!;
    const nodeB = result.nodes.get('B')!;
    const nodeC = result.nodes.get('C')!;

    expect(nodeA.dependencies).toHaveLength(0);
    expect(nodeA.dependents.sort()).toEqual(['B', 'C']);

    expect(nodeB.dependencies).toEqual(['A']);
    expect(nodeB.dependents).toHaveLength(0);

    expect(nodeC.dependencies).toEqual(['A']);
    expect(nodeC.dependents).toHaveLength(0);
  });

  test('marks cyclic nodes with inCycle flag', () => {
    const tasks = [
      task('A', { dependsOn: ['B'] }),
      task('B', { dependsOn: ['A'] }),
      task('C'),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.nodes.get('A')!.inCycle).toBe(true);
    expect(result.nodes.get('B')!.inCycle).toBe(true);
    expect(result.nodes.get('C')!.inCycle).toBe(false);
  });

  test('sets correct depths on non-cyclic nodes', () => {
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['B'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    expect(result.nodes.get('A')!.depth).toBe(0);
    expect(result.nodes.get('B')!.depth).toBe(1);
    expect(result.nodes.get('C')!.depth).toBe(2);
  });

  test('avoids duplicate edges from blocks + dependsOn overlap', () => {
    // A blocks B AND B dependsOn A (same edge declared from both sides)
    const tasks = [
      task('A', { blocks: ['B'] }),
      task('B', { dependsOn: ['A'] }),
    ];
    const result = analyzeTaskGraph(tasks);

    const nodeB = result.nodes.get('B')!;
    // Should have exactly one dependency on A, not two
    expect(nodeB.dependencies).toEqual(['A']);
  });
});

describe('shouldRunParallel', () => {
  test('returns true for diamond pattern (4 tasks, parallelism ≥ 2)', () => {
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['A'] }),
      task('D', { dependsOn: ['B', 'C'] }),
    ];
    const analysis = analyzeTaskGraph(tasks);
    expect(shouldRunParallel(analysis)).toBe(true);
  });

  test('returns false for linear chain (no parallel groups)', () => {
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['B'] }),
    ];
    const analysis = analyzeTaskGraph(tasks);
    expect(shouldRunParallel(analysis)).toBe(false);
  });

  test('returns false for fewer than 3 actionable tasks', () => {
    const tasks = [task('A'), task('B')];
    const analysis = analyzeTaskGraph(tasks);
    expect(shouldRunParallel(analysis)).toBe(false);
  });

  test('returns false when >50% tasks are cyclic', () => {
    // 2 cyclic + 2 independent = 50% cyclic (not > 50%)
    // Let's make 3 cyclic + 2 independent = 60% cyclic
    const tasks = [
      task('A', { dependsOn: ['C'] }),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['B'] }),
      task('D'),
      task('E'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    // 3 cyclic out of 5 = 60%, and only 2 actionable (< 3)
    expect(shouldRunParallel(analysis)).toBe(false);
  });

  test('returns true for 3+ independent tasks', () => {
    const tasks = [task('A'), task('B'), task('C')];
    const analysis = analyzeTaskGraph(tasks);
    expect(shouldRunParallel(analysis)).toBe(true);
  });

  test('returns true for fan-out with enough independent tasks', () => {
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['A'] }),
      task('D', { dependsOn: ['A'] }),
    ];
    const analysis = analyzeTaskGraph(tasks);
    expect(shouldRunParallel(analysis)).toBe(true);
  });

  test('returns false for all tasks in a single cycle', () => {
    const tasks = [
      task('A', { dependsOn: ['B'] }),
      task('B', { dependsOn: ['C'] }),
      task('C', { dependsOn: ['A'] }),
    ];
    const analysis = analyzeTaskGraph(tasks);
    expect(shouldRunParallel(analysis)).toBe(false);
  });
});

describe('recommendParallelism', () => {
  /**
   * Helper to create a task with optional labels and title patterns.
   */
  function taskWithLabels(
    id: string,
    title: string,
    labels?: string[],
    metadata?: { affects?: string[] }
  ): TrackerTask {
    return {
      id,
      title,
      status: 'open',
      priority: 2,
      labels,
      metadata,
    };
  }

  test('returns low confidence with no specific patterns detected', () => {
    const tasks = [
      taskWithLabels('1', 'Implement feature A'),
      taskWithLabels('2', 'Implement feature B'),
      taskWithLabels('3', 'Implement feature C'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    expect(result.recommendedWorkers).toBe(4);
    expect(result.confidence).toBe('low');
    expect(result.reason).toBe('No specific patterns detected');
  });

  test('returns high confidence for mostly test tasks (by title)', () => {
    const tasks = [
      taskWithLabels('1', 'Write unit tests for auth'),
      taskWithLabels('2', 'Add integration test for API'),
      taskWithLabels('3', 'Test edge cases in parser'),
      taskWithLabels('4', 'Implement feature X'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    expect(result.recommendedWorkers).toBe(4);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('test tasks');
  });

  test('returns high confidence for mostly test tasks (by label)', () => {
    const tasks = [
      taskWithLabels('1', 'Add coverage for module A', ['test', 'unit']),
      taskWithLabels('2', 'Coverage for module B', ['test']),
      taskWithLabels('3', 'Module C coverage', ['testing']),
      taskWithLabels('4', 'Feature implementation'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    expect(result.recommendedWorkers).toBe(4);
    expect(result.confidence).toBe('high');
  });

  test('returns high confidence with reduced workers for mostly refactor tasks (by title)', () => {
    const tasks = [
      taskWithLabels('1', 'Refactor authentication module'),
      taskWithLabels('2', 'Refactor database layer'),
      taskWithLabels('3', 'Refactor API handlers'),
      taskWithLabels('4', 'Fix bug in parser'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    expect(result.recommendedWorkers).toBe(2);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('refactor');
  });

  test('returns high confidence with reduced workers for refactor tasks (by label)', () => {
    const tasks = [
      taskWithLabels('1', 'Clean up code', ['refactor']),
      taskWithLabels('2', 'Improve structure', ['refactoring']),
      taskWithLabels('3', 'Reorganize modules', ['refactor']),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    expect(result.recommendedWorkers).toBe(2);
    expect(result.confidence).toBe('high');
  });

  test('returns medium confidence for moderate refactor presence (>25% but ≤50%)', () => {
    const tasks = [
      taskWithLabels('1', 'Refactor module A'),
      taskWithLabels('2', 'Refactor module B'),
      taskWithLabels('3', 'Implement feature C'),
      taskWithLabels('4', 'Implement feature D'),
      taskWithLabels('5', 'Implement feature E'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    // 40% refactor ratio (2/5) → moderate reduction
    expect(result.recommendedWorkers).toBe(3); // floor(4 * 0.75) = 3
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('Some refactor');
  });

  test('returns medium confidence for significant file overlap', () => {
    const tasks = [
      taskWithLabels('1', 'Task A', [], { affects: ['src/auth.ts', 'src/db.ts'] }),
      taskWithLabels('2', 'Task B', [], { affects: ['src/auth.ts', 'src/api.ts'] }),
      taskWithLabels('3', 'Task C', [], { affects: ['src/db.ts', 'src/models.ts'] }),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    // 2 overlaps (auth.ts, db.ts) out of 3 tasks = 66% overlap
    expect(result.recommendedWorkers).toBe(2); // floor(4 * 0.5) = 2
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('file overlap');
  });

  test('returns low confidence for empty task list', () => {
    const tasks: TrackerTask[] = [];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    expect(result.recommendedWorkers).toBe(4);
    expect(result.confidence).toBe('low');
    expect(result.reason).toBe('No tasks to analyze');
  });

  test('respects defaultMax ceiling for refactor reduction', () => {
    const tasks = [
      taskWithLabels('1', 'Refactor A'),
      taskWithLabels('2', 'Refactor B'),
      taskWithLabels('3', 'Refactor C'),
    ];
    const analysis = analyzeTaskGraph(tasks);

    // With defaultMax of 1, should not exceed 1
    const result = recommendParallelism(tasks, analysis, 1);
    expect(result.recommendedWorkers).toBe(1);
  });

  test('respects defaultMax ceiling for overlap reduction', () => {
    const tasks = [
      taskWithLabels('1', 'Task A', [], { affects: ['file.ts'] }),
      taskWithLabels('2', 'Task B', [], { affects: ['file.ts'] }),
    ];
    const analysis = analyzeTaskGraph(tasks);

    // With defaultMax of 1, should not exceed 1
    const result = recommendParallelism(tasks, analysis, 1);
    expect(result.recommendedWorkers).toBeLessThanOrEqual(1);
  });

  test('prioritizes refactor detection over test detection', () => {
    // If >50% refactor, even with some test tasks, reduce parallelism
    const tasks = [
      taskWithLabels('1', 'Refactor auth module'),
      taskWithLabels('2', 'Refactor db module'),
      taskWithLabels('3', 'Write tests for new features'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    // 66% refactor → should reduce
    expect(result.recommendedWorkers).toBe(2);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('refactor');
  });

  test('case insensitive matching for test/refactor keywords', () => {
    const tasks = [
      taskWithLabels('1', 'TEST module A'),
      taskWithLabels('2', 'Testing module B'),
      taskWithLabels('3', 'TESTING module C'),
    ];
    const analysis = analyzeTaskGraph(tasks);
    const result = recommendParallelism(tasks, analysis, 4);

    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('test');
  });
});
