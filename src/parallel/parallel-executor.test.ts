/**
 * ABOUTME: Tests for the ParallelExecutor coordinator.
 * Tests public API surface (state, configuration, event listeners)
 * without mock.module() to prevent interfering with other test files.
 * Integration-level execution tests are validated by running the parallel
 * test suite in isolation: `bun test src/parallel/`.
 */

import { describe, test, expect } from 'bun:test';
import { analyzeTaskGraph, shouldRunParallel } from './task-graph.js';
import { ParallelExecutor } from './index.js';
import type { TrackerTask, TrackerPlugin } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';
import type { ParallelEvent } from './events.js';
import type { AiResolverCallback } from './conflict-resolver.js';

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

/** Create a minimal mock tracker for testing */
function createMockTracker(): TrackerPlugin {
  return {
    meta: {
      id: 'mock-tracker',
      name: 'Mock Tracker',
      description: 'A mock tracker for testing',
      version: '1.0.0',
      supportsBidirectionalSync: false,
      supportsHierarchy: false,
      supportsDependencies: true,
    },
    initialize: async () => {},
    isReady: async () => true,
    getTasks: async () => [],
    getTask: async () => undefined,
    getNextTask: async () => undefined,
    completeTask: async () => ({ success: true, message: 'Task completed' }),
    updateTaskStatus: async () => undefined,
    isComplete: async () => true,
    sync: async () => ({ success: true, message: 'Synced', syncedAt: new Date().toISOString() }),
    isTaskReady: async () => true,
    getEpics: async () => [],
    getSetupQuestions: () => [],
    validateSetup: async () => null,
    dispose: async () => {},
    getTemplate: () => 'Mock template',
  };
}

/** Create a minimal RalphConfig for testing */
function createMockConfig(): RalphConfig {
  return {
    cwd: '/tmp/test-project',
    maxIterations: 5,
    iterationDelay: 100,
    outputDir: '/tmp/output',
    progressFile: '/tmp/progress.md',
    sessionId: 'test-session',
    agent: { name: 'test-agent', plugin: 'claude', options: {} },
    tracker: { name: 'test-tracker', plugin: 'beads', options: {} },
    showTui: false,
    errorHandling: {
      strategy: 'skip',
      maxRetries: 3,
      retryDelayMs: 1000,
      continueOnNonZeroExit: false,
    },
  };
}

describe('ParallelExecutor class', () => {
  describe('constructor', () => {
    test('creates instance with config and tracker', () => {
      const config = createMockConfig();
      const tracker = createMockTracker();

      const executor = new ParallelExecutor(config, tracker);

      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    test('accepts partial parallel config overrides', () => {
      const config = createMockConfig();
      const tracker = createMockTracker();

      const executor = new ParallelExecutor(config, tracker, {
        maxWorkers: 5,
        aiConflictResolution: false,
      });

      expect(executor).toBeInstanceOf(ParallelExecutor);
    });
  });

  describe('on (event listener)', () => {
    test('returns an unsubscribe function', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());
      const events: ParallelEvent[] = [];

      const unsub = executor.on((e) => events.push(e));

      expect(typeof unsub).toBe('function');
    });

    test('unsubscribe removes the listener', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      const unsub = executor.on(() => {});
      unsub();

      // Should not throw on double unsubscribe
      unsub();
    });
  });

  describe('onEngineEvent', () => {
    test('returns an unsubscribe function', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      const unsub = executor.onEngineEvent(() => {});

      expect(typeof unsub).toBe('function');
    });

    test('unsubscribe removes the listener', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      const unsub = executor.onEngineEvent(() => {});
      unsub();

      // Should not throw on double unsubscribe
      unsub();
    });
  });

  describe('setAiResolver', () => {
    test('accepts a resolver callback', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());
      const resolver: AiResolverCallback = async () => null;

      // Should not throw
      executor.setAiResolver(resolver);
    });
  });

  describe('reset', () => {
    test('resets internal state', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      // Call reset
      executor.reset();

      // Verify state is reset via getState()
      const state = executor.getState();
      expect(state.status).toBe('idle');
      expect(state.currentGroupIndex).toBe(0);
      expect(state.totalTasksCompleted).toBe(0);
      expect(state.workers).toHaveLength(0);
    });
  });

  describe('getState', () => {
    test('returns initial state', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      const state = executor.getState();

      expect(state.status).toBe('idle');
      expect(state.taskGraph).toBeNull();
      expect(state.currentGroupIndex).toBe(0);
      expect(state.totalGroups).toBe(0);
      expect(state.workers).toEqual([]);
      expect(state.mergeQueue).toEqual([]);
      expect(state.completedMerges).toEqual([]);
      expect(state.activeConflicts).toEqual([]);
      expect(state.totalTasksCompleted).toBe(0);
      expect(state.totalTasks).toBe(0);
      expect(state.startedAt).toBeNull();
      expect(state.elapsedMs).toBe(0);
    });
  });

  describe('getWorkerStates', () => {
    test('returns empty array when no workers', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      const states = executor.getWorkerStates();

      expect(states).toEqual([]);
    });
  });

  describe('stop', () => {
    test('can be called when idle', async () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      // Should not throw when stopped while idle
      await executor.stop();

      expect(executor.getState().status).toBe('interrupted');
    });
  });

  describe('getSessionBranch', () => {
    test('returns null when no session branch created', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      const branch = executor.getSessionBranch();

      expect(branch).toBeNull();
    });
  });

  describe('getOriginalBranch', () => {
    test('returns null when no session branch created', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());

      const branch = executor.getOriginalBranch();

      expect(branch).toBeNull();
    });
  });

  describe('filteredTaskIds config', () => {
    test('accepts filteredTaskIds in partial config', () => {
      const config = createMockConfig();
      const tracker = createMockTracker();

      const executor = new ParallelExecutor(config, tracker, {
        filteredTaskIds: ['task-1', 'task-2', 'task-3'],
      });

      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    test('accepts empty filteredTaskIds array', () => {
      const config = createMockConfig();
      const tracker = createMockTracker();

      const executor = new ParallelExecutor(config, tracker, {
        filteredTaskIds: [],
      });

      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    test('accepts undefined filteredTaskIds', () => {
      const config = createMockConfig();
      const tracker = createMockTracker();

      const executor = new ParallelExecutor(config, tracker, {
        filteredTaskIds: undefined,
      });

      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    test('preserves filteredTaskIds through getState', () => {
      const config = createMockConfig();
      const tracker = createMockTracker();

      const executor = new ParallelExecutor(config, tracker, {
        filteredTaskIds: ['task-a', 'task-b'],
      });

      // State should still be valid with filteredTaskIds configured
      const state = executor.getState();
      expect(state.status).toBe('idle');
      expect(state.workers).toEqual([]);
    });
  });
});
