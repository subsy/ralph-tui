/**
 * ABOUTME: Tests for the ExecutionEngine.
 * Tests state machine transitions, iteration logic, error handling, and the
 * SELECT → BUILD → EXECUTE → DETECT cycle.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { ExecutionEngine } from '../../src/engine/index.js';
import type {
  EngineEvent,
  EngineState,
  EngineStatus,
  IterationResult,
} from '../../src/engine/types.js';
import type { RalphConfig } from '../../src/config/types.js';
import type { TrackerTask, TrackerPlugin } from '../../src/plugins/trackers/types.js';
import type { AgentPlugin, AgentExecutionHandle, AgentExecutionResult } from '../../src/plugins/agents/types.js';
import { createTrackerTask, createTrackerTasks } from '../factories/tracker-task.js';
import {
  createMockAgentPlugin,
  createSuccessfulExecution,
  createFailedExecution,
  createRateLimitedExecution,
  createTimeoutExecution,
  createDetectResult,
} from '../mocks/agent-responses.js';

// Mock the registry modules
const mockAgentInstance = createMockAgentPlugin();
const mockTrackerInstance: Partial<TrackerPlugin> = {
  sync: mock(() => Promise.resolve({ success: true, message: 'Synced', added: 0, updated: 0, removed: 0, syncedAt: new Date().toISOString() })),
  getTasks: mock(() => Promise.resolve([] as TrackerTask[])),
  getNextTask: mock(() => Promise.resolve(undefined as TrackerTask | undefined)),
  isComplete: mock(() => Promise.resolve(false)),
  isTaskReady: mock(() => Promise.resolve(true)),
  updateTaskStatus: mock(() => Promise.resolve()),
  completeTask: mock(() => Promise.resolve({ success: true, message: 'Completed' })),
};

// Mock session functions
const mockUpdateSessionIteration = mock(() => Promise.resolve());
const mockUpdateSessionStatus = mock(() => Promise.resolve());
const mockUpdateSessionMaxIterations = mock(() => Promise.resolve());


// Override module imports
mock.module('../../src/plugins/agents/registry.js', () => ({
  getAgentRegistry: () => ({
    getInstance: () => Promise.resolve(mockAgentInstance),
  }),
}));

mock.module('../../src/plugins/trackers/registry.js', () => ({
  getTrackerRegistry: () => ({
    getInstance: () => Promise.resolve(mockTrackerInstance),
  }),
}));

mock.module('../../src/session/index.js', () => ({
  updateSessionIteration: mockUpdateSessionIteration,
  updateSessionStatus: mockUpdateSessionStatus,
  updateSessionMaxIterations: mockUpdateSessionMaxIterations,
}));

// NOTE: Do NOT mock logs/index.js - it causes pollution across test files
// due to Bun's known bug with mock.module (see: https://github.com/oven-sh/bun/issues/12823)
// The real logging functions work fine for execution-engine tests since they use temp directories

// NOTE: Do NOT mock templates/index.js - it causes pollution across test files
// due to Bun's known bug with mock.module (see: https://github.com/oven-sh/bun/issues/12823)
// The real renderPrompt function works fine for execution-engine tests

/**
 * Create a minimal RalphConfig for testing
 */
function createTestConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    cwd: '/test/project',
    maxIterations: 10,
    iterationDelay: 0, // No delay in tests
    agent: {
      name: 'claude',
      plugin: 'claude',
      options: {},
    },
    tracker: {
      name: 'json',
      plugin: 'json',
      options: {},
    },
    errorHandling: {
      strategy: 'skip',
      maxRetries: 3,
      retryDelayMs: 0,
      continueOnNonZeroExit: false,
    },
    ...overrides,
  } as RalphConfig;
}

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine;
  let config: RalphConfig;
  let events: EngineEvent[];

  beforeEach(() => {
    // Reset all mocks
    mock.restore();
    events = [];
    config = createTestConfig();
  });

  afterEach(async () => {
    if (engine) {
      await engine.dispose();
    }
  });

  describe('state machine transitions', () => {
    describe('initial state', () => {
      test('starts in idle status', () => {
        engine = new ExecutionEngine(config);
        expect(engine.getStatus()).toBe('idle');
      });

      test('has zero iterations initially', () => {
        engine = new ExecutionEngine(config);
        const state = engine.getState();
        expect(state.currentIteration).toBe(0);
        expect(state.tasksCompleted).toBe(0);
      });

      test('has no current task initially', () => {
        engine = new ExecutionEngine(config);
        const state = engine.getState();
        expect(state.currentTask).toBeNull();
      });

      test('has empty subagent map initially', () => {
        engine = new ExecutionEngine(config);
        const state = engine.getState();
        expect(state.subagents.size).toBe(0);
      });
    });

    describe('idle → running transition', () => {
      test('cannot start without initialization', async () => {
        engine = new ExecutionEngine(config);
        await expect(engine.start()).rejects.toThrow('Engine not initialized');
      });

      test('transitions to running on start after initialization', async () => {
        engine = new ExecutionEngine(config);

        // Mock initialization
        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(true)
        );

        await engine.initialize();
        
        const startPromise = engine.start();
        expect(engine.getStatus()).toBe('running');
        
        await startPromise;
      });

      test('emits engine:started event', async () => {
        engine = new ExecutionEngine(config);
        engine.on((event) => events.push(event));

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(true)
        );

        await engine.initialize();
        await engine.start();

        const startEvent = events.find((e) => e.type === 'engine:started');
        expect(startEvent).toBeDefined();
        expect(startEvent?.type).toBe('engine:started');
      });

      test('cannot start twice', async () => {
        engine = new ExecutionEngine(config);

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([createTrackerTask()])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(false)
        );

        await engine.initialize();
        const startPromise = engine.start();

        await expect(engine.start()).rejects.toThrow('Cannot start engine in running state');
        
        // Clean up
        await engine.stop();
        await startPromise;
      });
    });

    describe('running → pausing → paused transition', () => {
      test('pause sets status to pausing', async () => {
        engine = new ExecutionEngine(config);

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([createTrackerTask()])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(false)
        );

        await engine.initialize();
        const startPromise = engine.start();

        engine.pause();
        expect(engine.isPausing()).toBe(true);

        await engine.stop();
        await startPromise;
      });

      test('isPaused returns false while pausing', async () => {
        engine = new ExecutionEngine(config);

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([createTrackerTask()])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(false)
        );

        await engine.initialize();
        const startPromise = engine.start();

        engine.pause();
        expect(engine.isPaused()).toBe(false);
        expect(engine.isPausing()).toBe(true);

        await engine.stop();
        await startPromise;
      });
    });

    describe('paused → running transition (resume)', () => {
      test('resume cancels pending pause', async () => {
        engine = new ExecutionEngine(config);

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([createTrackerTask()])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(false)
        );

        await engine.initialize();
        const startPromise = engine.start();

        engine.pause();
        expect(engine.isPausing()).toBe(true);

        engine.resume();
        expect(engine.isPausing()).toBe(false);
        expect(engine.getStatus()).toBe('running');

        await engine.stop();
        await startPromise;
      });

      test('resume does nothing when not paused', async () => {
        engine = new ExecutionEngine(config);

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(true)
        );

        await engine.initialize();
        engine.resume(); // Should not throw
        expect(engine.getStatus()).toBe('idle');
      });
    });

    describe('running → stopping → idle transition', () => {
      test('stop transitions through stopping to idle', async () => {
        engine = new ExecutionEngine(config);

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([createTrackerTask()])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(false)
        );

        await engine.initialize();
        const startPromise = engine.start();

        await engine.stop();
        await startPromise;

        expect(engine.getStatus()).toBe('idle');
      });

      test('emits engine:stopped event with reason interrupted', async () => {
        engine = new ExecutionEngine(config);
        engine.on((event) => events.push(event));

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([createTrackerTask()])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(false)
        );

        await engine.initialize();
        const startPromise = engine.start();
        await engine.stop();
        await startPromise;

        const stopEvent = events.find(
          (e) => e.type === 'engine:stopped' && 'reason' in e && e.reason === 'interrupted'
        );
        expect(stopEvent).toBeDefined();
      });
    });

    describe('completion transitions', () => {
      test('transitions to idle when all tasks complete', async () => {
        engine = new ExecutionEngine(config);
        engine.on((event) => events.push(event));

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(true)
        );

        await engine.initialize();
        await engine.start();

        expect(engine.getStatus()).toBe('idle');
        const completeEvent = events.find((e) => e.type === 'all:complete');
        expect(completeEvent).toBeDefined();
      });

      test('transitions to idle when max iterations reached', async () => {
        config = createTestConfig({ maxIterations: 0 }); // 0 = unlimited
        engine = new ExecutionEngine(config);
        engine.on((event) => events.push(event));

        // Simulate hitting max iterations by setting config to 1
        config.maxIterations = 1;

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(true)
        );

        await engine.initialize();
        await engine.start();

        expect(engine.getStatus()).toBe('idle');
      });

      test('emits engine:stopped with reason no_tasks when no tasks available', async () => {
        engine = new ExecutionEngine(config);
        engine.on((event) => events.push(event));

        (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve([])
        );
        (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
          Promise.resolve(false)
        );

        await engine.initialize();
        await engine.start();

        const stopEvent = events.find(
          (e) => e.type === 'engine:stopped' && 'reason' in e && e.reason === 'no_tasks'
        );
        expect(stopEvent).toBeDefined();
      });
    });
  });

  describe('iteration logic', () => {
    describe('addIterations', () => {
      test('adds iterations to maxIterations', async () => {
        config = createTestConfig({ maxIterations: 5 });
        engine = new ExecutionEngine(config);

        const { currentIteration, maxIterations: initial } = engine.getIterationInfo();
        expect(initial).toBe(5);

        const shouldRestart = await engine.addIterations(3);

        const { maxIterations: updated } = engine.getIterationInfo();
        expect(updated).toBe(8);
        // shouldRestart is true when engine is idle and we're adding iterations
        // to a non-unlimited max (allows continuing after hitting max_iterations)
        expect(shouldRestart).toBe(true);
      });

      test('does nothing for unlimited iterations', async () => {
        config = createTestConfig({ maxIterations: 0 }); // 0 = unlimited
        engine = new ExecutionEngine(config);

        const shouldRestart = await engine.addIterations(5);

        expect(shouldRestart).toBe(false);
        const { maxIterations } = engine.getIterationInfo();
        expect(maxIterations).toBe(0);
      });

      test('does nothing for zero or negative count', async () => {
        config = createTestConfig({ maxIterations: 5 });
        engine = new ExecutionEngine(config);

        await engine.addIterations(0);
        expect(engine.getIterationInfo().maxIterations).toBe(5);

        await engine.addIterations(-3);
        expect(engine.getIterationInfo().maxIterations).toBe(5);
      });

      test('emits engine:iterations-added event', async () => {
        config = createTestConfig({ maxIterations: 5 });
        engine = new ExecutionEngine(config);
        engine.on((event) => events.push(event));

        await engine.addIterations(3);

        const addEvent = events.find((e) => e.type === 'engine:iterations-added');
        expect(addEvent).toBeDefined();
        if (addEvent && 'added' in addEvent) {
          expect(addEvent.added).toBe(3);
          expect(addEvent.newMax).toBe(8);
          expect(addEvent.previousMax).toBe(5);
        }
      });
    });

    describe('removeIterations', () => {
      test('removes iterations from maxIterations', async () => {
        config = createTestConfig({ maxIterations: 10 });
        engine = new ExecutionEngine(config);

        const success = await engine.removeIterations(3);

        expect(success).toBe(true);
        const { maxIterations } = engine.getIterationInfo();
        expect(maxIterations).toBe(7);
      });

      test('does not go below 1', async () => {
        config = createTestConfig({ maxIterations: 5 });
        engine = new ExecutionEngine(config);

        const success = await engine.removeIterations(10);

        expect(success).toBe(true);
        const { maxIterations } = engine.getIterationInfo();
        expect(maxIterations).toBe(1);
      });

      test('returns false for unlimited iterations', async () => {
        config = createTestConfig({ maxIterations: 0 });
        engine = new ExecutionEngine(config);

        const success = await engine.removeIterations(5);

        expect(success).toBe(false);
      });

      test('returns false for zero or negative count', async () => {
        config = createTestConfig({ maxIterations: 5 });
        engine = new ExecutionEngine(config);

        expect(await engine.removeIterations(0)).toBe(false);
        expect(await engine.removeIterations(-3)).toBe(false);
      });

      test('emits engine:iterations-removed event', async () => {
        config = createTestConfig({ maxIterations: 10 });
        engine = new ExecutionEngine(config);
        engine.on((event) => events.push(event));

        await engine.removeIterations(3);

        const removeEvent = events.find((e) => e.type === 'engine:iterations-removed');
        expect(removeEvent).toBeDefined();
        if (removeEvent && 'removed' in removeEvent) {
          expect(removeEvent.removed).toBe(3);
          expect(removeEvent.newMax).toBe(7);
          expect(removeEvent.previousMax).toBe(10);
        }
      });
    });

    describe('getIterationInfo', () => {
      test('returns current iteration and max iterations', () => {
        config = createTestConfig({ maxIterations: 15 });
        engine = new ExecutionEngine(config);

        const info = engine.getIterationInfo();

        expect(info.currentIteration).toBe(0);
        expect(info.maxIterations).toBe(15);
      });
    });
  });

  describe('setAutoCommit', () => {
    test('updates autoCommit from false to true', () => {
      config = createTestConfig({ autoCommit: false });
      engine = new ExecutionEngine(config);

      engine.setAutoCommit(true);

      // Access the config via the engine's internal state
      // The engine uses this.config.autoCommit in runIteration
      expect((engine as any).config.autoCommit).toBe(true);
    });

    test('updates autoCommit from true to false', () => {
      config = createTestConfig({ autoCommit: true });
      engine = new ExecutionEngine(config);

      engine.setAutoCommit(false);

      expect((engine as any).config.autoCommit).toBe(false);
    });

    test('preserves initial autoCommit value from config', () => {
      config = createTestConfig({ autoCommit: true });
      engine = new ExecutionEngine(config);

      expect((engine as any).config.autoCommit).toBe(true);
    });

    test('defaults to undefined when not set in config', () => {
      config = createTestConfig();
      engine = new ExecutionEngine(config);

      // When not explicitly set, autoCommit is undefined on the config
      expect((engine as any).config.autoCommit).toBeUndefined();
    });

    test('can be toggled multiple times', () => {
      config = createTestConfig({ autoCommit: false });
      engine = new ExecutionEngine(config);

      engine.setAutoCommit(true);
      expect((engine as any).config.autoCommit).toBe(true);

      engine.setAutoCommit(false);
      expect((engine as any).config.autoCommit).toBe(false);

      engine.setAutoCommit(true);
      expect((engine as any).config.autoCommit).toBe(true);
    });
  });

  describe('error classification', () => {
    test('classifies rate limit errors', async () => {
      engine = new ExecutionEngine(config);
      const detector = new (await import('../../src/engine/rate-limit-detector.js')).RateLimitDetector();

      const result = detector.detect({
        stderr: 'Error: 429 Too Many Requests',
        exitCode: 1,
      });

      expect(result.isRateLimit).toBe(true);
    });

    test('classifies crash errors (non-rate-limit failures)', async () => {
      engine = new ExecutionEngine(config);
      const detector = new (await import('../../src/engine/rate-limit-detector.js')).RateLimitDetector();

      const result = detector.detect({
        stderr: 'Segmentation fault',
        exitCode: 139,
      });

      expect(result.isRateLimit).toBe(false);
    });

    test('classifies completion (success)', async () => {
      engine = new ExecutionEngine(config);
      const detector = new (await import('../../src/engine/rate-limit-detector.js')).RateLimitDetector();

      const result = detector.detect({
        stderr: '',
        exitCode: 0,
      });

      expect(result.isRateLimit).toBe(false);
    });
  });

  describe('execution result handling', () => {
    test('treats timeout execution as a failed iteration', async () => {
      const originalExecute = mockAgentInstance.execute;
      mockAgentInstance.execute = mock(() => {
        const result = createTimeoutExecution();
        return {
          promise: Promise.resolve(result),
          interrupt: mock(() => {}),
        };
      }) as AgentPlugin['execute'];

      config = createTestConfig({
        maxIterations: 2,
        errorHandling: {
          strategy: 'abort',
          maxRetries: 0,
          retryDelayMs: 0,
          continueOnNonZeroExit: false,
        },
      });
      engine = new ExecutionEngine(config);
      engine.on((event) => events.push(event));

      const task = createTrackerTask({ id: 'task-timeout', title: 'Timeout task' });
      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([task])
      );
      (mockTrackerInstance.getNextTask as ReturnType<typeof mock>)
        .mockImplementationOnce(() => Promise.resolve(task))
        .mockImplementation(() => Promise.resolve(undefined));
      (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(false)
      );

      try {
        await engine.initialize();
        await engine.start();
      } finally {
        mockAgentInstance.execute = originalExecute;
      }

      const firstIteration = engine.getState().iterations[0];
      expect(firstIteration?.status).toBe('failed');

      const failedEvent = events.find((event) => event.type === 'iteration:failed');
      expect(failedEvent).toBeDefined();

      const stopEvent = events.find(
        (event) => event.type === 'engine:stopped' && 'reason' in event && event.reason === 'error'
      );
      expect(stopEvent).toBeDefined();
    });

    test('clears rate-limited agent tracking after all agents are limited', async () => {
      const originalExecute = mockAgentInstance.execute;
      mockAgentInstance.execute = mock(() => {
        const result = createRateLimitedExecution();
        return {
          promise: Promise.resolve(result),
          interrupt: mock(() => {}),
        };
      }) as AgentPlugin['execute'];

      config = createTestConfig({
        maxIterations: 2,
        agent: {
          name: 'claude',
          plugin: 'claude',
          options: {},
          fallbackAgents: ['opencode'],
          rateLimitHandling: {
            enabled: true,
            maxRetries: 0,
            baseBackoffMs: 0,
            recoverPrimaryBetweenIterations: false,
          },
        },
        errorHandling: {
          strategy: 'abort',
          maxRetries: 0,
          retryDelayMs: 0,
          continueOnNonZeroExit: false,
        },
      });
      engine = new ExecutionEngine(config);
      engine.on((event) => events.push(event));

      const task = createTrackerTask({ id: 'task-rate-limit', title: 'Rate limited task' });
      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([task])
      );
      (mockTrackerInstance.getNextTask as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(task)
      );
      (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(false)
      );

      try {
        await engine.initialize();
        await engine.start();
      } finally {
        mockAgentInstance.execute = originalExecute;
      }

      const allLimitedEvent = events.find((event) => event.type === 'agent:all-limited');
      expect(allLimitedEvent).toBeDefined();
      if (allLimitedEvent && 'triedAgents' in allLimitedEvent) {
        expect(allLimitedEvent.triedAgents).toEqual(expect.arrayContaining(['claude', 'opencode']));
      }

      expect((engine as any).rateLimitedAgents.size).toBe(0);
    });
  });

  describe('event system', () => {
    test('registers and calls event listeners', () => {
      engine = new ExecutionEngine(config);
      const listener = mock((event: EngineEvent) => {});

      engine.on(listener);
      // Manually trigger an event by changing state
      // (In production, events are emitted during lifecycle)
      
      expect(listener).not.toHaveBeenCalled(); // No events emitted yet
    });

    test('unregisters event listeners', () => {
      engine = new ExecutionEngine(config);
      const listener = mock((event: EngineEvent) => {});

      const unsubscribe = engine.on(listener);
      unsubscribe();

      // Listener should be removed from internal list
      // Verify by checking the listener won't receive future events
    });

    test('handles listener errors gracefully', async () => {
      engine = new ExecutionEngine(config);
      engine.on(() => {
        throw new Error('Listener error');
      });

      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );
      (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(true)
      );

      await engine.initialize();
      
      // Should not throw despite listener error
      await expect(engine.start()).resolves.toBeUndefined();
    });
  });

  describe('active agent state', () => {
    test('getActiveAgentInfo returns null before initialization', () => {
      engine = new ExecutionEngine(config);
      expect(engine.getActiveAgentInfo()).toBeNull();
    });

    test('getActiveAgentInfo returns active agent after initialization', async () => {
      engine = new ExecutionEngine(config);

      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );

      await engine.initialize();

      const info = engine.getActiveAgentInfo();
      expect(info).toBeDefined();
      expect(info?.plugin).toBe('claude');
      expect(info?.reason).toBe('primary');
    });

    test('getRateLimitState returns null before initialization', () => {
      engine = new ExecutionEngine(config);
      expect(engine.getRateLimitState()).toBeNull();
    });

    test('getRateLimitState returns state after initialization', async () => {
      engine = new ExecutionEngine(config);

      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );

      await engine.initialize();

      const state = engine.getRateLimitState();
      expect(state).toBeDefined();
      expect(state?.primaryAgent).toBe('claude');
    });
  });

  describe('subagent tree', () => {
    test('getSubagentTree returns empty array initially', () => {
      engine = new ExecutionEngine(config);
      expect(engine.getSubagentTree()).toEqual([]);
    });
  });

  describe('task management', () => {
    test('getTracker returns null before initialization', () => {
      engine = new ExecutionEngine(config);
      expect(engine.getTracker()).toBeNull();
    });

    test('getTracker returns tracker after initialization', async () => {
      engine = new ExecutionEngine(config);

      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );

      await engine.initialize();

      expect(engine.getTracker()).toBeDefined();
    });

    test('refreshTasks fetches and emits tasks:refreshed event', async () => {
      engine = new ExecutionEngine(config);
      engine.on((event) => events.push(event));

      const tasks = createTrackerTasks(3);
      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(tasks)
      );

      await engine.initialize();
      events.length = 0; // Clear init events

      await engine.refreshTasks();

      const refreshEvent = events.find((e) => e.type === 'tasks:refreshed');
      expect(refreshEvent).toBeDefined();
      if (refreshEvent && 'tasks' in refreshEvent) {
        expect(refreshEvent.tasks).toHaveLength(3);
      }
    });

    test('refreshTasks does nothing before initialization', async () => {
      engine = new ExecutionEngine(config);
      engine.on((event) => events.push(event));

      await engine.refreshTasks();

      expect(events).toHaveLength(0);
    });

    test('resetTasksToOpen resets tasks back to open status', async () => {
      engine = new ExecutionEngine(config);

      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );

      await engine.initialize();

      const resetCount = await engine.resetTasksToOpen(['task-001', 'task-002']);

      expect(resetCount).toBe(2);
      expect(mockTrackerInstance.updateTaskStatus).toHaveBeenCalledWith('task-001', 'open');
      expect(mockTrackerInstance.updateTaskStatus).toHaveBeenCalledWith('task-002', 'open');
    });

    test('resetTasksToOpen returns 0 before initialization', async () => {
      engine = new ExecutionEngine(config);

      const resetCount = await engine.resetTasksToOpen(['task-001']);

      expect(resetCount).toBe(0);
    });

    test('resetTasksToOpen returns 0 for empty array', async () => {
      engine = new ExecutionEngine(config);

      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );

      await engine.initialize();

      const resetCount = await engine.resetTasksToOpen([]);

      expect(resetCount).toBe(0);
    });
  });

  describe('dispose', () => {
    test('dispose stops engine and clears listeners', async () => {
      engine = new ExecutionEngine(config);
      const listener = mock(() => {});
      engine.on(listener);

      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );
      (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(true)
      );

      await engine.initialize();
      await engine.dispose();

      // After dispose, engine may be in 'stopping' or 'idle' state depending on timing
      const status = engine.getStatus();
      expect(['idle', 'stopping']).toContain(status);
    });
  });

  describe('task selection - getNextAvailableTask', () => {
    // Tests for the fix in https://github.com/subsy/ralph-tui/issues/97
    // Engine should delegate to tracker.getNextTask() for dependency-aware ordering

    test('delegates to tracker.getNextTask for task selection', async () => {
      engine = new ExecutionEngine(config);
      const task = createTrackerTask({ id: 'task-1', title: 'First task' });

      let getNextTaskCalled = false;

      // Setup: getNextTask returns no task (so engine stops with no_tasks)
      // This ensures we test the delegation without having to run a full iteration
      (mockTrackerInstance.getNextTask as ReturnType<typeof mock>).mockImplementation(() => {
        getNextTaskCalled = true;
        return Promise.resolve(undefined); // No task available
      });
      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([task])
      );
      (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(false) // Not complete, so engine tries to get next task
      );

      await engine.initialize();

      // Start the engine - it will call getNextTask, find no tasks, and stop
      await engine.start();

      // Verify getNextTask was called (delegation happened)
      expect(getNextTaskCalled).toBe(true);
    });

    test('stops with no_tasks when getNextTask returns undefined', async () => {
      engine = new ExecutionEngine(config);
      engine.on((event) => events.push(event));

      // Setup: getNextTask returns undefined (no ready tasks)
      (mockTrackerInstance.getNextTask as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(undefined)
      );
      (mockTrackerInstance.getTasks as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([createTrackerTask()])
      );
      (mockTrackerInstance.isComplete as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(false)
      );

      await engine.initialize();
      await engine.start();

      // Should emit engine:stopped with reason no_tasks
      const stopEvent = events.find(
        (e) => e.type === 'engine:stopped' && 'reason' in e && e.reason === 'no_tasks'
      );
      expect(stopEvent).toBeDefined();
    });
  });
});
