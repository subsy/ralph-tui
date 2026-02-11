/**
 * ABOUTME: Execution tests for ParallelExecutor using spyOn.
 * This approach is safer than mock.module() as it doesn't leak global state
 * between test files in the same process if restored correctly.
 */

import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { ParallelExecutor } from './index.js';
import { WorktreeManager } from './worktree-manager.js';
import { MergeEngine } from './merge-engine.js';
import { ConflictResolver } from './conflict-resolver.js';
import { Worker } from './worker.js';
import * as taskGraph from './task-graph.js';
import type { TrackerTask, TrackerPlugin } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function task(id: string): TrackerTask {
  return { id, title: `Task ${id}`, status: 'open', priority: 2 };
}

function createMockTracker(tasks: TrackerTask[] = []): TrackerPlugin {
  return {
    meta: { id: 'mock', name: 'Mock', description: '', version: '1', supportsDependencies: true, supportsBidirectionalSync: false, supportsHierarchy: false },
    initialize: async () => {},
    isReady: async () => true,
    getTasks: async () => tasks,
    getTask: async () => undefined,
    getNextTask: async () => undefined,
    completeTask: async () => ({ success: true, message: '' }),
    updateTaskStatus: async () => undefined,
    isComplete: async () => true,
    sync: async () => ({ success: true, message: '', syncedAt: '' }),
    isTaskReady: async () => true,
    getEpics: async () => [],
    getSetupQuestions: () => [],
    validateSetup: async () => null,
    dispose: async () => {},
    getTemplate: () => '',
    getStateFiles: () => [],
  };
}

