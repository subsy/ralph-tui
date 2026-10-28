/**
 * ABOUTME: Tests for the OpenCodeAgentPlugin.
 * Tests specific behaviors like model validation, setup questions, and agent types.
 * Also tests stdin input handling for Windows shell interpretation safety.
 * Also tests buffer flushing on stream end for reliable JSONL parsing.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  OpenCodeAgentPlugin,
  createOpenCodeJsonlBuffer,
  shouldPassOpenCodePromptViaStdin,
} from '../../src/plugins/agents/builtin/opencode.js';
import type { AgentFileContext, AgentExecuteOptions, AgentExecutionResult } from '../../src/plugins/agents/types.js';

/**
 * Test subclass to expose protected methods for testing.
 */
class TestableOpenCodePlugin extends OpenCodeAgentPlugin {
  /** Expose buildArgs for testing */
  testBuildArgs(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    return this['buildArgs'](prompt, files, options);
  }

  /** Expose getStdinInput for testing */
  testGetStdinInput(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string | undefined {
    return this['getStdinInput'](prompt, files, options);
  }

  /** Expose getPreflightSuggestion for testing */
  testGetPreflightSuggestion(): string {
    return this['getPreflightSuggestion']();
  }

  /** Expose buildModelString for testing */
  testBuildModelString(): string | undefined {
    return this['buildModelString']();
  }
}

describe('OpenCodeAgentPlugin', () => {
  let plugin: OpenCodeAgentPlugin;

  beforeEach(() => {
    plugin = new OpenCodeAgentPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('opencode');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('opencode');
    });

    test('supports streaming', () => {
      expect(plugin.meta.supportsStreaming).toBe(true);
    });

    test('supports interruption', () => {
      expect(plugin.meta.supportsInterrupt).toBe(true);
    });

    test('supports file context', () => {
      expect(plugin.meta.supportsFileContext).toBe(true);
    });

    test('supports subagent tracing', () => {
      expect(plugin.meta.supportsSubagentTracing).toBe(true);
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts provider config', async () => {
      await plugin.initialize({ provider: 'anthropic' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'claude-3-5-sonnet' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts variant config', async () => {
      // Variant validation is delegated to OpenCode CLI - any string is accepted
      await plugin.initialize({ variant: 'high' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts any variant string', async () => {
      // Different models support different variants, so we accept any value
      await plugin.initialize({ variant: 'custom-variant' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts agent type config', async () => {
      await plugin.initialize({ agent: 'build' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts format config', async () => {
      await plugin.initialize({ format: 'json' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 120000 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores invalid agent type', async () => {
      await plugin.initialize({ agent: 'invalid' });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts empty string', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts provider/model format', () => {
      expect(plugin.validateModel('anthropic/claude-3-5-sonnet')).toBeNull();
    });

    test('accepts openai provider format', () => {
      expect(plugin.validateModel('openai/gpt-4o')).toBeNull();
    });

    test('accepts model without provider', () => {
      expect(plugin.validateModel('claude-3-5-sonnet')).toBeNull();
    });

    test('rejects malformed provider/model', () => {
      const result = plugin.validateModel('provider/');
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid model format');
    });

    test('rejects empty provider with slash', () => {
      const result = plugin.validateModel('/model');
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid model format');
    });
  });

  describe('validateSetup', () => {
    test('accepts valid agent type: general', async () => {
      expect(await plugin.validateSetup({ agent: 'general' })).toBeNull();
    });

    test('accepts valid agent type: build', async () => {
      expect(await plugin.validateSetup({ agent: 'build' })).toBeNull();
    });

    test('accepts valid agent type: plan', async () => {
      expect(await plugin.validateSetup({ agent: 'plan' })).toBeNull();
    });

    test('accepts empty agent type', async () => {
      expect(await plugin.validateSetup({ agent: '' })).toBeNull();
    });

    test('rejects invalid agent type', async () => {
      const result = await plugin.validateSetup({ agent: 'invalid' });
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid agent type');
    });

    test('accepts any provider string', async () => {
      // OpenCode supports 75+ providers - validation is delegated to CLI
      expect(await plugin.validateSetup({ provider: 'anthropic' })).toBeNull();
      expect(await plugin.validateSetup({ provider: 'openai' })).toBeNull();
      expect(await plugin.validateSetup({ provider: 'google' })).toBeNull();
      expect(await plugin.validateSetup({ provider: 'custom-provider' })).toBeNull();
    });

    test('accepts any variant string', async () => {
      // Variant validation is delegated to OpenCode CLI - different models have different values
      expect(await plugin.validateSetup({ variant: 'minimal' })).toBeNull();
      expect(await plugin.validateSetup({ variant: 'high' })).toBeNull();
      expect(await plugin.validateSetup({ variant: 'max' })).toBeNull();
      expect(await plugin.validateSetup({ variant: 'custom' })).toBeNull();
      expect(await plugin.validateSetup({ variant: '' })).toBeNull();
    });
  });

  describe('getSetupQuestions', () => {
    test('includes command question from base', () => {
      const questions = plugin.getSetupQuestions();
      const commandQuestion = questions.find((q) => q.id === 'command');
      expect(commandQuestion).toBeDefined();
      expect(commandQuestion?.type).toBe('path');
    });

    test('includes provider question', () => {
      const questions = plugin.getSetupQuestions();
      const providerQuestion = questions.find((q) => q.id === 'provider');
      expect(providerQuestion).toBeDefined();
      expect(providerQuestion?.type).toBe('select');
      expect(providerQuestion?.choices?.some((c) => c.value === 'anthropic')).toBe(true);
      expect(providerQuestion?.choices?.some((c) => c.value === 'openai')).toBe(true);
    });

    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('text');
    });

    test('includes agent type question', () => {
      const questions = plugin.getSetupQuestions();
      const agentQuestion = questions.find((q) => q.id === 'agent');
      expect(agentQuestion).toBeDefined();
      expect(agentQuestion?.type).toBe('select');
      expect(agentQuestion?.choices?.length).toBe(3);
    });

    // Note: format is not a setup question - it's hardcoded to 'json'
    // because the streaming output parser requires JSON format to work
  });

  describe('dispose', () => {
    test('disposes cleanly', async () => {
      await plugin.initialize({});
      await plugin.dispose();
      expect(await plugin.isReady()).toBe(false);
    });
  });

  describe('getSandboxRequirements', () => {
    test('returns correct auth paths', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.authPaths).toContain('~/.opencode');
      expect(requirements.authPaths).toContain('~/.config/opencode');
      expect(requirements.authPaths).toContain('~/.local/share/opencode');
    });

    test('returns correct binary paths', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.binaryPaths).toContain('/usr/local/bin');
      expect(requirements.binaryPaths).toContain('~/.local/bin');
      expect(requirements.binaryPaths).toContain('~/go/bin');
    });

    test('requires network', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.requiresNetwork).toBe(true);
    });

    test('has empty runtime paths', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.runtimePaths).toEqual([]);
    });
  });

  describe('getPreflightSuggestion', () => {
    let testablePlugin: TestableOpenCodePlugin;

    beforeEach(async () => {
      testablePlugin = new TestableOpenCodePlugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('returns helpful suggestion text', () => {
      const suggestion = testablePlugin.testGetPreflightSuggestion();
      expect(suggestion).toContain('Common fixes for OpenCode');
      expect(suggestion).toContain('opencode run');
      expect(suggestion).toContain('API key');
    });
  });

  describe('buildModelString', () => {
    let testablePlugin: TestableOpenCodePlugin;

    beforeEach(async () => {
      testablePlugin = new TestableOpenCodePlugin();
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('returns provider/model format when both set', async () => {
      await testablePlugin.initialize({ provider: 'anthropic', model: 'claude-3-5-sonnet' });
      const result = testablePlugin.testBuildModelString();
      expect(result).toBe('anthropic/claude-3-5-sonnet');
    });

    test('returns model only when no provider', async () => {
      await testablePlugin.initialize({ model: 'gpt-4o' });
      const result = testablePlugin.testBuildModelString();
      expect(result).toBe('gpt-4o');
    });

    test('returns undefined when no model', async () => {
      await testablePlugin.initialize({});
      const result = testablePlugin.testBuildModelString();
      expect(result).toBeUndefined();
    });

    test('handles model with embedded provider', async () => {
      await testablePlugin.initialize({ model: 'openai/gpt-4o' });
      const result = testablePlugin.testBuildModelString();
      expect(result).toBe('openai/gpt-4o');
    });
  });

  describe('shouldPassOpenCodePromptViaStdin', () => {
    test('returns false for native Windows executables', () => {
      expect(shouldPassOpenCodePromptViaStdin('C:\\Tools\\opencode.exe', 'win32')).toBe(false);
    });

    test('returns true for Windows shell wrappers', () => {
      expect(shouldPassOpenCodePromptViaStdin('C:\\Tools\\opencode.cmd', 'win32')).toBe(true);
      expect(shouldPassOpenCodePromptViaStdin('C:\\Tools\\opencode.bat', 'win32')).toBe(true);
    });

    test('returns false on non-Windows platforms', () => {
      expect(shouldPassOpenCodePromptViaStdin('/usr/local/bin/opencode', 'linux')).toBe(false);
    });
  });

  describe('buildArgs (prompt transport)', () => {
    let testablePlugin: TestableOpenCodePlugin;

    beforeEach(async () => {
      testablePlugin = new TestableOpenCodePlugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('matches the current-platform prompt transport strategy', () => {
      const prompt = 'Hello world';
      const args = testablePlugin.testBuildArgs(prompt);

      if (shouldPassOpenCodePromptViaStdin(undefined)) {
        expect(args).not.toContain(prompt);
      } else {
        expect(args).toContain(prompt);
      }
      expect(args).toContain('run');
      expect(args).toContain('--format');
      expect(args).toContain('json');
    });

    test('keeps special characters out of argv only when stdin transport is active', () => {
      const prompt = 'feature with & special | characters > test "quoted"';
      const args = testablePlugin.testBuildArgs(prompt);

      if (shouldPassOpenCodePromptViaStdin(undefined)) {
        expect(args).not.toContain(prompt);
        for (const arg of args) {
          expect(arg).not.toContain('&');
          expect(arg).not.toContain('|');
          expect(arg).not.toContain('>');
        }
      } else {
        expect(args).toContain(prompt);
      }
    });

    test('includes file context in args', () => {
      const prompt = 'Review this file';
      const files: AgentFileContext[] = [
        { path: '/path/to/file.ts' },
      ];
      const args = testablePlugin.testBuildArgs(prompt, files);

      expect(args).toContain('--file');
      expect(args).toContain('/path/to/file.ts');
    });

    test('includes multiple file contexts', () => {
      const prompt = 'Review these files';
      const files: AgentFileContext[] = [
        { path: '/path/to/file1.ts' },
        { path: '/path/to/file2.ts' },
      ];
      const args = testablePlugin.testBuildArgs(prompt, files);

      // Should have --file for each file
      const fileFlags = args.filter((arg) => arg === '--file');
      expect(fileFlags.length).toBe(2);
      expect(args).toContain('/path/to/file1.ts');
      expect(args).toContain('/path/to/file2.ts');
    });
  });

  describe('getStdinInput', () => {
    let testablePlugin: TestableOpenCodePlugin;

    beforeEach(async () => {
      testablePlugin = new TestableOpenCodePlugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('matches the current-platform prompt transport strategy', () => {
      const prompt = 'Hello world';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      if (shouldPassOpenCodePromptViaStdin(undefined)) {
        expect(stdinInput).toBe(prompt);
      } else {
        expect(stdinInput).toBeUndefined();
      }
    });

    test('returns special-character prompts only when stdin transport is active', () => {
      const prompt = 'feature with & special | characters > test "quoted"';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      if (shouldPassOpenCodePromptViaStdin(undefined)) {
        expect(stdinInput).toBe(prompt);
      } else {
        expect(stdinInput).toBeUndefined();
      }
    });

    test('returns multiline prompts only when stdin transport is active', () => {
      const prompt = 'Line 1\nLine 2\nLine 3';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      if (shouldPassOpenCodePromptViaStdin(undefined)) {
        expect(stdinInput).toBe(prompt);
        expect(stdinInput).toContain('\n');
      } else {
        expect(stdinInput).toBeUndefined();
      }
    });

    test('returns unicode prompts only when stdin transport is active', () => {
      const prompt = 'Hello 世界 🎉 émojis';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      if (shouldPassOpenCodePromptViaStdin(undefined)) {
        expect(stdinInput).toBe(prompt);
      } else {
        expect(stdinInput).toBeUndefined();
      }
    });
  });

  describe('createOpenCodeJsonlBuffer (buffer flush on stream end)', () => {
    test('flushes buffer on stream end when content has no trailing newline', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Push JSON line without trailing newline (partial chunk)
      buffer.push('{"type":"text","content":"Hello"}');

      // Nothing should be processed yet (no newline)
      expect(receivedMessages.length).toBe(0);

      // Flush the buffer (simulates stream end)
      buffer.flush();

      // Now the buffered content should have been processed
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].content).toBe('Hello');
    });

    test('processes complete lines during streaming and flushes remainder on end', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Push first complete line
      buffer.push('{"type":"text","id":1}\n');
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].id).toBe(1);

      // Push partial second line (no newline)
      buffer.push('{"type":"text","id":2}');
      expect(receivedMessages.length).toBe(1); // Still only 1

      // Flush - should process the partial line
      buffer.flush();
      expect(receivedMessages.length).toBe(2);
      expect(receivedMessages[1].id).toBe(2);
    });

    test('forwards JSONL messages to onJsonlMessage callback', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Push JSON line with newline
      buffer.push('{"type":"tool_use","tool":"task"}\n');

      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].type).toBe('tool_use');
      expect(receivedMessages[0].tool).toBe('task');
    });

    test('handles empty buffer on flush gracefully', () => {
      let callbackCalled = false;

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: () => {
          callbackCalled = true;
        },
      });

      // Flush without any data
      buffer.flush();

      // No callback should be called for empty buffer
      expect(callbackCalled).toBe(false);
    });

