/**
 * ABOUTME: Tests for BaseAgentPlugin execute lifecycle and envExclude functionality.
 *
 * This test file creates test plugins that override BaseAgentPlugin.execute() to call
 * Bun.spawn directly instead of node:child_process.spawn. This isolation is necessary
 * because Bun's mock.restore() does not reliably restore builtin modules, and other
 * test files mock node:child_process at the module level.
 *
 * See: https://github.com/oven-sh/bun/issues/7823
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { platform } from 'node:os';
import type {
  AgentPluginMeta,
  AgentFileContext,
  AgentExecuteOptions,
  AgentDetectResult,
  AgentExecutionStatus,
  AgentExecutionHandle,
  AgentExecutionResult,
} from '../../../src/plugins/agents/types.js';
import {
  BaseAgentPlugin,
  DEFAULT_ENV_EXCLUDE_PATTERNS,
} from '../../../src/plugins/agents/base.js';
import { randomUUID } from 'node:crypto';

/**
 * Test plugin that uses Bun.spawn directly for execute to test lifecycle hooks.
 * Uses 'echo' command to produce predictable output.
 */
class BunSpawnTestPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'bun-spawn-test',
    name: 'Bun Spawn Test',
    description: 'Test plugin using Bun.spawn directly',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: platform() === 'win32' ? 'cmd' : 'echo',
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
    if (platform() === 'win32') {
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

  /**
   * Override execute to use Bun.spawn directly, bypassing node:child_process.
   * This is the key to avoiding mock pollution from other tests.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    const executionId = randomUUID();
    const command = this.meta.defaultCommand;
    const args = this.buildArgs(prompt, files, options);
    const startedAt = new Date();

    let resolvePromise: (result: AgentExecutionResult) => void;
    const promise = new Promise<AgentExecutionResult>((resolve) => {
      resolvePromise = resolve;
    });

    const runExecution = async (): Promise<void> => {
      let stdout = '';
      let stderr = '';

      try {
        options?.onStart?.(executionId);

        const proc = Bun.spawn([command, ...args], {
          cwd: options?.cwd ?? process.cwd(),
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const stdoutReader = proc.stdout.getReader();
        const stderrReader = proc.stderr.getReader();

        const readStream = async (
          reader: ReadableStreamDefaultReader<Uint8Array>,
          callback?: (data: string) => void
        ): Promise<string> => {
          let result = '';
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            result += text;
            callback?.(text);
          }
          return result;
        };

        const [stdoutResult, stderrResult] = await Promise.all([
          readStream(stdoutReader, options?.onStdout),
          readStream(stderrReader, options?.onStderr),
        ]);

        stdout = stdoutResult;
        stderr = stderrResult;

        const exitCode = await proc.exited;
        const endedAt = new Date();

        const status: AgentExecutionStatus =
          exitCode === 0 ? 'completed' : 'failed';

        const result: AgentExecutionResult = {
          executionId,
          status,
          exitCode,
          stdout,
          stderr,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          interrupted: false,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        };

        try {
          options?.onEnd?.(result);
        } catch {
          // Swallow onEnd errors
        }

        resolvePromise!(result);
      } catch (error) {
        const endedAt = new Date();
        const result: AgentExecutionResult = {
          executionId,
          status: 'failed',
          exitCode: 1,
          stdout,
          stderr,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          interrupted: false,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        };

        try {
          options?.onEnd?.(result);
        } catch {
          // Swallow onEnd errors
        }

        resolvePromise!(result);
      }
    };

    void runExecution();

    return {
      executionId,
      promise,
      interrupt: () => true,
      isRunning: () => false,
    };
  }
}

/**
 * Test plugin that uses Bun.spawn to run printenv for testing envExclude.
 * Environment filtering is applied before spawning.
 */
class BunSpawnEnvTestPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'bun-spawn-env-test',
    name: 'Bun Spawn Env Test',
    description: 'Test plugin for environment variable filtering',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: platform() === 'win32' ? 'cmd' : 'printenv',
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
    if (platform() === 'win32') {
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

  /**
   * Override execute to use Bun.spawn with environment filtering.
   * Applies the same filtering logic as BaseAgentPlugin.execute() but using Bun.spawn.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    const executionId = randomUUID();
    const command = this.meta.defaultCommand;
    const args = this.buildArgs(prompt, files, options);
    const startedAt = new Date();

    let resolvePromise: (result: AgentExecutionResult) => void;
    const promise = new Promise<AgentExecutionResult>((resolve) => {
      resolvePromise = resolve;
    });

    const runExecution = async (): Promise<void> => {
      options?.onStart?.(executionId);

      // Apply environment filtering (mirrors BaseAgentPlugin.execute logic)
      const effectiveExclude = [
        ...DEFAULT_ENV_EXCLUDE_PATTERNS,
        ...this.envExclude,
      ];
      const filteredEnv = this.filterEnv(
        process.env,
        effectiveExclude,
        this.envPassthrough
      );
      const env = {
        ...filteredEnv,
        ...options?.env,
      };

      const proc = Bun.spawn([command, ...args], {
        cwd: options?.cwd ?? process.cwd(),
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      const stdoutReader = proc.stdout.getReader();
      const stderrReader = proc.stderr.getReader();

      const readStream = async (
        reader: ReadableStreamDefaultReader<Uint8Array>,
        callback?: (data: string) => void
      ): Promise<string> => {
        let result = '';
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          result += text;
          callback?.(text);
        }
        return result;
      };

      const [stdoutResult, stderrResult] = await Promise.all([
        readStream(stdoutReader, options?.onStdout),
        readStream(stderrReader, options?.onStderr),
      ]);

      stdout = stdoutResult;
      stderr = stderrResult;

      const exitCode = await proc.exited;
      const endedAt = new Date();

      const status: AgentExecutionStatus =
        exitCode === 0 ? 'completed' : 'failed';

      const result: AgentExecutionResult = {
        executionId,
        status,
        exitCode,
        stdout,
        stderr,
        durationMs: endedAt.getTime() - startedAt.getTime(),
        interrupted: false,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      };

      if (options?.onEnd) {
        try {
          options.onEnd(result);
        } catch {
          // Swallow error
        }
      }

      resolvePromise!(result);
    };

    void runExecution();

    return {
      executionId,
      promise,
      interrupt: () => true,
      isRunning: () => false,
    };
  }

  /**
   * Filter environment variables by exclusion patterns with passthrough override.
   */
  private filterEnv(
    env: NodeJS.ProcessEnv,
    excludePatterns: string[],
    passthroughPatterns: string[]
  ): NodeJS.ProcessEnv {
    if (!excludePatterns || excludePatterns.length === 0) {
      return env;
    }

    const filtered: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(env)) {
      const matchesExclude = excludePatterns.some((pattern) =>
        this.globMatch(pattern, key)
      );
      if (!matchesExclude) {
        filtered[key] = value;
      } else if (
        passthroughPatterns.length > 0 &&
        passthroughPatterns.some((pattern) => this.globMatch(pattern, key))
      ) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  /**
   * Simple glob matching for environment variable patterns.
   */
  private globMatch(pattern: string, str: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(str);
  }
}

describe('BaseAgentPlugin execute lifecycle (Bun.spawn)', () => {
  let agent: BunSpawnTestPlugin;

  beforeEach(() => {
    agent = new BunSpawnTestPlugin();
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
      expect(
        (receivedResult as { executionId: string }).executionId
      ).toBe(result.executionId);
    });

    test('resolves promise even when onEnd throws', async () => {
      await agent.initialize({});

      const handle = agent.execute('test-output', [], {
        onEnd: () => {
          throw new Error('onEnd hook intentionally threw');
        },
      });

      const result = await handle.promise;

      expect(result.status).toBe('completed');
      expect(result.exitCode).toBe(0);
    });

    test('executes without onEnd callback', async () => {
      await agent.initialize({});

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

describe('BaseAgentPlugin envExclude (Bun.spawn)', () => {
  describe('environment variable filtering during execute', () => {
    test('does not exclude variables that do not match patterns', async () => {
      const agent = new BunSpawnEnvTestPlugin();
      await agent.initialize({
        envExclude: ['EXCLUDED_VAR'],
      });

      const originalValue = process.env.TEST_KEPT_VAR;
      process.env.TEST_KEPT_VAR = 'should_remain';

      let stdout = '';
      const handle = agent.execute('TEST_KEPT_VAR', [], {
        onStdout: (data) => {
          stdout += data;
        },
      });

      await handle.promise;

      if (originalValue === undefined) {
        delete process.env.TEST_KEPT_VAR;
      } else {
        process.env.TEST_KEPT_VAR = originalValue;
      }

      await agent.dispose();

      expect(stdout).toContain('should_remain');
    });

    test('allows non-sensitive variables through by default', async () => {
      const agent = new BunSpawnEnvTestPlugin();
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
  });

  describe('envPassthrough (allowlist for blocked vars)', () => {
    test('envPassthrough allows a specific blocked key through', async () => {
      const agent = new BunSpawnEnvTestPlugin();
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
      const agent = new BunSpawnEnvTestPlugin();
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

    test('envPassthrough combined with user envExclude', async () => {
      const agent = new BunSpawnEnvTestPlugin();
      await agent.initialize({
        envExclude: ['CUSTOM_BLOCK'],
        envPassthrough: ['TEST_API_KEY'],
      });

      const origApiKey = process.env.TEST_API_KEY;
      process.env.TEST_API_KEY = 'api-key-allowed';

      let stdout1 = '';
      const handle1 = agent.execute('TEST_API_KEY', [], {
        onStdout: (data) => {
          stdout1 += data;
        },
      });
      await handle1.promise;
      expect(stdout1).toContain('api-key-allowed');

      if (origApiKey === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = origApiKey;
      }

      await agent.dispose();
    });
  });
});
