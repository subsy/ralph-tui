/**
 * ABOUTME: Tests for the CodexAgentPlugin.
 * Tests metadata, initialization, setup questions, and protected methods.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CodexAgentPlugin } from '../../src/plugins/agents/builtin/codex.js';
import type {
  AgentFileContext,
  AgentExecuteOptions,
} from '../../src/plugins/agents/types.js';

/**
 * Test subclass to expose protected methods for testing.
 */
class TestableCodexPlugin extends CodexAgentPlugin {
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
  ): string {
    return this['getStdinInput'](prompt, files, options);
  }
}

describe('CodexAgentPlugin', () => {
  let plugin: CodexAgentPlugin;

  beforeEach(() => {
    plugin = new CodexAgentPlugin();
  });

  afterEach(async () => {
    try {
      if (await plugin.isReady()) {
        await plugin.dispose();
      }
    } catch {
      // Ignore errors from already-disposed plugin
    }
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('codex');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('codex');
    });

    test('supports streaming', () => {
      expect(plugin.meta.supportsStreaming).toBe(true);
    });

    test('supports interruption', () => {
      expect(plugin.meta.supportsInterrupt).toBe(true);
    });

    test('does not support file context', () => {
      expect(plugin.meta.supportsFileContext).toBe(false);
    });

    test('supports subagent tracing', () => {
      expect(plugin.meta.supportsSubagentTracing).toBe(true);
    });

    test('uses jsonl for structured output', () => {
      expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
    });

    test('has skills paths configured', () => {
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.codex/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.codex/skills');
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'gpt-4o' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts fullAuto config', async () => {
      await plugin.initialize({ fullAuto: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts sandbox config', async () => {
      await plugin.initialize({ sandbox: 'read-only' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts danger-full-access sandbox config', async () => {
      await plugin.initialize({ sandbox: 'danger-full-access' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 60000 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores invalid sandbox value', async () => {
      await plugin.initialize({ sandbox: 'invalid-sandbox' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores non-string model', async () => {
      await plugin.initialize({ model: 123 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores empty model string', async () => {
      await plugin.initialize({ model: '' });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts empty string', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts any model (no strict validation)', () => {
      expect(plugin.validateModel('gpt-4o')).toBeNull();
      expect(plugin.validateModel('o1-preview')).toBeNull();
      expect(plugin.validateModel('custom-model')).toBeNull();
    });
  });

  describe('validateSetup', () => {
    test('always returns null (no validation)', async () => {
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });

    test('returns null with any answers', async () => {
      const result = await plugin.validateSetup({
        model: 'gpt-4',
        fullAuto: true,
        sandbox: 'read-only',
      });
      expect(result).toBeNull();
    });
  });

  describe('setup questions', () => {
    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('text');
    });

    test('includes fullAuto question', () => {
      const questions = plugin.getSetupQuestions();
      const fullAutoQuestion = questions.find(q => q.id === 'fullAuto');
      expect(fullAutoQuestion).toBeDefined();
      expect(fullAutoQuestion?.type).toBe('boolean');
      expect(fullAutoQuestion?.default).toBe(true);
    });

    test('includes sandbox question', () => {
      const questions = plugin.getSetupQuestions();
      const sandboxQuestion = questions.find(q => q.id === 'sandbox');
      expect(sandboxQuestion).toBeDefined();
      expect(sandboxQuestion?.type).toBe('select');
      expect(sandboxQuestion?.default).toBe('workspace-write');
    });

    test('sandbox question has all choices', () => {
      const questions = plugin.getSetupQuestions();
      const sandboxQuestion = questions.find(q => q.id === 'sandbox');
      expect(sandboxQuestion?.choices?.length).toBe(3);
      const values = sandboxQuestion?.choices?.map(c => c.value);
      expect(values).toContain('read-only');
      expect(values).toContain('workspace-write');
      expect(values).toContain('danger-full-access');
    });
  });

  describe('buildArgs (stdin input for Windows safety)', () => {
    let testablePlugin: TestableCodexPlugin;

    beforeEach(async () => {
      testablePlugin = new TestableCodexPlugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('does NOT include prompt in args (passed via stdin instead)', () => {
      const prompt = 'Hello world';
      const args = testablePlugin.testBuildArgs(prompt);

      // The prompt should NOT be in args - it's passed via stdin
      expect(args).not.toContain(prompt);
      // Should have basic args
      expect(args).toContain('exec');
    });

    test('does NOT include prompt with special characters in args', () => {
      // These characters would cause "syntax error" on Windows cmd.exe
      const prompt = 'feature with & special | characters > test "quoted"';
      const args = testablePlugin.testBuildArgs(prompt);

      // The prompt with special chars should NOT be in args
      expect(args).not.toContain(prompt);
      // None of the special chars should appear in any arg
      for (const arg of args) {
        expect(arg).not.toContain('&');
        expect(arg).not.toContain('|');
        expect(arg).not.toContain('>');
      }
    });

    test('includes exec subcommand', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args[0]).toBe('exec');
    });

    test('includes --full-auto by default', async () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--full-auto');
    });

    test('excludes --full-auto when disabled', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableCodexPlugin();
      await testablePlugin.initialize({ fullAuto: false });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--full-auto');
    });

    test('always includes --json for output parsing', () => {
      // JSON is always enabled for proper output parsing
      const argsWithTracing = testablePlugin.testBuildArgs('test prompt', undefined, {
        subagentTracing: true,
      });
      expect(argsWithTracing).toContain('--json');

      const argsWithoutTracing = testablePlugin.testBuildArgs('test prompt', undefined, {
        subagentTracing: false,
      });
      expect(argsWithoutTracing).toContain('--json');

      const argsNoOptions = testablePlugin.testBuildArgs('test prompt');
      expect(argsNoOptions).toContain('--json');
    });

    test('includes --model when model is configured', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableCodexPlugin();
      await testablePlugin.initialize({ model: 'gpt-4o' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4o');
    });

    test('includes --sandbox with default value', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--sandbox');
      expect(args).toContain('workspace-write');
    });

    test('includes --sandbox with configured value', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableCodexPlugin();
      await testablePlugin.initialize({ sandbox: 'read-only' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--sandbox');
      expect(args).toContain('read-only');
    });
  });

  describe('getStdinInput', () => {
    let testablePlugin: TestableCodexPlugin;

    beforeEach(async () => {
      testablePlugin = new TestableCodexPlugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      await testablePlugin.dispose();
    });

    test('returns the prompt for stdin', () => {
      const prompt = 'Hello world';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      expect(stdinInput).toBe(prompt);
    });

    test('returns prompt with special characters unchanged', () => {
      // These characters would cause issues if passed as CLI args on Windows
      const prompt = 'feature with & special | characters > test "quoted"';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      // Stdin should contain the prompt exactly as-is (no escaping needed)
      expect(stdinInput).toBe(prompt);
    });

    test('returns prompt with newlines', () => {
      const prompt = 'Line 1\nLine 2\nLine 3';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      expect(stdinInput).toBe(prompt);
    });

    test('returns prompt with unicode characters', () => {
      const prompt = 'Hello 世界 🌍 émojis';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      expect(stdinInput).toBe(prompt);
    });
  });
});
