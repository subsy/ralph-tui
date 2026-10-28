/**
 * ABOUTME: Tests for the shared headless engine event handler.
 * Verifies that engine events produce structured log output (including streamed
 * agent output) and that session state is tracked across iterations.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { createHeadlessEventHandler } from '../../src/commands/headless-events.js';
import { createStructuredLogger } from '../../src/logs/index.js';
import type { PersistedSessionState } from '../../src/session/index.js';
import type { EngineEvent, IterationResult } from '../../src/engine/types.js';
import { createTrackerTask } from '../factories/tracker-task.js';

/**
 * Collect everything written to a stream so log output can be asserted on.
 */
function createCapturingStream(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0),
  };
}

function createPersistedState(cwd: string): PersistedSessionState {
  return {
    version: 1,
    sessionId: 'test-session-001',
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentIteration: 6,
    maxIterations: 0,
    tasksCompleted: 0,
    isPaused: false,
    agentPlugin: 'opencode',
    trackerState: {
      plugin: 'beads',
      totalTasks: 10,
      tasks: [{ id: 'task-001', status: 'open' }],
    },
    iterations: [],
    skippedTaskIds: [],
    cwd,
    activeTaskIds: [],
  };
}

function createIterationResult(overrides: Partial<IterationResult> = {}): IterationResult {
  return {
    iteration: 1,
    status: 'completed',
    task: createTrackerTask(),
    taskCompleted: false,
    promiseComplete: false,
    durationMs: 624_000,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('createHeadlessEventHandler', () => {
  let cwd: string;
  let out: ReturnType<typeof createCapturingStream>;
  let err: ReturnType<typeof createCapturingStream>;
  let handler: ReturnType<typeof createHeadlessEventHandler>;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ralph-headless-events-'));
    out = createCapturingStream();
    err = createCapturingStream();
    handler = createHeadlessEventHandler({
      logger: createStructuredLogger({
        showTimestamp: false,
        stream: out.stream,
        errorStream: err.stream,
      }),
      maxIterations: 20,
      initialState: createPersistedState(cwd),
    });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe('agent output streaming', () => {
    test('streams agent stdout so long iterations are not silent', () => {
      handler.handleEvent({
        type: 'agent:output',
        timestamp: new Date().toISOString(),
        stream: 'stdout',
        data: 'Reading src/index.ts\nEditing src/index.ts\n',
      } as EngineEvent);

      expect(out.lines()).toEqual([
        '[INFO] [agent] Reading src/index.ts',
        '[INFO] [agent] Editing src/index.ts',
      ]);
    });

    test('routes agent stderr to the error stream as warnings', () => {
      handler.handleEvent({
        type: 'agent:output',
        timestamp: new Date().toISOString(),
        stream: 'stderr',
        data: 'rate limit reached\n',
      } as EngineEvent);

      expect(err.lines()).toEqual(['[WARN] [agent] rate limit reached']);
      expect(out.lines()).toEqual([]);
    });

    test('skips blank lines to reduce noise', () => {
      handler.handleEvent({
        type: 'agent:output',
        timestamp: new Date().toISOString(),
        stream: 'stdout',
        data: 'first\n\n   \nsecond\n',
      } as EngineEvent);

      expect(out.lines()).toEqual(['[INFO] [agent] first', '[INFO] [agent] second']);
    });
  });

  describe('progress logging', () => {
    test('logs iteration start with the configured iteration cap', () => {
      handler.handleEvent({
        type: 'iteration:started',
        timestamp: new Date().toISOString(),
        iteration: 3,
        task: createTrackerTask({ id: 'task-042', title: 'Fix the poll loop' }),
      } as EngineEvent);

      expect(out.lines()).toEqual([
        '[INFO] [progress] Iteration 3/20: Working on task-042 - Fix the poll loop',
      ]);
    });

    test('logs iteration completion with duration', () => {
      handler.handleEvent({
        type: 'iteration:completed',
        timestamp: new Date().toISOString(),
        result: createIterationResult({ task: createTrackerTask({ id: 'task-042' }) }),
      } as EngineEvent);

      expect(out.lines()[0]).toBe(
        '[INFO] [progress] Iteration 1 finished. Task task-042: in progress. Duration: 624s'
      );
    });

    test('logs retries, skips, and failures', () => {
      const task = createTrackerTask({ id: 'task-042' });

      handler.handleEvent({
        type: 'iteration:retrying',
        timestamp: new Date().toISOString(),
        iteration: 2,
        retryAttempt: 1,
        maxRetries: 3,
        task,
        previousError: 'boom',
        delayMs: 5_000,
      } as EngineEvent);

      handler.handleEvent({
        type: 'iteration:skipped',
        timestamp: new Date().toISOString(),
        iteration: 2,
        task,
        reason: 'too many failures',
      } as EngineEvent);

      handler.handleEvent({
        type: 'iteration:failed',
        timestamp: new Date().toISOString(),
        iteration: 2,
        error: 'agent exited non-zero',
        task,
        action: 'abort',
      } as EngineEvent);

      expect(err.lines()).toEqual([
        '[WARN] [progress] Retrying iteration 2 on task-042: attempt 1/3, waiting 5s',
        '[WARN] [progress] Skipping task-042 in iteration 2: too many failures',
        '[ERROR] [progress] Iteration 2 FAILED on task-042: agent exited non-zero (action: abort)',
      ]);
    });

    test('logs engine warnings', () => {
      handler.handleEvent({
        type: 'engine:warning',
        timestamp: new Date().toISOString(),
        message: 'tracker returned no tasks',
      } as EngineEvent);

      expect(err.lines()).toEqual(['[WARN] [engine] tracker returned no tasks']);
    });
  });

  describe('session state tracking', () => {
    test('records activated tasks and clears them on completion', () => {
      const task = createTrackerTask({ id: 'task-042' });

      handler.handleEvent({
        type: 'task:activated',
        timestamp: new Date().toISOString(),
        task,
        iteration: 1,
      } as EngineEvent);

      expect(handler.getState().activeTaskIds).toEqual(['task-042']);

      handler.handleEvent({
        type: 'iteration:completed',
        timestamp: new Date().toISOString(),
        result: createIterationResult({ task, taskCompleted: true }),
      } as EngineEvent);

      expect(handler.getState().activeTaskIds).toEqual([]);
    });

    test('applies iteration results to the tracked state', () => {
      handler.handleEvent({
        type: 'iteration:completed',
        timestamp: new Date().toISOString(),
        result: createIterationResult({ iteration: 7, taskCompleted: true }),
      } as EngineEvent);

      const state = handler.getState();
      expect(state.iterations).toHaveLength(1);
      expect(state.tasksCompleted).toBe(1);
    });

    test('marks the state paused on engine:paused', () => {
      handler.handleEvent({
        type: 'engine:paused',
        timestamp: new Date().toISOString(),
        currentIteration: 7,
      } as EngineEvent);

      expect(handler.getState().isPaused).toBe(true);
      expect(out.lines()).toEqual([
        '[INFO] [engine] Paused at iteration 7. Use "ralph-tui resume" to continue.',
      ]);
    });

    test('clears the paused flag on engine:resumed', () => {
      handler.handleEvent({
        type: 'engine:paused',
        timestamp: new Date().toISOString(),
        currentIteration: 7,
      } as EngineEvent);
      handler.handleEvent({
        type: 'engine:resumed',
        timestamp: new Date().toISOString(),
        fromIteration: 7,
      } as EngineEvent);

      const state = handler.getState();
      expect(state.isPaused).toBe(false);
      expect(state.status).toBe('running');
      expect(state.pausedAt).toBeUndefined();
    });

    test('setState replaces the tracked state for shutdown paths', () => {
      handler.setState({ ...handler.getState(), status: 'interrupted' });

      expect(handler.getState().status).toBe('interrupted');
    });
  });

  describe('lifecycle logging', () => {
    test('logs engine start, stop, and completion', () => {
      handler.handleEvent({
        type: 'engine:started',
        timestamp: new Date().toISOString(),
        sessionId: 'test-session-001',
        totalTasks: 17,
        tasks: [],
      } as EngineEvent);

      handler.handleEvent({
        type: 'all:complete',
        timestamp: new Date().toISOString(),
        totalCompleted: 17,
        totalIterations: 21,
      } as EngineEvent);

      handler.handleEvent({
        type: 'engine:stopped',
        timestamp: new Date().toISOString(),
        reason: 'all_complete',
        totalIterations: 21,
        tasksCompleted: 17,
      } as EngineEvent);

      expect(out.lines()).toEqual([
        '[INFO] [engine] Ralph started. Total tasks: 17',
        '[INFO] [engine] All tasks complete! Total: 17 tasks in 21 iterations.',
        '[INFO] [engine] Ralph stopped. Reason: all_complete. Iterations: 21, Tasks completed: 17',
      ]);
    });

    test('ignores events it does not handle', () => {
      handler.handleEvent({
        type: 'agent:usage',
        timestamp: new Date().toISOString(),
      } as unknown as EngineEvent);

      expect(out.lines()).toEqual([]);
      expect(err.lines()).toEqual([]);
    });
  });
});
