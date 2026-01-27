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
    test('throws if initialize() was not called', () => {
      const worker = new Worker(workerConfig('w1', mockTask('T1')), 10);

      // start() should throw because no engine was initialized
      expect(worker.start()).rejects.toThrow('not initialized');
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
});
