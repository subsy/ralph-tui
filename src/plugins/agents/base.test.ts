/**
 * ABOUTME: Tests for the BaseAgentPlugin class.
 * Tests preflight functionality and other base plugin methods.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';

import { BaseAgentPlugin } from './base.js';
import type {
  AgentPluginMeta,
  AgentFileContext,
  AgentExecuteOptions,
  AgentDetectResult,
  AgentExecutionStatus,
  AgentExecutionHandle,
} from './types.js';

/**
 * Concrete test implementation of BaseAgentPlugin for testing purposes.
 */
class TestAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent for unit testing',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: 'test-agent-cli',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  // Allow tests to control detect result
  private mockDetectResult: AgentDetectResult = {
    available: true,
    version: '1.0.0',
    executablePath: '/usr/bin/test-agent',
  };

  // Allow tests to control execution behavior
  private mockExecutionOutput = 'PREFLIGHT_OK';
  private mockExecutionStatus: AgentExecutionStatus = 'completed';
  private mockExecutionError?: string;

  setMockDetectResult(result: AgentDetectResult): void {
    this.mockDetectResult = result;
  }

  setMockExecutionResult(
    status: 'completed' | 'failed' | 'timeout',
    output = 'PREFLIGHT_OK',
    error?: string,
  ): void {
    this.mockExecutionStatus = status;
    this.mockExecutionOutput = output;
    this.mockExecutionError = error;
  }

  override async detect(): Promise<AgentDetectResult> {
    return this.mockDetectResult;
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions,
  ): string[] {
    return ['run', '--prompt'];
  }

  // Override execute to provide controlled responses for testing
  override execute(
    _prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions,
  ): AgentExecutionHandle {
    const executionId = 'test-execution-' + Date.now();
    const startedAt = new Date();

    // Call onStdout with mock output if provided
    if (options?.onStdout && this.mockExecutionOutput) {
      setTimeout(() => {
        options.onStdout?.(this.mockExecutionOutput);
      }, 10);
    }

    const promise = new Promise<{
      executionId: string;
      status: AgentExecutionStatus;
      exitCode?: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      error?: string;
      interrupted: boolean;
      startedAt: string;
      endedAt: string;
    }>((resolve) => {
      setTimeout(() => {
        resolve({
          executionId,
          status: this.mockExecutionStatus,
          exitCode: this.mockExecutionStatus === 'completed' ? 0 : 1,
          stdout: this.mockExecutionOutput,
          stderr: '',
          durationMs: 100,
          error: this.mockExecutionError,
          interrupted: false,
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
        });
      }, 20);
    });

    return {
      executionId,
      promise,
      interrupt: () => true,
      isRunning: () => false,
    };
  }
}

describe('BaseAgentPlugin', () => {
  let agent: TestAgentPlugin;

  beforeEach(() => {
    agent = new TestAgentPlugin();
  });

  afterEach(async () => {
    await agent.dispose();
  });

  describe('preflight', () => {
    test('returns success when detect passes and execution completes', async () => {
      agent.setMockDetectResult({
        available: true,
        version: '1.0.0',
        executablePath: '/usr/bin/test',
      });
      agent.setMockExecutionResult('completed', 'PREFLIGHT_OK');

      const result = await agent.preflight({ timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    test('returns failure when detect fails', async () => {
      agent.setMockDetectResult({
        available: false,
        error: 'CLI not found in PATH',
      });

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.error).toContain('CLI not found');
      expect(result.suggestion).toContain('Test Agent');
    });

    test('returns failure when execution times out', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('timeout');

      const result = await agent.preflight({ timeout: 1000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    test('returns failure when execution fails', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('failed', '', 'API key not configured');

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key not configured');
    });

    test('returns failure when no output is produced', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('completed', ''); // Empty output

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.error).toContain('did not produce any output');
    });

    test('includes duration in result', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('completed', 'OK');

      const result = await agent.preflight();

      expect(result.durationMs).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('uses default timeout when not specified', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('completed', 'OK');

      // This should not throw and should use default 15 second timeout
      const result = await agent.preflight();
      expect(result.success).toBe(true);
    });

    test('includes suggestion on failure', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('failed');

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('Test Agent');
    });
  });

  describe('getPreflightSuggestion', () => {
    test('returns agent-specific suggestion', () => {
      // Access protected method through type assertion
      const suggestion = (agent as any).getPreflightSuggestion();

      expect(suggestion).toContain('Test Agent');
      expect(suggestion).toContain('configured');
    });
  });

  describe('initialize', () => {
    test('sets ready state to true', async () => {
      await expect(agent.isReady()).resolves.toBe(false);

      await agent.initialize({});

      await expect(agent.isReady()).resolves.toBe(true);
    });

    test('can be configured with custom command', async () => {
      await agent.initialize({ command: '/custom/path/agent' });

      // The command should be stored (implementation detail)
      await expect(agent.isReady()).resolves.toBe(true);
    });
  });

  describe('dispose', () => {
    test('sets ready state to false', async () => {
      await agent.initialize({});
      await expect(agent.isReady()).resolves.toBe(true);

      await agent.dispose();

      await expect(agent.isReady()).resolves.toBe(false);
    });
  });

  describe('getSetupQuestions', () => {
    test('returns command and timeout questions', () => {
      const questions = agent.getSetupQuestions();

      expect(questions.length).toBeGreaterThanOrEqual(2);

      const commandQuestion = questions.find((q) => q.id === 'command');
      expect(commandQuestion).toBeDefined();
      expect(commandQuestion?.type).toBe('path');

      const timeoutQuestion = questions.find((q) => q.id === 'timeout');
      expect(timeoutQuestion).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('returns null for valid answers (accepts all by default)', async () => {
      const result = await agent.validateSetup({ command: '/path/to/agent' });
      expect(result).toBeNull();
    });
  });

  describe('validateModel', () => {
    test('returns null for any model (accepts all by default)', () => {
      const result = agent.validateModel('any-model-name');
      expect(result).toBeNull();
    });
  });
});
