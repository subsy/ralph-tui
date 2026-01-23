/**
 * ABOUTME: Tests for the BaseAgentPlugin class.
 * Tests preflight functionality and other base plugin methods.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from 'bun:test';

// Import the module to test internal functions via a workaround
// We'll test the public interface and behavior
import {
  BaseAgentPlugin,
  DEFAULT_ENV_EXCLUDE_PATTERNS,
  getEnvExclusionReport,
  formatEnvExclusionReport,
} from './base.js';
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
    error?: string
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
    _options?: AgentExecuteOptions
  ): string[] {
    return ['run', '--prompt'];
  }

  // Override execute to provide controlled responses for testing
  override execute(
    _prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions
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

  // Test accessor for protected method
  testGetPreflightSuggestion(): string {
    return this.getPreflightSuggestion();
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
      const suggestion = agent.testGetPreflightSuggestion();

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

/**
 * Test plugin that uses the real execute method for testing lifecycle hooks.
 * Uses 'cmd /c echo' on Windows and 'echo' on other platforms.
 */
class RealExecuteTestPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'real-execute-test',
    name: 'Real Execute Test',
    description: 'Test plugin using real execute method',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: process.platform === 'win32' ? 'cmd' : 'echo',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    // On Windows: cmd /c echo <prompt>
    // On Unix: echo (command) with prompt as arg
    if (process.platform === 'win32') {
      return ['/c', 'echo', prompt];
    }
    return [prompt];
  }

  override async detect(): Promise<AgentDetectResult> {
    return {
      available: true,
      version: '1.0.0',
      executablePath: this.meta.defaultCommand,
    };
  }
}

describe('BaseAgentPlugin execute lifecycle', () => {
  let agent: RealExecuteTestPlugin;

  beforeEach(() => {
    agent = new RealExecuteTestPlugin();
  });

  afterEach(async () => {
    await agent.dispose();
  });

  describe('onEnd lifecycle hook', () => {
    test('calls onEnd with execution result when process completes', async () => {
      await agent.initialize({});

      let onEndCalled = false;
      let receivedResult: unknown = null;

      const handle = agent.execute('test-output', [], {
        onEnd: (result) => {
          onEndCalled = true;
          receivedResult = result;
        },
      });

      const result = await handle.promise;

      expect(result.status).toBe('completed');
      expect(onEndCalled).toBe(true);
      expect(receivedResult).not.toBeNull();
      expect((receivedResult as { executionId: string }).executionId).toBe(result.executionId);
    });

    test('resolves promise even when onEnd throws', async () => {
      await agent.initialize({});

      const handle = agent.execute('test-output', [], {
        onEnd: () => {
          throw new Error('onEnd hook intentionally threw');
        },
      });

      // Should NOT reject, should still resolve
      const result = await handle.promise;

      expect(result.status).toBe('completed');
      expect(result.exitCode).toBe(0);
    });

    test('executes without onEnd callback', async () => {
      await agent.initialize({});

      // Execute without onEnd - should not throw
      const handle = agent.execute('test-output', [], {});

      const result = await handle.promise;

      expect(result.status).toBe('completed');
    });
  });

  describe('onStdout callback', () => {
    test('calls onStdout with process output', async () => {
      await agent.initialize({});

      let stdoutData = '';

      const handle = agent.execute('hello-world', [], {
        onStdout: (data) => {
          stdoutData += data;
        },
      });

      await handle.promise;

      expect(stdoutData).toContain('hello-world');
    });
  });

  describe('onStart callback', () => {
    test('calls onStart with execution ID', async () => {
      await agent.initialize({});

      let startExecutionId = '';

      const handle = agent.execute('test', [], {
        onStart: (execId) => {
          startExecutionId = execId;
        },
      });

      const result = await handle.promise;

      expect(startExecutionId).not.toBe('');
      expect(startExecutionId).toBe(result.executionId);
    });
  });
});

/**
 * Test plugin that prints environment variables for testing envExclude.
 * Uses 'printenv' on Unix or 'set' on Windows to list environment variables.
 */
class EnvTestPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'env-test',
    name: 'Env Test',
    description: 'Test plugin for environment variable filtering',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: process.platform === 'win32' ? 'cmd' : 'printenv',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    // On Windows: cmd /c set <VARNAME>
    // On Unix: printenv <VARNAME>
    if (process.platform === 'win32') {
      return ['/c', 'set', prompt];
    }
    return [prompt];
  }

  override async detect(): Promise<AgentDetectResult> {
    return {
      available: true,
      version: '1.0.0',
      executablePath: this.meta.defaultCommand,
    };
  }
}

