/**
 * ABOUTME: Tests for the parallel Worker class.
 * Tests worker lifecycle, event forwarding, display state, and error handling.
 *
 * Avoids mock.module() to prevent interfering with other test files in the suite.
 * Tests worker behavior through its public API using direct property injection.
 */

import { describe, test, expect } from 'bun:test';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { WorkerConfig, WorkerDisplayState } from './types.js';
import type { ParallelEvent } from './events.js';
import { Worker } from './worker.js';

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

/** Attach a lightweight fake engine without using initialize(). */
function setFakeEngine(
  worker: Worker,
  overrides: {
    start?: () => Promise<void>;
    stop?: () => Promise<void>;
    getState?: () => { tasksCompleted: number; currentIteration: number };
    pause?: () => void;
    resume?: () => void;
  } = {}
): void {
  const fakeEngine = {
    start: overrides.start ?? (async () => {}),
    stop: overrides.stop ?? (async () => {}),
    getState: overrides.getState ?? (() => ({ tasksCompleted: 0, currentIteration: 0 })),
    pause: overrides.pause ?? (() => {}),
    resume: overrides.resume ?? (() => {}),
  };

  (worker as any).engine = fakeEngine;
}

/** Emit an engine event into the worker without depending on ExecutionEngine internals. */
function emitEngineEvent(worker: Worker, event: any): void {
  (worker as any).handleEngineEvent(event);
}

describe('Worker', () => {
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
      expect(worker.config.task.id).toBe('T1');
      expect(worker.config.worktreePath).toBe('/tmp/worktrees/w1');
      expect(worker.config.branchName).toBe('ralph-parallel/T1');
    });
  });

  describe('getStatus', () => {
    test('starts as idle', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);
      expect(worker.getStatus()).toBe('idle');
    });
  });

  describe('getTask', () => {
    test('returns the assigned task', () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 10);

      expect(worker.getTask()).toBe(task);
      expect(worker.getTask().id).toBe('T1');
      expect(worker.getTask().title).toBe('Task T1');
    });
  });

  describe('getDisplayState', () => {
    test('returns initial display state before start', () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 5);

      const state: WorkerDisplayState = worker.getDisplayState();

      expect(state.id).toBe('w1');
      expect(state.status).toBe('idle');
      expect(state.task.id).toBe('T1');
      expect(state.currentIteration).toBe(0);
      expect(state.maxIterations).toBe(5);
      expect(state.lastOutput).toBe('');
      expect(state.elapsedMs).toBe(0);
    });

    test('reflects configured maxIterations', () => {
      const worker = new Worker(workerConfig('w2', mockTask('T2')), 20);
      expect(worker.getDisplayState().maxIterations).toBe(20);
    });
  });

  describe('start without initialize', () => {
    test('throws if initialize() was not called', async () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      // start() should throw because no engine was initialized
      await expect(worker.start()).rejects.toThrow('not initialized');
    });
  });

  describe('start with fake engine', () => {
    test('includes accumulated commit count in successful result', async () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      setFakeEngine(worker, {
        start: async () => {
          emitEngineEvent(worker, {
            type: 'task:auto-committed',
            timestamp: new Date().toISOString(),
            commitSha: 'abc123',
          });
          emitEngineEvent(worker, {
            type: 'task:auto-committed',
            timestamp: new Date().toISOString(),
            commitSha: 'def456',
          });
        },
        getState: () => ({ tasksCompleted: 1, currentIteration: 2 }),
      });

      const result = await worker.start();

      expect(result.success).toBe(true);
      expect(result.taskCompleted).toBe(true);
      expect(result.commitCount).toBe(2);
      expect(worker.getDisplayState().commitSha).toBe('def456');
    });

    test('resets commit tracking between runs', async () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);
      let runCount = 0;

      setFakeEngine(worker, {
        start: async () => {
          runCount++;
          if (runCount === 1) {
            emitEngineEvent(worker, {
              type: 'task:auto-committed',
              timestamp: new Date().toISOString(),
              commitSha: 'firstsha',
            });
          }
        },
        getState: () => ({ tasksCompleted: 1, currentIteration: 1 }),
      });

      const first = await worker.start();
      expect(first.commitCount).toBe(1);
      expect(worker.getDisplayState().commitSha).toBe('firstsha');

      const second = await worker.start();
      expect(second.commitCount).toBe(0);
      expect(worker.getDisplayState().commitSha).toBeUndefined();
    });

    test('keeps commit count when worker is cancelled during start', async () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      setFakeEngine(worker, {
        start: async () => {
          emitEngineEvent(worker, {
            type: 'task:auto-committed',
            timestamp: new Date().toISOString(),
            commitSha: 'cancelsha',
          });
          await worker.stop();
        },
        getState: () => ({ tasksCompleted: 1, currentIteration: 1 }),
      });

      const result = await worker.start();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Worker was cancelled');
      expect(result.commitCount).toBe(1);
    });

    test('keeps commit count when engine start throws', async () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      setFakeEngine(worker, {
        start: async () => {
          emitEngineEvent(worker, {
            type: 'task:auto-committed',
            timestamp: new Date().toISOString(),
            commitSha: 'errorsha',
          });
          throw new Error('boom');
        },
      });

      const result = await worker.start();

      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
      expect(result.commitCount).toBe(1);
    });
  });

  describe('event listener registration', () => {
    test('on() returns an unsubscribe function', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      const events: ParallelEvent[] = [];
      const unsub = worker.on((e) => events.push(e));

      expect(typeof unsub).toBe('function');

      // Unsubscribe
      unsub();
    });

    test('onEngineEvent() returns an unsubscribe function', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      const unsub = worker.onEngineEvent(() => {});

      expect(typeof unsub).toBe('function');

      unsub();
    });
  });

  describe('stop without initialize', () => {
    test('sets status to cancelled even without engine', async () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      await worker.stop();

      expect(worker.getStatus()).toBe('cancelled');
    });
  });

  describe('pause without initialize', () => {
    test('does not throw when called without engine', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      // Should not throw
      worker.pause();

      expect(worker.getStatus()).toBe('idle');
    });
  });

  describe('resume without initialize', () => {
    test('does not throw when called without engine', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      // Should not throw
      worker.resume();

      expect(worker.getStatus()).toBe('idle');
    });
  });

  describe('display state with worktree info', () => {
    test('includes worktreePath from config', () => {
      const task = mockTask('T1');
      const cfg = workerConfig('w1', task);
      const worker = new Worker(cfg, 10);

      const state = worker.getDisplayState();

      expect(state.worktreePath).toBe('/tmp/worktrees/w1');
    });

    test('includes branchName from config', () => {
      const task = mockTask('T1');
      const cfg = workerConfig('w1', task);
      const worker = new Worker(cfg, 10);

      const state = worker.getDisplayState();

      expect(state.branchName).toBe('ralph-parallel/T1');
    });

    test('commitSha is undefined initially', () => {
      const task = mockTask('T1');
      const worker = new Worker(workerConfig('w1', task), 10);

      const state = worker.getDisplayState();

      expect(state.commitSha).toBeUndefined();
    });
  });

  describe('listener error handling', () => {
    test('unsubscribing from parallel events multiple times is safe', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);
      const unsub = worker.on(() => {});

      // Multiple unsubscribes should not throw
      unsub();
      unsub();
      unsub();
    });

    test('unsubscribing from engine events multiple times is safe', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);
      const unsub = worker.onEngineEvent(() => {});

      // Multiple unsubscribes should not throw
      unsub();
      unsub();
      unsub();
    });
  });
});
