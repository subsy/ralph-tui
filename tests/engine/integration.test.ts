/**
 * ABOUTME: Integration tests for ExecutionEngine with mock agents.
 * Tests the SELECT → BUILD → EXECUTE → DETECT cycle end-to-end.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type {
  EngineEvent,
  IterationResult,
} from '../../src/engine/types.js';
import type { TrackerTask, TrackerPlugin, TaskCompletionResult } from '../../src/plugins/trackers/types.js';
import type { AgentPlugin, AgentExecutionHandle, AgentExecutionResult, AgentDetectResult } from '../../src/plugins/agents/types.js';
import { createTrackerTask, createTrackerTasks } from '../factories/tracker-task.js';
import {
  createMockAgentPlugin,
  createSuccessfulExecution,
  createFailedExecution,
  createDetectResult,
  DEFAULT_AGENT_META,
} from '../mocks/agent-responses.js';

// Create controllable mock agent
function createControllableAgent(options: {
  results?: AgentExecutionResult[];
  detectResult?: AgentDetectResult;
} = {}) {
  const results = options.results ?? [createSuccessfulExecution('<promise>COMPLETE</promise>')];
  let callIndex = 0;
  let currentExecution: AgentExecutionHandle | undefined;

  const agent: AgentPlugin = {
    meta: {
      ...DEFAULT_AGENT_META,
      id: 'test-agent',
      name: 'Test Agent',
    },
    async initialize() {},
    async isReady() { return true; },
    async detect() { return options.detectResult ?? createDetectResult(); },
    execute(prompt, files, execOptions) {
      const result = results[Math.min(callIndex, results.length - 1)];
      callIndex++;
      
      const executionId = `exec-${Date.now()}`;
      let interrupted = false;

      const promise = new Promise<AgentExecutionResult>((resolve) => {
        setTimeout(() => {
          if (interrupted) {
            resolve({
              ...result,
              executionId,
              status: 'interrupted',
              interrupted: true,
            });
          } else {
            // Stream output if handler provided
            if (execOptions?.onStdout && result.stdout) {
              execOptions.onStdout(result.stdout);
            }
            if (execOptions?.onStderr && result.stderr) {
              execOptions.onStderr(result.stderr);
            }
            resolve({ ...result, executionId });
          }
          execOptions?.onEnd?.({ ...result, executionId });
        }, 5);
      });

      execOptions?.onStart?.(executionId);

      const handle: AgentExecutionHandle = {
        executionId,
        promise,
        interrupt: () => { interrupted = true; },
        isRunning: () => !interrupted,
      };

      currentExecution = handle;
      return handle;
    },
    interrupt(executionId) {
      if (currentExecution?.executionId === executionId) {
        currentExecution.interrupt();
        return true;
      }
      return false;
    },
    interruptAll() { currentExecution?.interrupt(); },
    getCurrentExecution() { return currentExecution; },
    getSetupQuestions() { return []; },
    async validateSetup() { return null; },
    validateModel() { return null; },
    async dispose() { currentExecution = undefined; },
  };

  return { agent, getCallCount: () => callIndex };
}

// Create controllable mock tracker
function createControllableTracker(options: {
  tasks?: TrackerTask[];
  completesAfter?: number;
} = {}) {
  let tasks = options.tasks ?? createTrackerTasks(2);
  let completedCount = 0;
  const completesAfter = options.completesAfter ?? tasks.length;

  const tracker: TrackerPlugin = {
    meta: {
      id: 'test-tracker',
      name: 'Test Tracker',
      description: 'Test tracker for integration tests',
      version: '1.0.0',
    },
    async initialize() {},
    async isReady() { return true; },
    async detect() { return { available: true }; },
    async sync() {
      return { success: true, message: 'Synced', added: 0, updated: 0, removed: 0, syncedAt: new Date().toISOString() };
    },
    async getTasks(filter) {
      if (filter?.status) {
        return tasks.filter(t => filter.status!.includes(t.status));
      }
      return tasks;
    },
    async getTask(id) {
      return tasks.find(t => t.id === id) ?? null;
    },
    async isComplete() {
      return completedCount >= completesAfter;
    },
    async isTaskReady(taskId) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return false;
      if (!task.dependsOn || task.dependsOn.length === 0) return true;
      return task.dependsOn.every(depId => {
        const dep = tasks.find(t => t.id === depId);
        return dep?.status === 'completed';
      });
    },
    async getNextTask(filter) {
      // Filter to open/in_progress tasks
      const activeTasks = tasks.filter(t =>
        t.status === 'open' || t.status === 'in_progress'
      );

      // Filter out excluded IDs
      const excludeSet = new Set(filter?.excludeIds ?? []);
      const candidates = activeTasks.filter(t => !excludeSet.has(t.id));

      // Find ready tasks (no unresolved dependencies)
      for (const task of candidates) {
        if (!task.dependsOn || task.dependsOn.length === 0) {
          return task;
        }
        const allDepsComplete = task.dependsOn.every(depId => {
          const dep = tasks.find(t => t.id === depId);
          return dep?.status === 'completed';
        });
        if (allDepsComplete) {
          return task;
        }
      }
      return undefined;
    },
    async getEpics() {
      return [];
    },
    async updateTaskStatus(taskId, status) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        task.status = status;
      }
    },
    async completeTask(taskId, message) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        task.status = 'completed';
        completedCount++;
        return { success: true, message: message ?? 'Completed', task };
      }
      return { success: false, message: 'Task not found' };
    },
    async createTask() { throw new Error('Not implemented'); },
    async updateTask() { throw new Error('Not implemented'); },
    async deleteTask() { throw new Error('Not implemented'); },
    getSetupQuestions() { return []; },
    async validateSetup() { return null; },
    async dispose() {},
  };

  return { tracker, getTasks: () => tasks, getCompletedCount: () => completedCount };
}

// Dynamic imports for mocking
let ExecutionEngine: typeof import('../../src/engine/index.js').ExecutionEngine;
let mockAgentRegistry: ReturnType<typeof createControllableAgent>;
let mockTrackerRegistry: ReturnType<typeof createControllableTracker>;

describe('ExecutionEngine Integration', () => {
  let events: EngineEvent[];

  beforeEach(async () => {
    events = [];
    
    // Reset mocks for each test
    mockAgentRegistry = createControllableAgent();
    mockTrackerRegistry = createControllableTracker();
    
    // Mock the modules
    mock.module('../../src/plugins/agents/registry.js', () => ({
      getAgentRegistry: () => ({
        getInstance: () => Promise.resolve(mockAgentRegistry.agent),
      }),
    }));

    mock.module('../../src/plugins/trackers/registry.js', () => ({
      getTrackerRegistry: () => ({
        getInstance: () => Promise.resolve(mockTrackerRegistry.tracker),
      }),
    }));

    mock.module('../../src/session/index.js', () => ({
      updateSessionIteration: () => Promise.resolve(),
      updateSessionStatus: () => Promise.resolve(),
      updateSessionMaxIterations: () => Promise.resolve(),
    }));

    mock.module('../../src/logs/index.js', () => ({
      saveIterationLog: () => Promise.resolve(),
      appendProgress: () => Promise.resolve(),
      getRecentProgressSummary: () => Promise.resolve(''),
      buildSubagentTrace: () => undefined,
      createProgressEntry: () => ({ iteration: 1, status: 'completed' }),
    }));

    mock.module('../../src/templates/index.js', () => ({
      renderPrompt: () => ({ success: true, prompt: 'Test prompt for task' }),
    }));

    // Import ExecutionEngine after mocking
    const engineModule = await import('../../src/engine/index.js');
    ExecutionEngine = engineModule.ExecutionEngine;
  });

  afterEach(() => {
    mock.restore();
  });

  describe('SELECT → BUILD → EXECUTE → DETECT cycle', () => {
    test('completes full cycle for single task', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [createSuccessfulExecution('<promise>COMPLETE</promise>')],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: [createTrackerTask({ id: 'task-001', title: 'Test Task' })],
        completesAfter: 1,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 3, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      // Verify SELECT phase
      const selectEvent = events.find(e => e.type === 'task:selected');
      expect(selectEvent).toBeDefined();
      if (selectEvent && 'task' in selectEvent) {
        expect(selectEvent.task.id).toBe('task-001');
      }

      // Verify EXECUTE phase (iteration started)
      const iterationStarted = events.find(e => e.type === 'iteration:started');
      expect(iterationStarted).toBeDefined();

      // Verify DETECT phase (task completed)
      const taskCompleted = events.find(e => e.type === 'task:completed');
      expect(taskCompleted).toBeDefined();

      // Verify iteration completed
      const iterationCompleted = events.find(e => e.type === 'iteration:completed');
      expect(iterationCompleted).toBeDefined();
      if (iterationCompleted && 'result' in iterationCompleted) {
        expect(iterationCompleted.result.taskCompleted).toBe(true);
        expect(iterationCompleted.result.promiseComplete).toBe(true);
      }

      await engine.dispose();
    });

    test('processes multiple tasks sequentially', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [
          createSuccessfulExecution('<promise>COMPLETE</promise>'),
          createSuccessfulExecution('<promise>COMPLETE</promise>'),
          createSuccessfulExecution('<promise>COMPLETE</promise>'),
        ],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: createTrackerTasks(3),
        completesAfter: 3,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 3, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      // Count completed iterations
      const completedIterations = events.filter(e => e.type === 'iteration:completed');
      expect(completedIterations.length).toBe(3);

      // Verify all tasks were completed
      const tasksCompleted = events.filter(e => e.type === 'task:completed');
      expect(tasksCompleted.length).toBe(3);

      // Verify final event
      const allComplete = events.find(e => e.type === 'all:complete');
      expect(allComplete).toBeDefined();

      await engine.dispose();
    });

    test('respects maxIterations limit', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [
          createSuccessfulExecution('Working...'), // No COMPLETE signal
          createSuccessfulExecution('Working...'),
          createSuccessfulExecution('Working...'),
        ],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: createTrackerTasks(5),
        completesAfter: 5,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 2,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 3, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      // Should stop after 2 iterations
      const stopEvent = events.find(
        e => e.type === 'engine:stopped' && 'reason' in e && e.reason === 'max_iterations'
      );
      expect(stopEvent).toBeDefined();

      const completedIterations = events.filter(e => e.type === 'iteration:completed');
      expect(completedIterations.length).toBe(2);

      await engine.dispose();
    });
  });

  describe('error handling integration', () => {
    test('skip strategy moves to next task on failure', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [
          createFailedExecution('Task 1 failed'),
          createSuccessfulExecution('<promise>COMPLETE</promise>'),
        ],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: createTrackerTasks(2),
        completesAfter: 1,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 0, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      // First task should be skipped
      const skippedEvent = events.find(e => e.type === 'iteration:skipped');
      expect(skippedEvent).toBeDefined();

      // Second task should complete
      const taskCompleted = events.find(e => e.type === 'task:completed');
      expect(taskCompleted).toBeDefined();

      await engine.dispose();
    });

    test('abort strategy stops on first failure', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [createFailedExecution('Critical error')],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: createTrackerTasks(3),
        completesAfter: 3,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'abort', maxRetries: 0, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      // Should stop with error reason
      const stopEvent = events.find(
        e => e.type === 'engine:stopped' && 'reason' in e && e.reason === 'error'
      );
      expect(stopEvent).toBeDefined();

      // Should have at most 2 iterations due to abort strategy
      // (one failed iteration may trigger retry or skip before abort)
      const iterations = events.filter(e => e.type === 'iteration:completed' || e.type === 'iteration:failed');
      expect(iterations.length).toBeLessThanOrEqual(3);

      await engine.dispose();
    });
  });

  describe('output streaming', () => {
    test('emits agent:output events during execution', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [createSuccessfulExecution('Line 1\nLine 2\n<promise>COMPLETE</promise>')],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: [createTrackerTask()],
        completesAfter: 1,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 0, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      const outputEvents = events.filter(e => e.type === 'agent:output');
      expect(outputEvents.length).toBeGreaterThan(0);

      await engine.dispose();
    });
  });

  describe('completion detection', () => {
    test('detects <promise>COMPLETE</promise> signal', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [createSuccessfulExecution('Working...\n<promise>COMPLETE</promise>\nDone.')],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: [createTrackerTask()],
        completesAfter: 1,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 0, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      const iterationCompleted = events.find(e => e.type === 'iteration:completed') as any;
      expect(iterationCompleted).toBeDefined();
      expect(iterationCompleted.result.promiseComplete).toBe(true);
      expect(iterationCompleted.result.taskCompleted).toBe(true);

      await engine.dispose();
    });

    test('detects case-insensitive COMPLETE signal', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [createSuccessfulExecution('<promise>  complete  </promise>')],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: [createTrackerTask()],
        completesAfter: 1,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 0, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      const iterationCompleted = events.find(e => e.type === 'iteration:completed') as any;
      expect(iterationCompleted?.result.promiseComplete).toBe(true);

      await engine.dispose();
    });

    test('promiseComplete is false without COMPLETE signal', async () => {
      // Note: taskCompleted can be true even without <promise>COMPLETE</promise>
      // if the agent returns status 'completed', but promiseComplete specifically
      // tracks whether the COMPLETE signal was present in output
      mockAgentRegistry = createControllableAgent({
        results: [createSuccessfulExecution('Task is in progress...')],
      });
      mockTrackerRegistry = createControllableTracker({
        tasks: [createTrackerTask()],
        completesAfter: 1,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 1,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 0, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();
      await engine.start();

      const iterationCompleted = events.find(e => e.type === 'iteration:completed') as any;
      expect(iterationCompleted).toBeDefined();
      // promiseComplete should be false since no <promise>COMPLETE</promise> was in output
      expect(iterationCompleted.result.promiseComplete).toBe(false);

      await engine.dispose();
    });
  });

  describe('task status management', () => {
    test('sets task to in_progress when selected', async () => {
      mockAgentRegistry = createControllableAgent({
        results: [createSuccessfulExecution('<promise>COMPLETE</promise>')],
      });

      const tasks = [createTrackerTask({ id: 'task-001', status: 'open' })];
      mockTrackerRegistry = createControllableTracker({
        tasks,
        completesAfter: 1,
      });

      const engine = new ExecutionEngine({
        cwd: '/test',
        maxIterations: 10,
        iterationDelay: 0,
        agent: { name: 'test', plugin: 'test', options: {} },
        tracker: { name: 'test', plugin: 'test', options: {} },
        errorHandling: { strategy: 'skip', maxRetries: 0, retryDelayMs: 0, continueOnNonZeroExit: false },
      } as any);

      engine.on((event) => events.push(event));

      await engine.initialize();

      // Start and let one iteration complete
      await engine.start();

      // Verify task was activated
      const activatedEvent = events.find(e => e.type === 'task:activated');
      expect(activatedEvent).toBeDefined();

      await engine.dispose();
    });
  });
});
