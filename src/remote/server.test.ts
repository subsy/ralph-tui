/**
 * ABOUTME: Tests for RemoteServer class methods.
 * Focuses on testable methods that don't require a running WebSocket server.
 */

import { describe, test, expect } from 'bun:test';
import {
  RemoteServer,
  buildRemoteScopeCounts,
  resolveExecutionScopes,
} from './server.js';
import type { RalphConfig } from '../config/types.js';
import type {
  ExecutionScope,
  TrackerPlugin,
  TrackerTask,
} from '../plugins/trackers/types.js';
import type { ParallelExecutorState } from '../parallel/types.js';

/** Create a minimal mock config for testing */
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

function createScopedTask(
  id: string,
  scope: ExecutionScope,
  status: TrackerTask['status'] = 'open'
): TrackerTask {
  return {
    id,
    title: id,
    status,
    priority: 2,
    executionScope: scope,
  } as TrackerTask & { executionScope: ExecutionScope };
}

describe('RemoteServer', () => {
  describe('constructor', () => {
    test('creates instance with minimal options', () => {
      const server = new RemoteServer({
        port: 7890,
        hasToken: false,
      });

      expect(server).toBeInstanceOf(RemoteServer);
    });

    test('creates instance with hasToken true', () => {
      const server = new RemoteServer({
        port: 8080,
        hasToken: true,
        maxPortRetries: 5,
        cwd: '/tmp/test',
      });

      expect(server).toBeInstanceOf(RemoteServer);
    });
  });

  describe('setTracker', () => {
    test('sets tracker instance', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });
      const tracker = createMockTracker();

      // Should not throw
      server.setTracker(tracker);
    });
  });

  describe('setParallelConfig', () => {
    test('sets parallel config for orchestration', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });
      const config = createMockConfig();
      const tracker = createMockTracker();

      // Should not throw
      server.setParallelConfig({ baseConfig: config, tracker });
    });
  });

  describe('actualPort getter', () => {
    test('returns null when server not started', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });

      expect(server.actualPort).toBeNull();
    });
  });

  describe('multi-epic orchestration helpers', () => {
    test('resolves requested epic IDs to execution scopes in requested order', async () => {
      const tracker = {
        ...createMockTracker(),
        getEpics: async () => [
          {
            id: 'backend',
            title: 'Backend Epic',
            type: 'epic',
            status: 'open',
            priority: 2,
          },
          {
            id: 'ui',
            title: 'UI Epic',
            type: 'epic',
            status: 'open',
            priority: 2,
          },
        ],
      } as TrackerPlugin;

      const scopes = await resolveExecutionScopes(tracker, ['ui', 'missing', 'backend']);

      expect(scopes).toEqual([
        expect.objectContaining({ id: 'ui', title: 'UI Epic', type: 'epic' }),
        expect.objectContaining({ id: 'missing', title: 'missing', type: 'epic' }),
        expect.objectContaining({ id: 'backend', title: 'Backend Epic', type: 'epic' }),
      ]);
    });

    test('builds per-scope counts from graph, workers, and merge queue', () => {
      const ui: ExecutionScope = { id: 'ui', title: 'UI', type: 'epic' };
      const backend: ExecutionScope = { id: 'backend', title: 'Backend', type: 'epic' };
      const uiTask = createScopedTask('ui-task', ui);
      const backendTask = createScopedTask('backend-task', backend);
      const failedTask = createScopedTask('backend-failed', backend);

      const state = {
        scopes: [ui, backend],
        taskGraph: {
          nodes: new Map([
            ['ui-task', {
              task: uiTask,
              dependencies: [],
              dependents: [],
              depth: 0,
              inCycle: false,
            }],
            ['backend-task', {
              task: backendTask,
              dependencies: [],
              dependents: [],
              depth: 0,
              inCycle: false,
            }],
          ]),
          groups: [],
          cyclicTaskIds: [],
          actionableTaskCount: 2,
          maxParallelism: 2,
          recommendParallel: true,
        },
        workers: [
          {
            id: 'worker-1',
            status: 'running',
            task: uiTask,
            currentIteration: 1,
            maxIterations: 5,
            lastOutput: '',
            elapsedMs: 100,
          },
          {
            id: 'worker-2',
            status: 'failed',
            task: failedTask,
            currentIteration: 2,
            maxIterations: 5,
            lastOutput: '',
            elapsedMs: 200,
          },
        ],
        workerResults: [
          {
            workerId: 'worker-4',
            task: uiTask,
            success: false,
            iterationsRun: 1,
            taskCompleted: false,
            durationMs: 150,
            error: 'worker failed',
            branchName: 'ralph-parallel/session/ui/ui-task',
            commitCount: 0,
          },
        ],
        mergeQueue: [
          {
            id: 'merge-1',
            workerResult: {
              workerId: 'worker-3',
              task: backendTask,
              success: true,
              iterationsRun: 1,
              taskCompleted: true,
              durationMs: 300,
              branchName: 'ralph-parallel/session/backend/backend-task',
              commitCount: 1,
            },
            status: 'completed',
            backupTag: 'backup',
            sourceBranch: 'ralph-parallel/session/backend/backend-task',
            commitMessage: 'complete backend-task',
            queuedAt: new Date().toISOString(),
          },
        ],
      } as Partial<ParallelExecutorState> as ParallelExecutorState;

      expect(buildRemoteScopeCounts(state)).toEqual([
        {
          scopeId: 'ui',
          totalTasks: 1,
          activeTasks: 1,
          completedTasks: 0,
          failedTasks: 1,
        },
        {
          scopeId: 'backend',
          totalTasks: 1,
          activeTasks: 0,
          completedTasks: 1,
          failedTasks: 1,
        },
      ]);
    });

    test('omits per-scope counts for single-scope state', () => {
      const scope: ExecutionScope = { id: 'ui', title: 'UI', type: 'epic' };
      const state = {
        scopes: [scope],
        taskGraph: null,
        workers: [],
        workerResults: [],
        mergeQueue: [],
      } as Partial<ParallelExecutorState> as ParallelExecutorState;

      expect(buildRemoteScopeCounts(state)).toBeUndefined();
    });
  });
});
