/**
 * ABOUTME: Mock implementations for agent responses.
 * Provides mock agent execution results and plugin implementations.
 */

import type {
  AgentExecutionResult,
  AgentExecutionStatus,
  AgentDetectResult,
  AgentPlugin,
  AgentPluginMeta,
  AgentPluginConfig,
  AgentSetupQuestion,
  AgentExecutionHandle,
  AgentFileContext,
  AgentExecuteOptions,
} from '../../src/plugins/agents/types.js';

/**
 * Default values for AgentExecutionResult
 */
export const DEFAULT_EXECUTION_RESULT: AgentExecutionResult = {
  executionId: 'test-execution-001',
  status: 'completed',
  exitCode: 0,
  stdout: 'Task completed successfully',
  stderr: '',
  durationMs: 1000,
  interrupted: false,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
};

/**
 * Create an AgentExecutionResult with optional overrides
 */
export function createExecutionResult(
  overrides: Partial<AgentExecutionResult> = {},
): AgentExecutionResult {
  return {
    ...DEFAULT_EXECUTION_RESULT,
    ...overrides,
  };
}

/**
 * Create a successful execution result
 */
export function createSuccessfulExecution(
  stdout = 'Task completed successfully',
  overrides: Partial<AgentExecutionResult> = {},
): AgentExecutionResult {
  return createExecutionResult({
    status: 'completed',
    exitCode: 0,
    stdout,
    stderr: '',
    ...overrides,
  });
}

/**
 * Create a failed execution result
 */
export function createFailedExecution(
  error = 'Execution failed',
  overrides: Partial<AgentExecutionResult> = {},
): AgentExecutionResult {
  return createExecutionResult({
    status: 'failed',
    exitCode: 1,
    stdout: '',
    stderr: error,
    error,
    ...overrides,
  });
}

/**
 * Create a rate-limited execution result
 */
export function createRateLimitedExecution(
  overrides: Partial<AgentExecutionResult> = {},
): AgentExecutionResult {
  return createExecutionResult({
    status: 'failed',
    exitCode: 1,
    stdout: '',
    stderr: 'Error: 429 Too Many Requests - Rate limit exceeded',
    error: 'Rate limit exceeded',
    ...overrides,
  });
}

/**
 * Create an interrupted execution result
 */
export function createInterruptedExecution(
  overrides: Partial<AgentExecutionResult> = {},
): AgentExecutionResult {
  return createExecutionResult({
    status: 'interrupted',
    exitCode: 130,
    stdout: 'Partial output before interrupt',
    stderr: '',
    interrupted: true,
    ...overrides,
  });
}

/**
 * Create a timeout execution result
 */
export function createTimeoutExecution(
  overrides: Partial<AgentExecutionResult> = {},
): AgentExecutionResult {
  return createExecutionResult({
    status: 'timeout',
    stdout: '',
    stderr: 'Execution timed out',
    error: 'Execution timed out',
    ...overrides,
  });
}

/**
 * Create an AgentDetectResult with optional overrides
 */
export function createDetectResult(
  overrides: Partial<AgentDetectResult> = {},
): AgentDetectResult {
  return {
    available: true,
    version: '1.0.0',
    executablePath: '/usr/bin/test-agent',
    ...overrides,
  };
}

/**
 * Create a detect result for unavailable agent
 */
export function createUnavailableDetectResult(
  error = 'Agent not found',
): AgentDetectResult {
  return {
    available: false,
    error,
  };
}

/**
 * Default mock agent plugin metadata
 */
export const DEFAULT_AGENT_META: AgentPluginMeta = {
  id: 'mock-agent',
  name: 'Mock Agent',
  description: 'A mock agent for testing',
  version: '1.0.0',
  defaultCommand: 'mock-agent',
  supportsStreaming: true,
  supportsInterrupt: true,
  supportsFileContext: true,
  supportsSubagentTracing: false,
};

/**
 * Create a mock AgentPlugin implementation
 */
export function createMockAgentPlugin(
  overrides: {
    meta?: Partial<AgentPluginMeta>;
    detectResult?: AgentDetectResult;
    executeResult?: AgentExecutionResult;
    isReady?: boolean;
  } = {},
): AgentPlugin {
  const meta: AgentPluginMeta = {
    ...DEFAULT_AGENT_META,
    ...overrides.meta,
  };

  const detectResult = overrides.detectResult ?? createDetectResult();
  const executeResult = overrides.executeResult ?? createSuccessfulExecution();
  const isReady = overrides.isReady ?? true;

  let currentExecution: AgentExecutionHandle | undefined;

  return {
    meta,

    async initialize(): Promise<void> {},

    async isReady(): Promise<boolean> {
      return isReady;
    },

    async detect(): Promise<AgentDetectResult> {
      return detectResult;
    },

    execute(
      prompt: string,
      files?: AgentFileContext[],
      options?: AgentExecuteOptions,
    ): AgentExecutionHandle {
      const executionId = `exec-${Date.now()}`;
      let interrupted = false;

      const promise = new Promise<AgentExecutionResult>((resolve) => {
        setTimeout(() => {
          if (interrupted) {
            resolve(createInterruptedExecution({ executionId }));
          } else {
            resolve({ ...executeResult, executionId });
          }
          options?.onEnd?.({ ...executeResult, executionId });
        }, 10);
      });

      options?.onStart?.(executionId);

      const handle: AgentExecutionHandle = {
        executionId,
        promise,
        interrupt: () => {
          interrupted = true;
        },
        isRunning: () => !interrupted,
      };

      currentExecution = handle;
      return handle;
    },

    interrupt(executionId: string): boolean {
      if (currentExecution?.executionId === executionId) {
        currentExecution.interrupt();
        return true;
      }
      return false;
    },

    interruptAll(): void {
      currentExecution?.interrupt();
    },

    getCurrentExecution(): AgentExecutionHandle | undefined {
      return currentExecution;
    },

    getSetupQuestions(): AgentSetupQuestion[] {
      return [];
    },

    async validateSetup(): Promise<string | null> {
      return null;
    },

    validateModel(): string | null {
      return null;
    },

    async dispose(): Promise<void> {
      currentExecution = undefined;
    },
  };
}

/**
 * Create a mock agent that always fails
 */
export function createFailingAgentPlugin(
  error = 'Agent execution failed',
): AgentPlugin {
  return createMockAgentPlugin({
    executeResult: createFailedExecution(error),
  });
}

/**
 * Create a mock agent that is rate-limited
 */
export function createRateLimitedAgentPlugin(): AgentPlugin {
  return createMockAgentPlugin({
    executeResult: createRateLimitedExecution(),
  });
}

/**
 * Create a mock agent that is not available
 */
export function createUnavailableAgentPlugin(): AgentPlugin {
  return createMockAgentPlugin({
    detectResult: createUnavailableDetectResult(),
    isReady: false,
  });
}
