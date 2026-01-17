/**
 * ABOUTME: Example test file demonstrating testing patterns for Ralph TUI.
 * This file serves as a reference for contributors writing new tests.
 * It showcases factories, mocks, spying, and common test patterns.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from 'bun:test';

// Import factories for creating test data
import {
  createTrackerTask,
  createTrackerTasks,
  createOpenTask,
  createCompletedTask,
} from './factories/tracker-task.js';
import {
  createSessionMetadata,
  createRunningSession,
  createPausedSession,
} from './factories/session-state.js';
import {
  createAgentConfig,
  createClaudeAgentConfig,
} from './factories/agent-config.js';
import {
  createTrackerConfig,
  createJsonTrackerConfig,
} from './factories/tracker-config.js';

// Import mocks for simulating dependencies
import {
  createMockAgentPlugin,
  createSuccessfulExecution,
  createFailedExecution,
  createDetectResult,
} from './mocks/agent-responses.js';

/**
 * Example 1: Basic Test Structure
 *
 * Shows how to organize tests with describe blocks,
 * setup/teardown with beforeEach/afterEach, and assertions.
 */
describe('Example: Basic Test Structure', () => {
  // Shared test state
  let testValue: string;

  // Setup before each test
  beforeEach(() => {
    testValue = 'initial';
  });

  // Cleanup after each test (async supported)
  afterEach(async () => {
    // Clean up resources, reset state, etc.
    testValue = '';
  });

  test('should verify equality', () => {
    expect(testValue).toBe('initial');
  });

  test('should verify truthiness', () => {
    expect(testValue).toBeTruthy();
    expect('').toBeFalsy();
  });

  test('should verify object structure', () => {
    const obj = { name: 'test', value: 42 };
    expect(obj).toEqual({ name: 'test', value: 42 });
    expect(obj).toHaveProperty('name');
    expect(obj).toHaveProperty('value', 42);
  });

  test('should verify array contents', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr).toContain(2);
  });

  test('should handle async operations', async () => {
    const asyncFn = async (): Promise<string> => 'resolved';
    await expect(asyncFn()).resolves.toBe('resolved');
  });

  test('should verify exceptions', () => {
    const throwFn = (): void => {
      throw new Error('Test error');
    };
    expect(throwFn).toThrow('Test error');
  });
});

/**
 * Example 2: Using Factories
 *
 * Demonstrates how to use factory functions to create
 * consistent test data with sensible defaults.
 */
describe('Example: Using Factories', () => {
  describe('TrackerTask factories', () => {
    test('should create task with defaults', () => {
      const task = createTrackerTask();

      expect(task.id).toBe('task-001');
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('open');
      expect(task.priority).toBe(1);
    });

    test('should create task with overrides', () => {
      const task = createTrackerTask({
        id: 'custom-id',
        title: 'Custom Task',
        status: 'in_progress',
        priority: 2,
      });

      expect(task.id).toBe('custom-id');
      expect(task.title).toBe('Custom Task');
      expect(task.status).toBe('in_progress');
      expect(task.priority).toBe(2);
    });

    test('should create multiple tasks', () => {
      const tasks = createTrackerTasks(3);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe('task-001');
      expect(tasks[1].id).toBe('task-002');
      expect(tasks[2].id).toBe('task-003');
    });

    test('should use specialized task factories', () => {
      const openTask = createOpenTask();
      const completedTask = createCompletedTask();

      expect(openTask.status).toBe('open');
      expect(completedTask.status).toBe('completed');
    });
  });

  describe('Session factories', () => {
    test('should create session metadata with defaults', () => {
      const session = createSessionMetadata();

      expect(session.status).toBe('running');
      expect(session.currentIteration).toBe(1);
    });

    test('should create running session', () => {
      const session = createRunningSession();

      expect(session.status).toBe('running');
    });

    test('should create paused session', () => {
      const session = createPausedSession();

      expect(session.status).toBe('paused');
    });
  });

  describe('Config factories', () => {
    test('should create agent config', () => {
      const config = createAgentConfig();

      expect(config.name).toBeDefined();
      expect(config.plugin).toBeDefined();
    });

    test('should create Claude-specific config', () => {
      const config = createClaudeAgentConfig();

      expect(config.plugin).toBe('claude');
    });

    test('should create tracker config', () => {
      const config = createTrackerConfig();

      expect(config.name).toBeDefined();
      expect(config.plugin).toBeDefined();
    });

    test('should create JSON tracker config', () => {
      const config = createJsonTrackerConfig();

      expect(config.plugin).toBe('json');
    });
  });
});

/**
 * Example 3: Using Mocks
 *
 * Shows how to create and use mock objects for testing
 * code that depends on external systems.
 */
