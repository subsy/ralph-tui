/**
 * ABOUTME: Tests for the GeminiAgentPlugin.
 * Tests metadata, initialization, model validation, and protected methods.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GeminiAgentPlugin } from '../../src/plugins/agents/builtin/gemini.js';
import type {
  AgentFileContext,
  AgentExecuteOptions,
} from '../../src/plugins/agents/types.js';

/**
 * Test subclass to expose protected methods for testing.
 */
class TestableGeminiPlugin extends GeminiAgentPlugin {
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

async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-gemini-cli-detect-'));
}

async function withFakeCommandPath<T>(
  setup: (tempDir: string) => Promise<T>
): Promise<T> {
  const tempDir = await createTempDir();
  const originalPath = process.env.PATH ?? '';
  const whichShimPath = join(tempDir, 'which');
  const whichScript = [
    '#!/bin/sh',
    'command="$1"',
    '[ -z "$command" ] && exit 1',
    `candidate="${tempDir}/$command"`,
    '[ -x "$candidate" ] && echo "$candidate" && exit 0',
    'exit 1',
  ].join('\n');

  await writeFile(whichShimPath, `${whichScript}\n`, 'utf-8');
  chmodSync(whichShimPath, 0o755);
  process.env.PATH = tempDir;

  try {
    return await setup(tempDir);
  } finally {
    process.env.PATH = originalPath;
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeFakeCommand(
  tempDir: string,
  name: string,
  output: string
): Promise<string> {
  const commandPath = join(tempDir, name);
  const script = ['#!/bin/sh', `echo "${output}"`].join('\n');
  await writeFile(commandPath, `${script}\n`, 'utf-8');
  chmodSync(commandPath, 0o755);
  return commandPath;
}

function extractVersion(output: string): string {
  return output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? '';
}

describe('GeminiAgentPlugin', () => {
  let plugin: GeminiAgentPlugin;

  beforeEach(() => {
    plugin = new GeminiAgentPlugin();
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
      expect(plugin.meta.id).toBe('gemini');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('gemini-cli');
    });

    test('supports legacy command alias', () => {
      expect(plugin.meta.commandAliases).toEqual(['gemini']);
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
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.gemini/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.gemini/skills');
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'gemini-2.5-pro' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts yoloMode config', async () => {
      await plugin.initialize({ yoloMode: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 60000 });
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

    test('ignores non-boolean yoloMode', async () => {
      await plugin.initialize({ yoloMode: 'yes' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores non-number timeout', async () => {
      await plugin.initialize({ timeout: '60000' });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts empty string', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts undefined model', () => {
      expect(plugin.validateModel(undefined as unknown as string)).toBeNull();
    });

    test('accepts gemini-2.5-pro', () => {
      expect(plugin.validateModel('gemini-2.5-pro')).toBeNull();
    });

    test('accepts gemini-2.5-flash', () => {
      expect(plugin.validateModel('gemini-2.5-flash')).toBeNull();
    });

    test('accepts gemini-1.5-pro', () => {
      expect(plugin.validateModel('gemini-1.5-pro')).toBeNull();
    });

    test('rejects non-gemini model', () => {
      const result = plugin.validateModel('gpt-4');
      expect(result).not.toBeNull();
      expect(result).toContain('gemini-');
    });

    test('rejects claude model', () => {
      const result = plugin.validateModel('claude-3-opus');
      expect(result).not.toBeNull();
    });
  });

  describe('validateSetup', () => {
    test('returns null for empty answers', async () => {
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });

    test('returns null for valid gemini model', async () => {
      const result = await plugin.validateSetup({ model: 'gemini-2.5-pro' });
      expect(result).toBeNull();
    });

    test('returns null for empty string model', async () => {
      const result = await plugin.validateSetup({ model: '' });
      expect(result).toBeNull();
    });

    test('returns error for invalid model', async () => {
      const result = await plugin.validateSetup({ model: 'gpt-4' });
      expect(result).not.toBeNull();
      expect(result).toContain('gemini-');
    });

    test('returns null for undefined model', async () => {
      const result = await plugin.validateSetup({ model: undefined });
      expect(result).toBeNull();
    });
  });

  describe('setup questions', () => {
    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('select');
    });

    test('model question has choices', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion?.choices?.length).toBeGreaterThan(0);
      const values = modelQuestion?.choices?.map(c => c.value);
      expect(values).toContain('gemini-2.5-pro');
      expect(values).toContain('gemini-2.5-flash');
    });

    test('includes yoloMode question', () => {
      const questions = plugin.getSetupQuestions();
      const yoloQuestion = questions.find(q => q.id === 'yoloMode');
      expect(yoloQuestion).toBeDefined();
      expect(yoloQuestion?.type).toBe('boolean');
      expect(yoloQuestion?.default).toBe(true);
    });
  });

  describe('buildArgs (stdin input for Windows safety)', () => {
    let testablePlugin: TestableGeminiPlugin;

    beforeEach(async () => {
      testablePlugin = new TestableGeminiPlugin();
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
      // Should NOT have -p flag since prompt is via stdin
      expect(args).not.toContain('-p');
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

    test('includes --yolo by default', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('--yolo');
    });

    test('excludes --yolo when disabled', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableGeminiPlugin();
      await testablePlugin.initialize({ yoloMode: false });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('--yolo');
    });

    test('always includes --output-format stream-json for output parsing', () => {
      // stream-json is always enabled for proper output parsing
      const argsWithTracing = testablePlugin.testBuildArgs('test prompt', undefined, {
        subagentTracing: true,
      });
      expect(argsWithTracing).toContain('--output-format');
      expect(argsWithTracing).toContain('stream-json');

      const argsWithoutTracing = testablePlugin.testBuildArgs('test prompt', undefined, {
        subagentTracing: false,
      });
      expect(argsWithoutTracing).toContain('--output-format');
      expect(argsWithoutTracing).toContain('stream-json');

      const argsNoOptions = testablePlugin.testBuildArgs('test prompt');
      expect(argsNoOptions).toContain('--output-format');
      expect(argsNoOptions).toContain('stream-json');
    });

    test('includes -m when model is configured', async () => {
      await testablePlugin.dispose();
      testablePlugin = new TestableGeminiPlugin();
      await testablePlugin.initialize({ model: 'gemini-2.5-flash' });

      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).toContain('-m');
      expect(args).toContain('gemini-2.5-flash');
    });

    test('excludes -m when model not configured', () => {
      const args = testablePlugin.testBuildArgs('test prompt');
      expect(args).not.toContain('-m');
    });
  });

  describe('getStdinInput', () => {
    let testablePlugin: TestableGeminiPlugin;

    beforeEach(async () => {
      testablePlugin = new TestableGeminiPlugin();
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

  describe('detect', () => {
    test('resolves default gemini-cli command', async () => {
      if (process.platform === 'win32') {
        return;
      }

      await withFakeCommandPath(async (tempDir) => {
        const output = 'gemini-cli 1.2.3';
        const detectedPath = await writeFakeCommand(tempDir, 'gemini-cli', output);

        const testPlugin = new GeminiAgentPlugin();
        await testPlugin.initialize({});
        const result = await testPlugin.detect();

        expect(result.available).toBe(true);
        expect(result.version).toBe(extractVersion(output));
        expect(result.executablePath).toBe(detectedPath);

        await testPlugin.dispose();
      });
    });

    test('falls back to legacy gemini command when gemini-cli is missing', async () => {
      if (process.platform === 'win32') {
        return;
      }

      await withFakeCommandPath(async (tempDir) => {
        const output = 'gemini 2.1.4';
        const detectedPath = await writeFakeCommand(tempDir, 'gemini', output);

        const testPlugin = new GeminiAgentPlugin();
        await testPlugin.initialize({});
        const result = await testPlugin.detect();

        expect(result.available).toBe(true);
        expect(result.version).toBe(extractVersion(output));
        expect(result.executablePath).toBe(detectedPath);

        await testPlugin.dispose();
      });
    });

    test('uses explicit configured command when provided', async () => {
      if (process.platform === 'win32') {
        return;
      }

      await withFakeCommandPath(async (tempDir) => {
        const output = 'gemini 3.4.5';
        const customPath = await writeFakeCommand(tempDir, 'custom-gemini', output);

        const testPlugin = new GeminiAgentPlugin();
        await testPlugin.initialize({ command: customPath });
        const result = await testPlugin.detect();

        expect(result.available).toBe(true);
        expect(result.version).toBe(extractVersion(output));
        expect(result.executablePath).toBe(customPath);

        await testPlugin.dispose();
      });
    });

    test('emits canonical and legacy command names when not found', async () => {
      if (process.platform === 'win32') {
        return;
      }

      await withFakeCommandPath(async () => {
        const testPlugin = new GeminiAgentPlugin();
        await testPlugin.initialize({});
        const result = await testPlugin.detect();

        expect(result.available).toBe(false);
        expect(result.error).toContain('Gemini CLI not found in PATH');
        expect(result.error).toContain('`gemini-cli`');
        expect(result.error).toContain('`gemini`');

        await testPlugin.dispose();
      });
    });
  });
});
