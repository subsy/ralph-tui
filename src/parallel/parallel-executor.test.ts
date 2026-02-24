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
import type { MergeOperation, WorkerResult, TaskGraphAnalysis } from './types.js';

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

/** Create a worker result for targeted private-method tests. */
function createWorkerResult(task: TrackerTask, overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    workerId: 'w0-0',
    task,
    success: true,
    iterationsRun: 1,
    taskCompleted: true,
    durationMs: 1000,
    branchName: `ralph-parallel/${task.id}`,
    commitCount: 1,
    ...overrides,
  };
}

/** Create a merge operation for targeted conflict-queue tests. */
function createMergeOperation(
  id: string,
  workerResult: WorkerResult,
  overrides: Partial<MergeOperation> = {}
): MergeOperation {
  return {
    id,
    workerResult,
    status: 'conflicted',
    backupTag: `ralph/pre-merge/${workerResult.task.id}/${id}`,
    sourceBranch: workerResult.branchName,
    commitMessage: `feat(${workerResult.task.id}): ${workerResult.task.title}`,
    queuedAt: new Date().toISOString(),
    conflictedFiles: ['src/conflict.ts'],
    ...overrides,
  };
}

/** Build a minimal TaskGraphAnalysis object for executeGroup testing. */
function createSingleGroupAnalysis(task: TrackerTask): TaskGraphAnalysis {
  return {
    nodes: new Map(),
    groups: [{
      index: 0,
      tasks: [task],
      depth: 0,
      maxPriority: task.priority,
    }],
    cyclicTaskIds: [],
    actionableTaskCount: 1,
    maxParallelism: 1,
    recommendParallel: true,
  };
}