    test('handles multiple partial chunks that combine into complete line', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Simulate chunked arrival of a single JSON line
      buffer.push('{"type":');
      expect(receivedMessages.length).toBe(0);

      buffer.push('"text","content":');
      expect(receivedMessages.length).toBe(0);

      buffer.push('"Hello"}\n');
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].content).toBe('Hello');
    });

    test('skips invalid JSON gracefully', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Send invalid JSON
      buffer.push('not valid json\n');
      expect(receivedMessages.length).toBe(0);

      // Send valid JSON after
      buffer.push('{"type":"text","valid":true}\n');
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].valid).toBe(true);
    });

    test('handles multiple complete lines in single chunk', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Send multiple lines at once
      buffer.push(
        '{"type":"text","id":1}\n' +
          '{"type":"text","id":2}\n' +
          '{"type":"text","id":3}\n'
      );

      expect(receivedMessages.length).toBe(3);
      expect(receivedMessages[0].id).toBe(1);
      expect(receivedMessages[1].id).toBe(2);
      expect(receivedMessages[2].id).toBe(3);
    });

    test('calls onDisplayEvents for valid OpenCode JSON', () => {
      const displayEventCalls: unknown[][] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onDisplayEvents: (events) => displayEventCalls.push(events),
      });

      // Send OpenCode-format JSON with text content
      buffer.push('{"type":"text","part":{"text":"Hello world"}}\n');

      // Should have triggered display events callback
      expect(displayEventCalls.length).toBe(1);
      expect(displayEventCalls[0].length).toBeGreaterThan(0);
    });

    test('flushes display events on stream end', () => {
      const displayEventCalls: unknown[][] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onDisplayEvents: (events) => displayEventCalls.push(events),
      });

      // Send OpenCode-format JSON without trailing newline
      buffer.push('{"type":"text","part":{"text":"Final message"}}');
      expect(displayEventCalls.length).toBe(0);

      // Flush should process it
      buffer.flush();
      expect(displayEventCalls.length).toBe(1);
    });

    test('ignores empty lines', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Send lines with empty lines between
      buffer.push('{"id":1}\n\n\n{"id":2}\n');

      expect(receivedMessages.length).toBe(2);
      expect(receivedMessages[0].id).toBe(1);
      expect(receivedMessages[1].id).toBe(2);
    });

    test('trims whitespace from lines before processing', () => {
      const receivedMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => receivedMessages.push(msg),
      });

      // Send line with leading/trailing whitespace
      buffer.push('  {"type":"text"}  \n');

      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].type).toBe('text');
    });

    test('calls both onJsonlMessage and onDisplayEvents for same line', () => {
      const jsonlMessages: Record<string, unknown>[] = [];
      const displayEventCalls: unknown[][] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => jsonlMessages.push(msg),
        onDisplayEvents: (events) => displayEventCalls.push(events),
      });

      // Send OpenCode-format JSON that triggers both callbacks
      buffer.push('{"type":"text","part":{"text":"Test message"}}\n');

      expect(jsonlMessages.length).toBe(1);
      expect(displayEventCalls.length).toBe(1);
    });

    test('skips onJsonlMessage for non-JSON lines starting with non-brace', () => {
      const jsonlMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => jsonlMessages.push(msg),
      });

      // Send line starting with something other than {
      buffer.push('plain text without json\n');
      buffer.push('[1,2,3]\n'); // Array, not object
      buffer.push('{"valid":"json"}\n'); // Valid JSON object

      // Only the valid JSON object should be forwarded
      expect(jsonlMessages.length).toBe(1);
      expect(jsonlMessages[0].valid).toBe('json');
    });

    test('handles flush with only whitespace in buffer', () => {
      const jsonlMessages: Record<string, unknown>[] = [];

      const buffer = createOpenCodeJsonlBuffer({
        onJsonlMessage: (msg) => jsonlMessages.push(msg),
      });

      // Push only whitespace
      buffer.push('   \n   ');

      // Flush - should not call callback for whitespace
      buffer.flush();

      expect(jsonlMessages.length).toBe(0);
    });
  });

  describe('execute method integration', () => {
    /**
     * These tests verify the execute method properly integrates with createOpenCodeJsonlBuffer.
     * We use spyOn to intercept the base class execute call and verify wrapping behavior.
     */
    let plugin: OpenCodeAgentPlugin;
    let baseExecuteSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      // Spy on the base class execute method
      const baseProto = Object.getPrototypeOf(Object.getPrototypeOf(plugin));
      baseExecuteSpy = spyOn(baseProto, 'execute').mockImplementation(
        (_prompt: string, _files: unknown, options: AgentExecuteOptions) => {
          // Return a mock handle
          const mockResult: AgentExecutionResult = {
            executionId: 'mock-exec',
            status: 'completed',
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 100,
            interrupted: false,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
          };

          // Create promise that simulates the execute lifecycle
          const promise = new Promise<AgentExecutionResult>((resolve) => {
            // Use setImmediate to ensure callbacks are called before promise resolves
            setImmediate(() => {
              // Simulate some stdout data
              options?.onStdout?.('{"type":"text","part":{"text":"Hello"}}\n');
              // Then end
              options?.onEnd?.(mockResult);
              resolve(mockResult);
            });
          });

          return {
            executionId: mockResult.executionId,
            promise,
            interrupt: () => {},
            isRunning: () => false,
          };
        }
      );
    });

    afterEach(async () => {
      baseExecuteSpy?.mockRestore();
      await plugin.dispose();
    });

    test('wraps onStdout to buffer and parse JSON', async () => {
      const receivedOutput: string[] = [];

      const handle = plugin.execute('test', undefined, {
        onStdout: (data) => receivedOutput.push(data),
      });

      await handle.promise;

      // Verify base execute was called
      expect(baseExecuteSpy).toHaveBeenCalled();

      // The wrapped onStdout should have parsed the JSON and extracted text
      expect(receivedOutput.length).toBeGreaterThan(0);
    });

    test('wraps onEnd to flush buffer before calling original', async () => {
      let onEndCalled = false;
      let onEndResult: AgentExecutionResult | undefined;

      const handle = plugin.execute('test', undefined, {
        onStdout: () => {},
        onEnd: (result) => {
          onEndCalled = true;
          onEndResult = result;
        },
      });

      await handle.promise;

      expect(onEndCalled).toBe(true);
      expect(onEndResult?.status).toBe('completed');
    });

    test('creates wrapped onStdout when onJsonlMessage is provided', () => {
      plugin.execute('test', undefined, {
        onJsonlMessage: () => {},
      });

      // Verify the base execute was called with a wrapped onStdout
      expect(baseExecuteSpy).toHaveBeenCalled();
      const passedOptions = baseExecuteSpy.mock.calls[0][2] as AgentExecuteOptions;
      expect(passedOptions.onStdout).toBeDefined();
    });

    test('creates wrapped onStdout when onStdoutSegments is provided', () => {
      plugin.execute('test', undefined, {
        onStdoutSegments: () => {},
      });

      // Verify the base execute was called with a wrapped onStdout
      expect(baseExecuteSpy).toHaveBeenCalled();
      const passedOptions = baseExecuteSpy.mock.calls[0][2] as AgentExecuteOptions;
      expect(passedOptions.onStdout).toBeDefined();
    });

    test('does not wrap onStdout when no output callbacks provided', () => {
      plugin.execute('test', undefined, {
        timeout: 5000,
      });

      // Verify the base execute was called without wrapped onStdout
      expect(baseExecuteSpy).toHaveBeenCalled();
      const passedOptions = baseExecuteSpy.mock.calls[0][2] as AgentExecuteOptions;
      expect(passedOptions.onStdout).toBeUndefined();
    });

    test('preserves other options when wrapping', () => {
      plugin.execute('test', undefined, {
        timeout: 30000,
        cwd: '/test/dir',
        onStdout: () => {},
      });

      expect(baseExecuteSpy).toHaveBeenCalled();
      const passedOptions = baseExecuteSpy.mock.calls[0][2] as AgentExecuteOptions;
      expect(passedOptions.timeout).toBe(30000);
      expect(passedOptions.cwd).toBe('/test/dir');
    });
  });
});