describe('BaseAgentPlugin envExclude', () => {
  describe('initialize with envExclude', () => {
    test('stores envExclude patterns from config', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['API_KEY', '*_SECRET'],
      });

      // We can verify this by checking the agent is ready
      // The actual filtering is tested in execute tests
      await expect(agent.isReady()).resolves.toBe(true);
      await agent.dispose();
    });

    test('handles empty envExclude array', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: [],
      });

      await expect(agent.isReady()).resolves.toBe(true);
      await agent.dispose();
    });

    test('filters out non-string values in envExclude', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['VALID', 123, null, 'ALSO_VALID', ''],
      });

      await expect(agent.isReady()).resolves.toBe(true);
      await agent.dispose();
    });
  });

  describe('environment variable filtering during execute', () => {
    test('excludes exact match environment variables', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['TEST_EXCLUDE_VAR'],
      });

      // Set up test environment variable
      const originalValue = process.env.TEST_EXCLUDE_VAR;
      process.env.TEST_EXCLUDE_VAR = 'should_be_excluded';

      let stdout = '';
      const handle = agent.execute('TEST_EXCLUDE_VAR', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      // Clean up
      if (originalValue === undefined) {
        delete process.env.TEST_EXCLUDE_VAR;
      } else {
        process.env.TEST_EXCLUDE_VAR = originalValue;
      }

      await agent.dispose();

      // The variable should NOT be in the output because it was excluded
      // printenv returns empty/error for non-existent vars
      expect(stdout).not.toContain('should_be_excluded');
    });

    test('excludes variables matching glob pattern with *', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['TEST_*_PATTERN'],
      });

      // Set up test environment variable
      const originalValue = process.env.TEST_GLOB_PATTERN;
      process.env.TEST_GLOB_PATTERN = 'glob_excluded';

      let stdout = '';
      const handle = agent.execute('TEST_GLOB_PATTERN', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      // Clean up
      if (originalValue === undefined) {
        delete process.env.TEST_GLOB_PATTERN;
      } else {
        process.env.TEST_GLOB_PATTERN = originalValue;
      }

      await agent.dispose();

      // The variable should NOT be in the output
      expect(stdout).not.toContain('glob_excluded');
    });

    test('does not exclude variables that do not match patterns', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['EXCLUDED_VAR'],
      });

      // Set up test environment variable that should NOT be excluded
      const originalValue = process.env.TEST_KEPT_VAR;
      process.env.TEST_KEPT_VAR = 'should_remain';

      let stdout = '';
      const handle = agent.execute('TEST_KEPT_VAR', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      // Clean up
      if (originalValue === undefined) {
        delete process.env.TEST_KEPT_VAR;
      } else {
        process.env.TEST_KEPT_VAR = originalValue;
      }

      await agent.dispose();

      // The variable SHOULD be in the output
      expect(stdout).toContain('should_remain');
    });

    test('excludes ANTHROPIC_API_KEY when configured', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['ANTHROPIC_API_KEY'],
      });

      // Set up test environment variable
      const originalValue = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      let stdout = '';
      const handle = agent.execute('ANTHROPIC_API_KEY', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      // Clean up
      if (originalValue === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalValue;
      }

      await agent.dispose();

      // The API key should NOT be in the output
      expect(stdout).not.toContain('sk-ant-test-key');
    });

    test('excludes multiple patterns with *_API_KEY and *_SECRET', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['*_API_KEY', '*_SECRET'],
      });

      // Set up test environment variables
      const origApiKey = process.env.MY_API_KEY;
      const origSecret = process.env.DB_SECRET;
      process.env.MY_API_KEY = 'my-api-key-value';
      process.env.DB_SECRET = 'db-secret-value';

      // Test MY_API_KEY is excluded
      let stdout1 = '';
      const handle1 = agent.execute('MY_API_KEY', [], {
        onStdout: (data) => {
          stdout1 += data;
        },
      });
      await handle1.promise;
      expect(stdout1).not.toContain('my-api-key-value');

      // Test DB_SECRET is excluded
      let stdout2 = '';
      const handle2 = agent.execute('DB_SECRET', [], {
        onStdout: (data) => {
          stdout2 += data;
        },
      });
      await handle2.promise;
      expect(stdout2).not.toContain('db-secret-value');

      // Clean up
      if (origApiKey === undefined) {
        delete process.env.MY_API_KEY;
      } else {
        process.env.MY_API_KEY = origApiKey;
      }
      if (origSecret === undefined) {
        delete process.env.DB_SECRET;
      } else {
        process.env.DB_SECRET = origSecret;
      }

      await agent.dispose();
    });
  });

  describe('default environment variable exclusion', () => {
    test('excludes *_API_KEY by default without any user config', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({});

      const originalValue = process.env.TEST_API_KEY;
      process.env.TEST_API_KEY = 'default-excluded-key';

      let stdout = '';
      const handle = agent.execute('TEST_API_KEY', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = originalValue;
      }

      await agent.dispose();

      expect(stdout).not.toContain('default-excluded-key');
    });

    test('excludes *_SECRET by default without any user config', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({});

      const originalValue = process.env.TEST_DB_SECRET;
      process.env.TEST_DB_SECRET = 'default-excluded-secret';

      let stdout = '';
      const handle = agent.execute('TEST_DB_SECRET', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.TEST_DB_SECRET;
      } else {
        process.env.TEST_DB_SECRET = originalValue;
      }

      await agent.dispose();

      expect(stdout).not.toContain('default-excluded-secret');
    });

    test('excludes *_SECRET_KEY by default without any user config', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({});

      const originalValue = process.env.AWS_SECRET_KEY;
      process.env.AWS_SECRET_KEY = 'default-excluded-secret-key';

      let stdout = '';
      const handle = agent.execute('AWS_SECRET_KEY', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.AWS_SECRET_KEY;
      } else {
        process.env.AWS_SECRET_KEY = originalValue;
      }

      await agent.dispose();

      expect(stdout).not.toContain('default-excluded-secret-key');
    });

    test('excludes ANTHROPIC_API_KEY by default (the key billing issue)', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({});

      const originalValue = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-default-excluded';

      let stdout = '';
      const handle = agent.execute('ANTHROPIC_API_KEY', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalValue;
      }

      await agent.dispose();

      expect(stdout).not.toContain('sk-ant-default-excluded');
    });

    test('allows non-sensitive variables through by default', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({});

      const originalValue = process.env.TEST_SAFE_VAR;
      process.env.TEST_SAFE_VAR = 'safe-value-kept';

      let stdout = '';
      const handle = agent.execute('TEST_SAFE_VAR', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.TEST_SAFE_VAR;
      } else {
        process.env.TEST_SAFE_VAR = originalValue;
      }

      await agent.dispose();

      expect(stdout).toContain('safe-value-kept');
    });

    test('user envExclude extends defaults', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['CUSTOM_VAR'],
      });

      const origApiKey = process.env.TEST_API_KEY;
      const origCustom = process.env.CUSTOM_VAR;
      process.env.TEST_API_KEY = 'default-blocked';
      process.env.CUSTOM_VAR = 'custom-blocked';

      // Test default pattern still blocks
      let stdout1 = '';
      const handle1 = agent.execute('TEST_API_KEY', [], {
        onStdout: (data) => {
          stdout1 += data;
        },
      });
      await handle1.promise;
      expect(stdout1).not.toContain('default-blocked');

      // Test user pattern also blocks
      let stdout2 = '';
      const handle2 = agent.execute('CUSTOM_VAR', [], {
        onStdout: (data) => {
          stdout2 += data;
        },
      });
      await handle2.promise;
      expect(stdout2).not.toContain('custom-blocked');

      if (origApiKey === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = origApiKey;
      }
      if (origCustom === undefined) {
        delete process.env.CUSTOM_VAR;
      } else {
        process.env.CUSTOM_VAR = origCustom;
      }

      await agent.dispose();
    });

    test('DEFAULT_ENV_EXCLUDE_PATTERNS is exported and contains expected patterns', () => {
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS).toContain('*_API_KEY');
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS).toContain('*_SECRET_KEY');
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS).toContain('*_SECRET');
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('envPassthrough (allowlist for blocked vars)', () => {
    test('envPassthrough allows a specific blocked key through', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envPassthrough: ['TEST_API_KEY'],
      });

      const originalValue = process.env.TEST_API_KEY;
      process.env.TEST_API_KEY = 'passthrough-allowed';

      let stdout = '';
      const handle = agent.execute('TEST_API_KEY', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = originalValue;
      }

      await agent.dispose();

      expect(stdout).toContain('passthrough-allowed');
    });

    test('envPassthrough with glob pattern allows matching keys through', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envPassthrough: ['ANTHROPIC_*'],
      });

      const originalValue = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'anthropic-passthrough';

      let stdout = '';
      const handle = agent.execute('ANTHROPIC_API_KEY', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalValue;
      }

      await agent.dispose();

      expect(stdout).toContain('anthropic-passthrough');
    });

    test('envPassthrough does not affect other blocked keys', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envPassthrough: ['ANTHROPIC_API_KEY'],
      });

      const originalValue = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'openai-still-blocked';

      let stdout = '';
      const handle = agent.execute('OPENAI_API_KEY', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalValue;
      }

      await agent.dispose();

      expect(stdout).not.toContain('openai-still-blocked');
    });

    test('envPassthrough combined with user envExclude', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['CUSTOM_BLOCK'],
        envPassthrough: ['TEST_API_KEY'],
      });

      const origApiKey = process.env.TEST_API_KEY;
      const origCustom = process.env.CUSTOM_BLOCK;
      process.env.TEST_API_KEY = 'api-key-allowed';
      process.env.CUSTOM_BLOCK = 'custom-still-blocked';

      // Passthrough key is allowed
      let stdout1 = '';
      const handle1 = agent.execute('TEST_API_KEY', [], {
        onStdout: (data) => {
          stdout1 += data;
        },
      });
      await handle1.promise;
      expect(stdout1).toContain('api-key-allowed');

      // User exclusion still blocks
      let stdout2 = '';
      const handle2 = agent.execute('CUSTOM_BLOCK', [], {
        onStdout: (data) => {
          stdout2 += data;
        },
      });
      await handle2.promise;
      expect(stdout2).not.toContain('custom-still-blocked');

      if (origApiKey === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = origApiKey;
      }
      if (origCustom === undefined) {
        delete process.env.CUSTOM_BLOCK;
      } else {
        process.env.CUSTOM_BLOCK = origCustom;
      }

      await agent.dispose();
    });
  });

  describe('getEnvExclusionReport', () => {
    test('reports blocked vars that match default patterns', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ANTHROPIC_API_KEY: 'key1',
        OPENAI_API_KEY: 'key2',
        DB_SECRET: 'sec1',
        AWS_SECRET_KEY: 'sec2',
        SAFE_VAR: 'safe',
        HOME: '/home/user',
      };

      const report = getEnvExclusionReport(testEnv);

      expect(report.blocked).toContain('ANTHROPIC_API_KEY');
      expect(report.blocked).toContain('OPENAI_API_KEY');
      expect(report.blocked).toContain('DB_SECRET');
      expect(report.blocked).toContain('AWS_SECRET_KEY');
      expect(report.blocked).not.toContain('SAFE_VAR');
      expect(report.blocked).not.toContain('HOME');
      expect(report.allowed).toHaveLength(0);
    });

    test('reports allowed vars when passthrough is configured', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ANTHROPIC_API_KEY: 'key1',
        OPENAI_API_KEY: 'key2',
        DB_SECRET: 'sec1',
      };

      const report = getEnvExclusionReport(testEnv, ['ANTHROPIC_API_KEY']);

      expect(report.blocked).toContain('OPENAI_API_KEY');
      expect(report.blocked).toContain('DB_SECRET');
      expect(report.blocked).not.toContain('ANTHROPIC_API_KEY');
      expect(report.allowed).toContain('ANTHROPIC_API_KEY');
    });

    test('supports glob patterns in passthrough', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ANTHROPIC_API_KEY: 'key1',
        OPENAI_API_KEY: 'key2',
        MY_SECRET: 'sec1',
      };

      const report = getEnvExclusionReport(testEnv, ['*_API_KEY']);

      expect(report.allowed).toContain('ANTHROPIC_API_KEY');
      expect(report.allowed).toContain('OPENAI_API_KEY');
      expect(report.blocked).toContain('MY_SECRET');
    });

    test('includes additional exclude patterns in report', () => {
      const testEnv: NodeJS.ProcessEnv = {
        CUSTOM_VAR: 'val',
        ANTHROPIC_API_KEY: 'key1',
      };

      const report = getEnvExclusionReport(testEnv, [], ['CUSTOM_VAR']);

      expect(report.blocked).toContain('CUSTOM_VAR');
      expect(report.blocked).toContain('ANTHROPIC_API_KEY');
    });

    test('returns sorted arrays', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ZEBRA_API_KEY: 'z',
        ALPHA_API_KEY: 'a',
        MY_SECRET: 'm',
      };

      const report = getEnvExclusionReport(testEnv);

      expect(report.blocked).toEqual(['ALPHA_API_KEY', 'MY_SECRET', 'ZEBRA_API_KEY']);
    });

    test('returns empty arrays when no matches', () => {
      const testEnv: NodeJS.ProcessEnv = {
        HOME: '/home/user',
        PATH: '/usr/bin',
      };

      const report = getEnvExclusionReport(testEnv);

      expect(report.blocked).toHaveLength(0);
      expect(report.allowed).toHaveLength(0);
    });
  });

  describe('formatEnvExclusionReport', () => {
    test('shows blocked vars', () => {
      const report = { blocked: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], allowed: [] };
      const lines = formatEnvExclusionReport(report);

      expect(lines).toContain('Env filter:');
      expect(lines.some(l => l.includes('Blocked:') && l.includes('ANTHROPIC_API_KEY'))).toBe(true);
    });

    test('shows allowed vars', () => {
      const report = { blocked: ['OPENAI_API_KEY'], allowed: ['ANTHROPIC_API_KEY'] };
      const lines = formatEnvExclusionReport(report);

      expect(lines).toContain('Env filter:');
      expect(lines.some(l => l.includes('Passthrough:') && l.includes('ANTHROPIC_API_KEY'))).toBe(true);
      expect(lines.some(l => l.includes('Blocked:') && l.includes('OPENAI_API_KEY'))).toBe(true);
    });

    test('shows "no vars matched" when both arrays are empty', () => {
      const report = { blocked: [], allowed: [] };
      const lines = formatEnvExclusionReport(report);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('no vars matched exclusion patterns'))).toBe(true);
      expect(lines.some(l => l.includes('*_API_KEY'))).toBe(true);
    });

    test('always returns non-empty array', () => {
      const emptyReport = { blocked: [], allowed: [] };
      const lines = formatEnvExclusionReport(emptyReport);
      expect(lines.length).toBeGreaterThan(0);
    });

    test('shows only blocked when no passthrough configured', () => {
      const report = { blocked: ['MY_SECRET'], allowed: [] };
      const lines = formatEnvExclusionReport(report);

      expect(lines.some(l => l.includes('Blocked:'))).toBe(true);
      expect(lines.some(l => l.includes('Passthrough:'))).toBe(false);
    });

    test('shows only passthrough when all blocked vars are allowed', () => {
      const report = { blocked: [], allowed: ['ANTHROPIC_API_KEY'] };
      const lines = formatEnvExclusionReport(report);

      expect(lines.some(l => l.includes('Passthrough:'))).toBe(true);
      expect(lines.some(l => l.includes('Blocked:'))).toBe(false);
    });
  });

  describe('BaseAgentPlugin.getExclusionReport', () => {
    test('returns report using agent passthrough config', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envPassthrough: ['TEST_API_KEY'],
      });

      const origApiKey = process.env.TEST_API_KEY;
      const origSecret = process.env.TEST_SECRET;
      process.env.TEST_API_KEY = 'val1';
      process.env.TEST_SECRET = 'val2';

      const report = agent.getExclusionReport();

      expect(report.allowed).toContain('TEST_API_KEY');
      expect(report.blocked).toContain('TEST_SECRET');

      if (origApiKey === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = origApiKey;
      }
      if (origSecret === undefined) {
        delete process.env.TEST_SECRET;
      } else {
        process.env.TEST_SECRET = origSecret;
      }

      await agent.dispose();
    });

    test('includes user envExclude in report', async () => {
      const agent = new EnvTestPlugin();
      await agent.initialize({
        envExclude: ['CUSTOM_BLOCK'],
      });

      const origCustom = process.env.CUSTOM_BLOCK;
      process.env.CUSTOM_BLOCK = 'blocked-val';

      const report = agent.getExclusionReport();

      expect(report.blocked).toContain('CUSTOM_BLOCK');

      if (origCustom === undefined) {
        delete process.env.CUSTOM_BLOCK;
      } else {
        process.env.CUSTOM_BLOCK = origCustom;
      }

      await agent.dispose();
    });
  });
});