describe('Example: Using Mocks', () => {
  describe('Mock agent plugin', () => {
    test('should create mock agent with defaults', () => {
      const mockAgent = createMockAgentPlugin();

      expect(mockAgent.meta.id).toBe('mock-agent');
      expect(mockAgent.isReady).toBeDefined();
      expect(mockAgent.execute).toBeDefined();
    });

    test('should create successful execution result', () => {
      const result = createSuccessfulExecution('Task completed successfully');

      expect(result.status).toBe('completed');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Task completed successfully');
    });

    test('should create failed execution result', () => {
      const result = createFailedExecution('Something went wrong');

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Something went wrong');
    });

    test('should create detect result', () => {
      const availableResult = createDetectResult({ available: true });
      const unavailableResult = createDetectResult({ available: false });

      expect(availableResult.available).toBe(true);
      expect(unavailableResult.available).toBe(false);
    });
  });
});

/**
 * Example 4: Spying on Methods
 *
 * Demonstrates how to spy on object methods to verify
 * they are called with expected arguments.
 */
describe('Example: Spying', () => {
  test('should spy on object method', () => {
    const calculator = {
      add: (a: number, b: number): number => a + b,
    };

    const addSpy = spyOn(calculator, 'add');

    const result = calculator.add(2, 3);

    expect(result).toBe(5);
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(2, 3);
  });

  test('should spy on multiple calls', () => {
    const logger = {
      log: (_message: string): void => {},
    };

    const logSpy = spyOn(logger, 'log');

    logger.log('first');
    logger.log('second');
    logger.log('third');

    expect(logSpy).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenNthCalledWith(1, 'first');
    expect(logSpy).toHaveBeenNthCalledWith(2, 'second');
    expect(logSpy).toHaveBeenNthCalledWith(3, 'third');
  });
});

/**
 * Example 5: Testing Async Code
 *
 * Shows patterns for testing promises, async/await,
 * and handling async errors.
 */
describe('Example: Async Testing', () => {
  test('should await async result', async () => {
    const fetchData = async (): Promise<{ id: number; name: string }> => {
      return { id: 1, name: 'test' };
    };

    const data = await fetchData();

    expect(data).toEqual({ id: 1, name: 'test' });
  });

  test('should handle async error', async () => {
    const failingFetch = async (): Promise<void> => {
      throw new Error('Network error');
    };

    await expect(failingFetch()).rejects.toThrow('Network error');
  });

  test('should test promise resolution', async () => {
    const promise = Promise.resolve('resolved value');

    await expect(promise).resolves.toBe('resolved value');
  });

  test('should test promise rejection', async () => {
    const promise = Promise.reject(new Error('rejected'));

    await expect(promise).rejects.toThrow('rejected');
  });

  test('should handle delayed async operations', async () => {
    const delayedFn = (): Promise<string> =>
      new Promise((resolve) => setTimeout(() => resolve('done'), 10));

    const result = await delayedFn();

    expect(result).toBe('done');
  });
});

/**
 * Example 6: Module Mocking
 *
 * Demonstrates how to mock entire modules using Bun's
 * mock.module() function for dependency injection.
 */
describe('Example: Module Mocking', () => {
  test('should demonstrate module mocking pattern', () => {
    // This is a documentation example - actual module mocking would be:
    //
    // mock.module('../../src/plugins/agents/registry.js', () => ({
    //   getAgentRegistry: () => ({
    //     getInstance: () => Promise.resolve(mockAgentInstance),
    //   }),
    // }));
    //
    // Then import and use the mocked module normally.
    // The mock will intercept the import and return your mock.

    expect(true).toBe(true); // Placeholder assertion
  });
});

/**
 * Example 7: Testing Edge Cases
 *
 * Shows how to test boundary conditions, null/undefined
 * handling, and error scenarios.
 */
describe('Example: Edge Cases', () => {
  test('should handle empty arrays', () => {
    const tasks = createTrackerTasks(0);

    expect(tasks).toEqual([]);
    expect(tasks).toHaveLength(0);
  });

  test('should handle undefined and null', () => {
    expect(undefined).toBeUndefined();
    expect(null).toBeNull();
    expect(undefined).toBeFalsy();
    expect(null).toBeFalsy();
  });

  test('should handle type coercion carefully', () => {
    // Use toBe for strict equality
    expect(0).not.toBe(false);
    expect('').not.toBe(false);

    // Use toBeFalsy for truthiness checks
    expect(0).toBeFalsy();
    expect('').toBeFalsy();
  });

  test('should handle numeric edge cases', () => {
    expect(Number.isNaN(NaN)).toBe(true);
    expect(Number.isFinite(Infinity)).toBe(false);
    expect(Number.isFinite(42)).toBe(true);
  });
});
