/**
 * ABOUTME: Tests for the parallel Worker class.
 * Tests worker lifecycle, event forwarding, display state, and error handling.
 *
 * Avoids mock.module() to prevent interfering with other test files in the suite.
 * Tests worker behavior through its public API using spyOn for internal dependencies.
 */

import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import type { TrackerTask, TrackerPlugin } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';
import type { WorkerConfig } from './types.js';
import type { ParallelEvent } from './events.js';
import { Worker } from './worker.js';
import { ExecutionEngine } from '../engine/index.js';

/** Create a mock TrackerTask */
function mockTask(id: string): TrackerTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'open',
    priority: 2,
  };
}

/** Create a WorkerConfig */
function workerConfig(id: string, task: TrackerTask): WorkerConfig {
  return {
    id,
    task,
    worktreePath: `/tmp/worktrees/${id}`,
    branchName: `ralph-parallel/${task.id}`,
    cwd: '/tmp/project',
  };
}

/** Create a mock RalphConfig */
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

describe('Worker', () => {
  let spies: any[] = [];

  beforeEach(() => {
    // Mock ExecutionEngine prototype
    spies.push(spyOn(ExecutionEngine.prototype, 'initialize').mockResolvedValue());
    spies.push(spyOn(ExecutionEngine.prototype, 'on').mockReturnValue(() => {}));
    spies.push(spyOn(ExecutionEngine.prototype, 'start').mockResolvedValue());
    spies.push(spyOn(ExecutionEngine.prototype, 'stop').mockResolvedValue());
    spies.push(spyOn(ExecutionEngine.prototype, 'pause').mockReturnValue());
    spies.push(spyOn(ExecutionEngine.prototype, 'resume').mockReturnValue());
    spies.push(spyOn(ExecutionEngine.prototype, 'getState').mockReturnValue({
      status: 'idle',
      currentIteration: 3,
      tasksCompleted: 1,
      totalTasks: 1,
      iterations: [],
      startedAt: null,
      currentOutput: '',
      currentStderr: '',
      subagents: new Map(),
      activeAgent: null,
      rateLimitState: null,
    }));
  });

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies = [];
  });

  describe('constructor', () => {
    test('sets id from config', () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 10);
      expect(worker.id).toBe('w1');
    });

    test('stores the worker config', () => {
      const task = mockTask('T1');
      const cfg = workerConfig('w1', task);
      const worker = new Worker(cfg, 10);
      expect(worker.config).toBe(cfg);
    });
  });

  describe('lifecycle', () => {
    test('initializes and starts the engine', async () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);
      const tracker = {} as TrackerPlugin;
      const config = createMockConfig();

      await worker.initialize(config, tracker);
      const result = await worker.start();

      expect(ExecutionEngine.prototype.initialize).toHaveBeenCalled();
      expect(ExecutionEngine.prototype.start).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.iterationsRun).toBe(3);
      expect(result.taskCompleted).toBe(true);
      expect(worker.getStatus()).toBe('completed');
    });

    test('handles engine errors', async () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);
      
      spyOn(ExecutionEngine.prototype, 'start').mockRejectedValue(new Error('Engine failed'));

      await worker.initialize(createMockConfig(), {} as TrackerPlugin);
      const result = await worker.start();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Engine failed');
      expect(worker.getStatus()).toBe('failed');
    });

    test('can be stopped', async () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);
      
      await worker.initialize(createMockConfig(), {} as TrackerPlugin);
      
      // Stop before starting (cancelled immediately)
      await worker.stop();
      expect(worker.getStatus()).toBe('cancelled');
      expect(ExecutionEngine.prototype.stop).toHaveBeenCalled();
    });

    test('can be paused and resumed', async () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);
      
      await worker.initialize(createMockConfig(), {} as TrackerPlugin);
      
      worker.pause();
      expect(ExecutionEngine.prototype.pause).toHaveBeenCalled();
      
      worker.resume();
      expect(ExecutionEngine.prototype.resume).toHaveBeenCalled();
    });
  });

  describe('event forwarding', () => {
    test('forwards iteration:started as worker:progress', async () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);
      const events: ParallelEvent[] = [];
      worker.on((e) => events.push(e));

      // Capture the engine listener
      let engineListener: any;
      spyOn(ExecutionEngine.prototype, 'on').mockImplementation((l) => {
        engineListener = l;
        return () => {};
      });

      await worker.initialize(createMockConfig(), {} as TrackerPlugin);
      
      // Simulate engine event
      engineListener({
        type: 'iteration:started',
        timestamp: new Date().toISOString(),
        iteration: 1,
        task,
      });

      const progressEvent = events.find(e => e.type === 'worker:progress');
      expect(progressEvent).toBeDefined();
      expect((progressEvent as any).currentIteration).toBe(1);
    });

    test('forwards agent:output as worker:output', async () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);
      const events: ParallelEvent[] = [];
      worker.on((e) => events.push(e));

      let engineListener: any;
      spyOn(ExecutionEngine.prototype, 'on').mockImplementation((l) => {
        engineListener = l;
        return () => {};
      });

      await worker.initialize(createMockConfig(), {} as TrackerPlugin);
      
      engineListener({
        type: 'agent:output',
        timestamp: new Date().toISOString(),
        stream: 'stdout',
        data: 'Hello world',
        iteration: 1,
      });

      const outputEvent = events.find(e => e.type === 'worker:output');
      expect(outputEvent).toBeDefined();
      expect((outputEvent as any).data).toBe('Hello world');
      expect(worker.getDisplayState().lastOutput).toBe('Hello world');
    });
  });

  describe('display state', () => {
    test('updates lastCommitSha on task:auto-committed', async () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);
      
      let engineListener: any;
      spyOn(ExecutionEngine.prototype, 'on').mockImplementation((l) => {
        engineListener = l;
        return () => {};
      });

      await worker.initialize(createMockConfig(), {} as TrackerPlugin);
      
      engineListener({
        type: 'task:auto-committed',
        timestamp: new Date().toISOString(),
        task,
        iteration: 1,
        commitMessage: 'msg',
        commitSha: 'abc1234',
      });

      expect(worker.getDisplayState().commitSha).toBe('abc1234');
    });
  });
});