/**
 * ABOUTME: Tests for the KiroAgentPlugin.
 * Tests metadata, initialization, setup questions, and protected methods.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { KiroAgentPlugin } from '../../src/plugins/agents/builtin/kiro.js';
import type {
  AgentFileContext,
  AgentExecuteOptions,
} from '../../src/plugins/agents/types.js';

/**
 * Test subclass to expose protected methods for testing.
 */
class TestableKiroPlugin extends KiroAgentPlugin {
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

describe('KiroAgentPlugin', () => {
  let plugin: KiroAgentPlugin;

  beforeEach(() => {
    plugin = new KiroAgentPlugin();
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
      expect(plugin.meta.id).toBe('kiro');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('kiro-cli');
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

    test('does not support subagent tracing', () => {
      // Kiro outputs text only, no structured JSONL
      expect(plugin.meta.supportsSubagentTracing).toBe(false);
    });

    test('has no structured output format', () => {
      expect(plugin.meta.structuredOutputFormat).toBeUndefined();
    });

    test('has correct skillsPaths', () => {
      expect(plugin.meta.skillsPaths).toBeDefined();
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.kiro/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.kiro/skills');
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts trustAllTools config', async () => {
      await plugin.initialize({ trustAllTools: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts agent config', async () => {
      await plugin.initialize({ agent: 'my-custom-agent' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 60000 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'claude-sonnet4.5' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores non-boolean trustAllTools', async () => {
      await plugin.initialize({ trustAllTools: 'yes' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores non-string agent', async () => {
      await plugin.initialize({ agent: 123 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores empty agent string', async () => {
      await plugin.initialize({ agent: '' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores non-number timeout', async () => {
      await plugin.initialize({ timeout: '60000' });
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

    test('ignores zero timeout', async () => {
      await plugin.initialize({ timeout: 0 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts valid Kiro models', () => {
      expect(plugin.validateModel('')).toBeNull();
      expect(plugin.validateModel('claude-sonnet4')).toBeNull();
      expect(plugin.validateModel('claude-sonnet4.5')).toBeNull();
      expect(plugin.validateModel('claude-haiku4.5')).toBeNull();
      expect(plugin.validateModel('claude-opus4.5')).toBeNull();
    });

    test('rejects invalid model names', () => {
      expect(plugin.validateModel('auto')).toContain('Invalid model');
      expect(plugin.validateModel('gpt-4')).toContain('Invalid model');
      expect(plugin.validateModel('claude-3')).toContain('Invalid model');
      expect(plugin.validateModel('sonnet')).toContain('Invalid model');
    });
  });

  describe('validateSetup', () => {
    test('always returns null (no validation)', async () => {
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });

    test('returns null with any answers', async () => {
      const result = await plugin.validateSetup({
        trustAllTools: true,
        agent: 'some-agent',
      });
      expect(result).toBeNull();
    });
  });

  describe('setup questions', () => {
    test('includes trustAllTools question', () => {
      const questions = plugin.getSetupQuestions();
      const trustQuestion = questions.find(q => q.id === 'trustAllTools');
      expect(trustQuestion).toBeDefined();
      expect(trustQuestion?.type).toBe('boolean');
      expect(trustQuestion?.default).toBe(true);
    });

    test('includes agent question', () => {
      const questions = plugin.getSetupQuestions();
      const agentQuestion = questions.find(q => q.id === 'agent');
      expect(agentQuestion).toBeDefined();
      expect(agentQuestion?.type).toBe('text');
      expect(agentQuestion?.default).toBe('');
    });

    test('trustAllTools has helpful description', () => {
      const questions = plugin.getSetupQuestions();
      const trustQuestion = questions.find(q => q.id === 'trustAllTools');
      expect(trustQuestion?.help).toBeDefined();
      expect(trustQuestion?.help?.length).toBeGreaterThan(0);
    });

    test('agent has helpful description', () => {
      const questions = plugin.getSetupQuestions();
      const agentQuestion = questions.find(q => q.id === 'agent');
      expect(agentQuestion?.help).toBeDefined();
      expect(agentQuestion?.help?.length).toBeGreaterThan(0);
    });

    test('includes model question with choices', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('select');
      expect(modelQuestion?.choices).toBeDefined();
      expect(modelQuestion?.choices?.length).toBeGreaterThan(0);
    });
  });

  describe('buildArgs (stdin input for Windows safety)', () => {
    let testablePlugin: TestableKiroPlugin;

    beforeEach(async () => {
      testablePlugin = new TestableKiroPlugin();
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
      // Should have chat subcommand
      expect(args).toContain('chat');
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

    test('includes chat subcommand', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args[0]).toBe('chat');
    });

    test('includes --no-interactive', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--no-interactive');
    });

    test('includes --trust-all-tools by default', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--trust-all-tools');
    });

    test('excludes --trust-all-tools when disabled', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableKiroPlugin();
      await testablePlugin.initialize({ trustAllTools: false });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--trust-all-tools');
    });

    test('includes --agent when agent is configured', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableKiroPlugin();
      await testablePlugin.initialize({ agent: 'code-reviewer' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--agent');
      expect(args).toContain('code-reviewer');
    });

    test('excludes --agent when not configured', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--agent');
    });

    test('includes --model when model is configured', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableKiroPlugin();
      await testablePlugin.initialize({ model: 'claude-sonnet4.5' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet4.5');
    });

    test('excludes --model when not configured', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--model');
    });

    test('has args in correct order: chat, --no-interactive, then options', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args[0]).toBe('chat');
      expect(args[1]).toBe('--no-interactive');
    });
  });

  describe('getStdinInput', () => {
    let testablePlugin: TestableKiroPlugin;

    beforeEach(async () => {
      testablePlugin = new TestableKiroPlugin();
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