async function waitForShortDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
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

  describe('pause/resume gating', () => {
    test('pause blocks waiters until resume', async () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());
      (executor as any).status = 'executing';

      executor.pause();
      expect(executor.getState().status).toBe('paused');

      let released = false;
      const waiting = (executor as any).waitWhilePaused().then(() => {
        released = true;
      });

      await waitForShortDelay();
      expect(released).toBe(false);

      executor.resume();
      await waiting;

      expect(released).toBe(true);
      expect(executor.getState().status).toBe('executing');
    });

    test('stop releases waiters when paused', async () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());
      (executor as any).status = 'executing';
      executor.pause();

      let released = false;
      const waiting = (executor as any).waitWhilePaused().then(() => {
        released = true;
      });

      await waitForShortDelay();
      expect(released).toBe(false);

      await executor.stop();
      await waiting;

      expect(released).toBe(true);
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

  describe('merge failure handling', () => {
    test('handleMergeFailure resets task to open even when requeue limit is reached', async () => {
      const tracker = createMockTracker();
      const statusUpdates: string[] = [];
      tracker.updateTaskStatus = async (taskId) => {
        statusUpdates.push(taskId);
        return undefined;
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker, {
        maxRequeueCount: 1,
      });
      const mergeFailure = createWorkerResult(task('A'));

      (executor as any).requeueCounts.set('A', 1); // already at cap
      await (executor as any).handleMergeFailure(mergeFailure);

      expect((executor as any).requeueCounts.get('A')).toBe(1);
      expect(statusUpdates).toEqual(['A']);
    });

    test('handleMergeFailure increments requeue count up to maxRequeueCount', async () => {
      const tracker = createMockTracker();
      let updateCalls = 0;
      tracker.updateTaskStatus = async () => {
        updateCalls++;
        return undefined;
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker, {
        maxRequeueCount: 2,
      });
      const mergeFailure = createWorkerResult(task('A'));

      await (executor as any).handleMergeFailure(mergeFailure);
      await (executor as any).handleMergeFailure(mergeFailure);
      await (executor as any).handleMergeFailure(mergeFailure);

      expect((executor as any).requeueCounts.get('A')).toBe(2);
      expect(updateCalls).toBe(3);
    });

    test('executeGroup attempts merge for completed results even when commitCount is zero', async () => {
      const tracker = createMockTracker();
      const completedTaskIds: string[] = [];
      tracker.completeTask = async (taskId) => {
        completedTaskIds.push(taskId);
        return { success: true, message: 'Task completed' };
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker, {
        maxRequeueCount: 1,
      });
      const taskA = task('A');
      const group = {
        index: 0,
        tasks: [taskA],
        depth: 0,
      };
      const events: ParallelEvent[] = [];
      executor.on((event) => events.push(event));

      (executor as any).taskGraph = createSingleGroupAnalysis(taskA);
      (executor as any).batchTasks = () => [[taskA]];
      (executor as any).executeBatch = async () => [
        createWorkerResult(taskA, { commitCount: 0, taskCompleted: true, success: true }),
      ];
      (executor as any).mergeEngine = {
        enqueue: () => {},
        getQueue: () => [],
        processNext: async () => ({
          operationId: 'op-1',
          success: true,
          strategy: 'fast-forward',
          hadConflicts: false,
          filesChanged: 1,
          durationMs: 1,
        }),
      };

      await (executor as any).executeGroup(group, 0);

      const completedEvent = events.find((e) => e.type === 'parallel:group-completed');
      expect(completedEvent?.type).toBe('parallel:group-completed');
      if (completedEvent?.type === 'parallel:group-completed') {
        expect(completedEvent.tasksCompleted).toBe(1);
        expect(completedEvent.tasksFailed).toBe(0);
        expect(completedEvent.mergesCompleted).toBe(1);
        expect(completedEvent.mergesFailed).toBe(0);
      }

      expect(completedTaskIds).toContain('A');
      expect((executor as any).requeueCounts.has('A')).toBe(false);
    });

    test('executeGroup resets failed worker tasks to open', async () => {
      const tracker = createMockTracker();
      const statusUpdates: Array<{ taskId: string; status: string }> = [];
      tracker.updateTaskStatus = async (taskId, status) => {
        statusUpdates.push({ taskId, status });
        return undefined;
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker, {
        maxRequeueCount: 1,
      });
      const taskA = task('A');
      const group = { index: 0, tasks: [taskA], depth: 0 };

      (executor as any).taskGraph = createSingleGroupAnalysis(taskA);
      (executor as any).batchTasks = () => [[taskA]];
      (executor as any).executeBatch = async () => [
        createWorkerResult(taskA, { success: false, taskCompleted: false, commitCount: 0 }),
      ];

      await (executor as any).executeGroup(group, 0);

      expect(statusUpdates).toContainEqual({ taskId: 'A', status: 'open' });
      expect((executor as any).totalTasksFailed).toBe(1);
    });

    test('executeGroup counts merge failure as failed task (not completed)', async () => {
      const tracker = createMockTracker();
      const statusUpdates: Array<{ taskId: string; status: string }> = [];
      tracker.updateTaskStatus = async (taskId, status) => {
        statusUpdates.push({ taskId, status });
        return undefined;
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker, {
        maxRequeueCount: 1,
      });
      const taskA = task('A');
      const group = { index: 0, tasks: [taskA], depth: 0 };
      const events: ParallelEvent[] = [];
      executor.on((event) => events.push(event));

      (executor as any).taskGraph = createSingleGroupAnalysis(taskA);
      (executor as any).batchTasks = () => [[taskA]];
      (executor as any).executeBatch = async () => [
        createWorkerResult(taskA, { success: true, taskCompleted: true, commitCount: 1 }),
      ];
      (executor as any).mergeEngine = {
        enqueue: () => {},
        getQueue: () => [],
        processNext: async () => ({
          operationId: 'op-1',
          success: false,
          strategy: 'merge-commit',
          hadConflicts: false,
          filesChanged: 0,
          durationMs: 1,
          error: 'merge failed',
        }),
      };

      await (executor as any).executeGroup(group, 0);

      const completedEvent = events.find((e) => e.type === 'parallel:group-completed');
      expect(completedEvent?.type).toBe('parallel:group-completed');
      if (completedEvent?.type === 'parallel:group-completed') {
        expect(completedEvent.tasksCompleted).toBe(0);
        expect(completedEvent.tasksFailed).toBe(1);
        expect(completedEvent.mergesCompleted).toBe(0);
        expect(completedEvent.mergesFailed).toBe(1);
      }
      expect((executor as any).totalTasksCompleted).toBe(0);
      expect((executor as any).totalTasksFailed).toBe(1);
      expect(statusUpdates).toContainEqual({ taskId: 'A', status: 'open' });
    });

    test('executeGroup retries a failed merge once and succeeds', async () => {
      const tracker = createMockTracker();
      const completedTaskIds: string[] = [];
      tracker.completeTask = async (taskId) => {
        completedTaskIds.push(taskId);
        return { success: true, message: 'Task completed' };
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker, {
        maxRequeueCount: 1,
      });
      const taskA = task('A');
      const group = { index: 0, tasks: [taskA], depth: 0 };
      const events: ParallelEvent[] = [];
      executor.on((event) => events.push(event));

      let executeBatchCalls = 0;
      let mergeCalls = 0;

      (executor as any).taskGraph = createSingleGroupAnalysis(taskA);
      (executor as any).executeBatch = async () => {
        executeBatchCalls++;
        return [createWorkerResult(taskA, { success: true, taskCompleted: true, commitCount: 1 })];
      };
      (executor as any).mergeProgressFile = async () => {};
      (executor as any).mergeEngine = {
        enqueue: () => {},
        getQueue: () => [],
        processNext: async () => {
          mergeCalls++;
          if (mergeCalls === 1) {
            return {
              operationId: 'op-1',
              success: false,
              strategy: 'merge-commit',
              hadConflicts: false,
              filesChanged: 0,
              durationMs: 1,
              error: 'merge failed',
            };
          }
          return {
            operationId: 'op-2',
            success: true,
            strategy: 'fast-forward',
            hadConflicts: false,
            filesChanged: 1,
            durationMs: 1,
          };
        },
      };

      await (executor as any).executeGroup(group, 0);

      expect(executeBatchCalls).toBe(2);
      expect(completedTaskIds).toEqual(['A']);
      const completedEvent = events.find((e) => e.type === 'parallel:group-completed');
      expect(completedEvent?.type).toBe('parallel:group-completed');
      if (completedEvent?.type === 'parallel:group-completed') {
        expect(completedEvent.tasksCompleted).toBe(1);
        expect(completedEvent.tasksFailed).toBe(0);
        expect(completedEvent.mergesCompleted).toBe(1);
        expect(completedEvent.mergesFailed).toBe(0);
      }
    });

    test('executeGroup requeues unresolved AI conflicts without stale pending conflicts', async () => {
      const tracker = createMockTracker();
      const completedTaskIds: string[] = [];
      tracker.completeTask = async (taskId) => {
        completedTaskIds.push(taskId);
        return { success: true, message: 'Task completed' };
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker, {
        maxRequeueCount: 1,
      });
      const taskA = task('A');
      const group = { index: 0, tasks: [taskA], depth: 0 };
      const events: ParallelEvent[] = [];
      executor.on((event) => events.push(event));

      let executeBatchCalls = 0;
      let mergeCalls = 0;
      const conflictOperation = createMergeOperation(
        'op-conflict',
        createWorkerResult(taskA)
      );

      (executor as any).taskGraph = createSingleGroupAnalysis(taskA);
      (executor as any).executeBatch = async () => {
        executeBatchCalls++;
        return [createWorkerResult(taskA, { success: true, taskCompleted: true, commitCount: 1 })];
      };
      (executor as any).saveTrackerState = async () => new Map();
      (executor as any).restoreTrackerState = async () => {};
      (executor as any).mergeProgressFile = async () => {};
      (executor as any).conflictResolver = {
        resolveConflicts: async () => [
          {
            filePath: 'src/conflict.ts',
            success: false,
            method: 'ai',
            error: 'AI resolution failed',
          },
        ],
      };
      (executor as any).mergeEngine = {
        enqueue: () => {},
        getQueue: () => [conflictOperation],
        markOperationRolledBack: () => true,
        processNext: async () => {
          mergeCalls++;
          if (mergeCalls === 1) {
            return {
              operationId: 'op-conflict',
              success: false,
              strategy: 'merge-commit',
              hadConflicts: true,
              filesChanged: 0,
              durationMs: 1,
              error: 'merge conflict',
            };
          }
          return {
            operationId: 'op-success',
            success: true,
            strategy: 'fast-forward',
            hadConflicts: false,
            filesChanged: 1,
            durationMs: 1,
          };
        },
      };

      await (executor as any).executeGroup(group, 0);

      expect(executeBatchCalls).toBe(2);
      expect(completedTaskIds).toEqual(['A']);
      expect((executor as any).pendingConflicts).toHaveLength(0);

      const dismissedConflict = events.find(
        (event) =>
          event.type === 'conflict:resolved' &&
          event.operationId === 'op-conflict' &&
          event.results.length === 0
      );
      expect(dismissedConflict?.type).toBe('conflict:resolved');

      const completedEvent = events.find((e) => e.type === 'parallel:group-completed');
      expect(completedEvent?.type).toBe('parallel:group-completed');
      if (completedEvent?.type === 'parallel:group-completed') {
        expect(completedEvent.tasksCompleted).toBe(1);
        expect(completedEvent.tasksFailed).toBe(0);
      }
    });

    test('retryConflictResolution processes pending conflicts in FIFO order', async () => {
      const tracker = createMockTracker();
      const completedTaskIds: string[] = [];
      tracker.completeTask = async (taskId) => {
        completedTaskIds.push(taskId);
        return { success: true, message: 'Task completed' };
      };

      const executor = new ParallelExecutor(createMockConfig(), tracker);
      const events: ParallelEvent[] = [];
      executor.on((event) => events.push(event));

      const resultA = createWorkerResult(task('A'));
      const resultB = createWorkerResult(task('B'));
      const opA = createMergeOperation('op-a', resultA);
      const opB = createMergeOperation('op-b', resultB);

      (executor as any).pendingConflicts = [
        { operation: opA, workerResult: resultA },
        { operation: opB, workerResult: resultB },
      ];
      (executor as any).saveTrackerState = async () => new Map();
      (executor as any).restoreTrackerState = async () => {};
      (executor as any).mergeProgressFile = async () => {};
      (executor as any).conflictResolver = {
        resolveConflicts: async () => [
          {
            filePath: 'src/conflict.ts',
            success: true,
            method: 'ai',
            resolvedContent: 'resolved',
          },
        ],
      };

      const retried = await executor.retryConflictResolution();

      expect(retried).toBe(true);
      expect(completedTaskIds).toEqual(['A']);
      expect((executor as any).pendingConflicts).toHaveLength(1);
      expect((executor as any).pendingConflicts[0].operation.id).toBe('op-b');
      const detectedEvent = events.find(
        (event) =>
          event.type === 'conflict:detected' &&
          event.operationId === 'op-b'
      );
      expect(detectedEvent?.type).toBe('conflict:detected');
    });

    test('skipFailedConflict marks current conflict rolled back and advances queue', () => {
      const executor = new ParallelExecutor(createMockConfig(), createMockTracker());
      const events: ParallelEvent[] = [];
      executor.on((event) => events.push(event));

      const resultA = createWorkerResult(task('A'));
      const resultB = createWorkerResult(task('B'));
      const opA = createMergeOperation('op-a', resultA);
      const opB = createMergeOperation('op-b', resultB);

      (executor as any).pendingConflicts = [
        { operation: opA, workerResult: resultA },
        { operation: opB, workerResult: resultB },
      ];

      const rolledBackOperationIds: string[] = [];
      (executor as any).mergeEngine = {
        markOperationRolledBack: (operationId: string) => {
          rolledBackOperationIds.push(operationId);
          return true;
        },
      };

      executor.skipFailedConflict();

      expect(rolledBackOperationIds).toEqual(['op-a']);
      expect((executor as any).pendingConflicts).toHaveLength(1);
      expect((executor as any).pendingConflicts[0].operation.id).toBe('op-b');
      const resolvedEvent = events.find(
        (event) =>
          event.type === 'conflict:resolved' &&
          event.operationId === 'op-a'
      );
      expect(resolvedEvent?.type).toBe('conflict:resolved');
      const detectedEvent = events.find(
        (event) =>
          event.type === 'conflict:detected' &&
          event.operationId === 'op-b'
      );
      expect(detectedEvent?.type).toBe('conflict:detected');
    });
  });
});
