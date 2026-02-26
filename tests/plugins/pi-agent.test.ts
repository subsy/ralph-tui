/**
 * ABOUTME: Tests for the PiAgentPlugin.
 * Tests metadata, initialization, setup questions, and protected methods.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PiAgentPlugin } from '../../src/plugins/agents/builtin/pi.js';
import type {
  AgentFileContext,
  AgentExecuteOptions,
} from '../../src/plugins/agents/types.js';

/**
 * Test subclass to expose protected methods for testing.
 */
class TestablePiPlugin extends PiAgentPlugin {
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

describe('PiAgentPlugin', () => {
  let plugin: PiAgentPlugin;

  beforeEach(() => {
    plugin = new PiAgentPlugin();
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
      expect(plugin.meta.id).toBe('pi');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('pi');
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

    test('has jsonl structured output format', () => {
      expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
    });

    test('has correct skillsPaths', () => {
      expect(plugin.meta.skillsPaths).toBeDefined();
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.pi/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.pi/skills');
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts mode config', async () => {
      await plugin.initialize({ mode: 'text' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'sonnet' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts thinking config', async () => {
      await plugin.initialize({ thinking: 'high' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 60000 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores invalid mode', async () => {
      await plugin.initialize({ mode: 'invalid' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores invalid thinking level', async () => {
      await plugin.initialize({ thinking: 'ultra' });
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

    test('ignores non-number timeout', async () => {
      await plugin.initialize({ timeout: '60000' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores zero timeout', async () => {
      await plugin.initialize({ timeout: 0 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts any model (flexible format)', () => {
      // Pi accepts any model pattern
      expect(plugin.validateModel('')).toBeNull();
      expect(plugin.validateModel('sonnet')).toBeNull();
      expect(plugin.validateModel('haiku')).toBeNull();
      expect(plugin.validateModel('opus')).toBeNull();
      expect(plugin.validateModel('openai/gpt-4o')).toBeNull();
      expect(plugin.validateModel('anthropic/claude-sonnet')).toBeNull();
      expect(plugin.validateModel('sonnet:high')).toBeNull();
      expect(plugin.validateModel('gemini-2.5-pro')).toBeNull();
    });
  });

  describe('validateSetup', () => {
    test('always returns null (no validation)', async () => {
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });

    test('returns null with any answers', async () => {
      const result = await plugin.validateSetup({
        mode: 'json',
        model: 'sonnet',
        thinking: 'high',
      });
      expect(result).toBeNull();
    });
  });

  describe('setup questions', () => {
    test('includes mode question with choices', () => {
      const questions = plugin.getSetupQuestions();
      const modeQuestion = questions.find(q => q.id === 'mode');
      expect(modeQuestion).toBeDefined();
      expect(modeQuestion?.type).toBe('select');
      expect(modeQuestion?.choices).toBeDefined();
      expect(modeQuestion?.choices?.length).toBe(2);
      expect(modeQuestion?.default).toBe('json');
    });

    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('text');
      expect(modelQuestion?.default).toBe('');
    });

    test('includes thinking question with choices', () => {
      const questions = plugin.getSetupQuestions();
      const thinkingQuestion = questions.find(q => q.id === 'thinking');
      expect(thinkingQuestion).toBeDefined();
      expect(thinkingQuestion?.type).toBe('select');
      expect(thinkingQuestion?.choices).toBeDefined();
      expect(thinkingQuestion?.choices?.length).toBe(7); // Default + 6 levels
    });

    test('mode has helpful description', () => {
      const questions = plugin.getSetupQuestions();
      const modeQuestion = questions.find(q => q.id === 'mode');
      expect(modeQuestion?.help).toBeDefined();
      expect(modeQuestion?.help?.length).toBeGreaterThan(0);
    });

    test('model has helpful description', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion?.help).toBeDefined();
      expect(modelQuestion?.help?.length).toBeGreaterThan(0);
    });
  });

  describe('buildArgs', () => {
    let testablePlugin: TestablePiPlugin;

    beforeEach(async () => {
      testablePlugin = new TestablePiPlugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      try {
        if (await testablePlugin.isReady()) {
          await testablePlugin.dispose();
        }
      } catch {
        // Ignore errors from already-disposed plugin
      }
    });

    test('includes --print for non-interactive mode', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--print');
    });

    test('includes --mode json by default for subagent tracing', () => {
      const args = testablePlugin.testBuildArgs('test prompt', undefined, { subagentTracing: true });
      expect(args).toContain('--mode');
      expect(args).toContain('json');
    });

    test('includes --mode json when mode is json', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestablePiPlugin();
      await testablePlugin.initialize({ mode: 'json' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--mode');
      expect(args).toContain('json');
    });

    test('does NOT include --mode json when mode is text', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestablePiPlugin();
      await testablePlugin.initialize({ mode: 'text' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--mode');
      expect(args).not.toContain('json');
    });

    test('does NOT include prompt in args (passed via stdin)', () => {
      const prompt = 'Hello world';
      const args = testablePlugin.testBuildArgs(prompt);

      // The prompt should NOT be in args - it's passed via stdin
      expect(args).not.toContain(prompt);
    });

    test('includes --model when model is configured', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestablePiPlugin();
      await testablePlugin.initialize({ model: 'sonnet' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
    });

    test('excludes --model when not configured', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--model');
    });

    test('includes --thinking when thinking is configured', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestablePiPlugin();
      await testablePlugin.initialize({ thinking: 'high' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--thinking');
      expect(args).toContain('high');
    });

    test('excludes --thinking when not configured', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--thinking');
    });

    test('includes file context with @ prefix', () => {
      const files: AgentFileContext[] = [
        { path: '/path/to/file.ts' },
        { path: '/path/to/another.ts' },
      ];
      const args = testablePlugin.testBuildArgs('test prompt', files);

      expect(args).toContain('@/path/to/file.ts');
      expect(args).toContain('@/path/to/another.ts');
    });

    test('excludes file context when not provided', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args.some(arg => arg.startsWith('@'))).toBe(false);
    });

    test('has args in correct order', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args[0]).toBe('--print');
    });
  });

  describe('getStdinInput', () => {
    let testablePlugin: TestablePiPlugin;

    beforeEach(async () => {
      testablePlugin = new TestablePiPlugin();
      await testablePlugin.initialize({});
    });

    afterEach(async () => {
      try {
        if (await testablePlugin.isReady()) {
          await testablePlugin.dispose();
        }
      } catch {
        // Ignore errors from already-disposed plugin
      }
    });

    test('returns the prompt for stdin', () => {
      const prompt = 'Hello world';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

      expect(stdinInput).toBe(prompt);
    });

    test('returns prompt with special characters unchanged', () => {
      const prompt = 'feature with & special | characters > test "quoted"';
      const stdinInput = testablePlugin.testGetStdinInput(prompt);

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

  describe('getSandboxRequirements', () => {
    test('returns expected auth paths', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.authPaths).toContain('~/.pi');
    });

    test('returns requiresNetwork true', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.requiresNetwork).toBe(true);
    });
  });
});