function createMockConfig(): RalphConfig {
  return {
    cwd: '/tmp/test',
    maxIterations: 5,
    iterationDelay: 10,
    outputDir: '/tmp/out',
    progressFile: '/tmp/progress.md',
    sessionId: 'test-session',
    agent: { name: 'test', plugin: 'test', options: {} },
    tracker: { name: 'test', plugin: 'test', options: {} },
    showTui: false,
    errorHandling: {
      strategy: 'skip',
      maxRetries: 3,
      retryDelayMs: 1000,
      continueOnNonZeroExit: false,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ParallelExecutor execution (spyOn)', () => {
  let spies: any[] = [];

  beforeEach(() => {
    // Mock TaskGraph functions
    spies.push(spyOn(taskGraph, 'shouldRunParallel').mockReturnValue(true));
    spies.push(spyOn(taskGraph, 'analyzeTaskGraph').mockImplementation((tasks) => ({
      nodes: new Map(),
      groups: [{ index: 0, tasks, depth: 0, maxPriority: 2 }],
      cyclicTaskIds: [],
      actionableTaskCount: tasks.length,
      maxParallelism: tasks.length,
      recommendParallel: true
    })));

    // Mock WorktreeManager
    spies.push(spyOn(WorktreeManager.prototype, 'acquire').mockImplementation(async (id, taskId) => ({
      id,
      path: `/tmp/wt-${taskId}`,
      branch: `ralph-parallel/${taskId}`
    } as any)));
    spies.push(spyOn(WorktreeManager.prototype, 'release').mockReturnValue());
    spies.push(spyOn(WorktreeManager.prototype, 'cleanupAll').mockResolvedValue());

    // Mock MergeEngine
    spies.push(spyOn(MergeEngine.prototype, 'initializeSessionBranch').mockReturnValue({ branch: 'session', original: 'main' }));
    spies.push(spyOn(MergeEngine.prototype, 'createSessionBackup').mockReturnValue('backup-tag'));
    spies.push(spyOn(MergeEngine.prototype, 'cleanupTags').mockReturnValue());
    spies.push(spyOn(MergeEngine.prototype, 'returnToOriginalBranch').mockReturnValue());
    spies.push(spyOn(MergeEngine.prototype, 'enqueue').mockImplementation((res) => ({ 
      id: 'op-' + res.task.id, 
      status: 'queued',
      workerResult: res
    } as any)));
    spies.push(spyOn(MergeEngine.prototype, 'processNext').mockResolvedValue({ success: true, operationId: '1' } as any));
    spies.push(spyOn(MergeEngine.prototype, 'getQueue').mockReturnValue([]));
    spies.push(spyOn(MergeEngine.prototype, 'on').mockReturnValue(() => {}));

    // Mock ConflictResolver
    spies.push(spyOn(ConflictResolver.prototype, 'setAiResolver').mockReturnValue());
    spies.push(spyOn(ConflictResolver.prototype, 'resolveConflicts').mockResolvedValue([]));
    spies.push(spyOn(ConflictResolver.prototype, 'on').mockReturnValue(() => {}));

    // Mock Worker
    spies.push(spyOn(Worker.prototype, 'initialize').mockResolvedValue());
    spies.push(spyOn(Worker.prototype, 'start').mockImplementation(async function(this: any) {
      return { 
        success: true, 
        taskCompleted: true, 
        task: this.config.task,
        worktreePath: this.config.worktreePath,
        branchName: this.config.branchName,
        commitCount: 1,
        iterationsRun: 1,
        durationMs: 100,
        workerId: this.id
      };
    }));
    spies.push(spyOn(Worker.prototype, 'stop').mockResolvedValue());
    spies.push(spyOn(Worker.prototype, 'on').mockReturnValue(() => {}));
    spies.push(spyOn(Worker.prototype, 'onEngineEvent').mockReturnValue(() => {}));
    spies.push(spyOn(Worker.prototype, 'getDisplayState').mockReturnValue({} as any));
  });

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies = [];
  });

  test('executes tasks in parallel', async () => {
    const tasks = [task('A'), task('B')];
    const tracker = createMockTracker(tasks);
    const config = createMockConfig();
    const completeSpy = spyOn(tracker, 'completeTask');
    
    const executor = new ParallelExecutor(config, tracker, { maxWorkers: 2 });
    await executor.execute();
    
    expect(executor.getState().status).toBe('completed');
    expect(executor.getState().totalTasksCompleted).toBe(2);
    expect(completeSpy).toHaveBeenCalledTimes(2);
  });

  test('handles worker failure', async () => {
    const tasks = [task('A'), task('B')];
    const tracker = createMockTracker(tasks);
    
    // Mock second worker failure
    spyOn(Worker.prototype, 'start')
      .mockResolvedValueOnce({ success: true, taskCompleted: true, task: tasks[0] } as any)
      .mockResolvedValueOnce({ success: false, taskCompleted: false, task: tasks[1], error: 'Failed' } as any);

    const executor = new ParallelExecutor(createMockConfig(), tracker, { maxWorkers: 2 });
    await executor.execute();
    
    expect(executor.getState().totalTasksCompleted).toBe(1);
  });

  test('tracks merge conflicts', async () => {
    const tasks = [task('A')];
    const tracker = createMockTracker(tasks);
    
    const operation = { id: 'op-A', workerResult: { task: tasks[0] } } as any;
    spyOn(MergeEngine.prototype, 'processNext').mockResolvedValue({ 
      success: false, 
      hadConflicts: true, 
      operationId: 'op-A' 
    } as any);
    spyOn(MergeEngine.prototype, 'getQueue').mockReturnValue([operation]);
    spyOn(ConflictResolver.prototype, 'resolveConflicts').mockResolvedValue([
      { filePath: 'f.ts', success: false, method: 'ai' }
    ]);

    const executor = new ParallelExecutor(createMockConfig(), tracker, { maxWorkers: 1 });
    await executor.execute();
    
    expect(executor.hasPendingConflict()).toBe(true);
  });

  test('can retry conflict resolution', async () => {
    const tasks = [task('A')];
    const tracker = createMockTracker(tasks);
    const completeSpy = spyOn(tracker, 'completeTask');
    
    const operation = { id: 'op-A', workerResult: { task: tasks[0], worktreePath: '/tmp' } } as any;
    spyOn(MergeEngine.prototype, 'processNext').mockResolvedValue({ 
      success: false, 
      hadConflicts: true, 
      operationId: 'op-A' 
    } as any);
    spyOn(MergeEngine.prototype, 'getQueue').mockReturnValue([operation]);
    
    // First resolution fails
    spyOn(ConflictResolver.prototype, 'resolveConflicts')
      .mockResolvedValueOnce([{ filePath: 'f.ts', success: false, method: 'ai' }])
      .mockResolvedValueOnce([{ filePath: 'f.ts', success: true, method: 'ai' }]);

    const executor = new ParallelExecutor(createMockConfig(), tracker, { maxWorkers: 1 });
    await executor.execute();
    
    expect(executor.hasPendingConflict()).toBe(true);
    
    const success = await executor.retryConflictResolution();
    expect(success).toBe(true);
    expect(executor.hasPendingConflict()).toBe(false);
    expect(completeSpy).toHaveBeenCalledWith('A');
  });

  test('can skip failed conflict', async () => {
    const tasks = [task('A')];
    const tracker = createMockTracker(tasks);
    
    const operation = { id: 'op-A', workerResult: { task: tasks[0] } } as any;
    spyOn(MergeEngine.prototype, 'processNext').mockResolvedValue({ 
      success: false, 
      hadConflicts: true, 
      operationId: 'op-A' 
    } as any);
    spyOn(MergeEngine.prototype, 'getQueue').mockReturnValue([operation]);
    spyOn(ConflictResolver.prototype, 'resolveConflicts').mockResolvedValue([
      { filePath: 'f.ts', success: false, method: 'ai' }
    ]);

    const executor = new ParallelExecutor(createMockConfig(), tracker, { maxWorkers: 1 });
    await executor.execute();
    
    expect(executor.hasPendingConflict()).toBe(true);
    executor.skipFailedConflict();
    expect(executor.hasPendingConflict()).toBe(false);
  });

  test('aggregates errors from failed workers and merges', async () => {
    const tasks = [task('A'), task('B')];
    const tracker = createMockTracker(tasks);
    const events: any[] = [];
    
    // Mock A failing execution
    spyOn(Worker.prototype, 'start')
      .mockResolvedValueOnce({ success: false, taskCompleted: false, task: tasks[0], error: 'Worker A Error' } as any)
      .mockResolvedValueOnce({ success: true, taskCompleted: true, task: tasks[1] } as any);
    
    // Mock B failing merge
    spyOn(MergeEngine.prototype, 'processNext').mockResolvedValue({ 
      success: false, 
      error: 'Merge B Error' 
    } as any);

    const executor = new ParallelExecutor(createMockConfig(), tracker, { maxWorkers: 2 });
    executor.on((e) => events.push(e));
    
    await executor.execute();
    
    const groupCompleted = events.find(e => e.type === 'parallel:group-completed');
    expect(groupCompleted.errors).toBeDefined();
    expect(groupCompleted.errors).toHaveLength(2);
    expect(groupCompleted.errors).toContainEqual({ taskId: 'A', error: 'Worker A Error' });
    expect(groupCompleted.errors).toContainEqual({ taskId: 'B', error: 'Merge B Error' });

    const sessionCompleted = events.find(e => e.type === 'parallel:completed');
    expect(sessionCompleted.errors).toHaveLength(2);
  });
});