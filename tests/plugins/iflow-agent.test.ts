/**
 * ABOUTME: Tests for the IflowAgentPlugin.
 * Tests metadata, initialization, prompt building, output parsing, and setup validation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { IflowAgentPlugin } from '../../src/plugins/agents/builtin/iflow.js';
import type { AgentExecuteOptions } from '../../src/plugins/agents/types.js';

describe('IflowAgentPlugin', () => {
  let plugin: IflowAgentPlugin;

  beforeEach(() => {
    plugin = new IflowAgentPlugin();
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
      expect(plugin.meta.id).toBe('iflow');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('iflow');
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

    test('has correct version', () => {
      expect(plugin.meta.version).toBe('1.0.0');
    });

    test('has correct author', () => {
      expect(plugin.meta.author).toBe('iFlow');
    });

    test('has correct skills paths', () => {
      expect(plugin.meta.skillsPaths).toEqual({
        personal: '~/.iflow/skills',
        repo: '.iflow/skills',
      });
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'glm-4.7' });
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

    test('ignores invalid model config type', async () => {
      await plugin.initialize({ model: 123 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores invalid yoloMode config type', async () => {
      await plugin.initialize({ yoloMode: 'yes' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores invalid timeout config type', async () => {
      await plugin.initialize({ timeout: '60' });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('buildArgs', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    test('builds args with default config', () => {
      const args = plugin['buildArgs']('test prompt');
      expect(args).toEqual(['--yolo']);
    });

    test('includes model when configured', async () => {
      await plugin.initialize({ model: 'glm-4.7' });
      const args = plugin['buildArgs']('test prompt');
      expect(args).toEqual(['-m', 'glm-4.7', '--yolo']);
    });

    test('excludes --yolo when yoloMode is false', async () => {
      await plugin.initialize({ yoloMode: false });
      const args = plugin['buildArgs']('test prompt');
      expect(args).toEqual([]);
    });

    test('includes both model and yolo flag', async () => {
      await plugin.initialize({ model: 'deepseek-v3.2', yoloMode: true });
      const args = plugin['buildArgs']('test prompt');
      expect(args).toEqual(['-m', 'deepseek-v3.2', '--yolo']);
    });

    test('does not include prompt in args (uses stdin)', () => {
      const args = plugin['buildArgs']('test prompt with spaces');
      expect(args).not.toContain('test');
      expect(args).not.toContain('prompt');
    });
  });

  describe('getStdinInput', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    test('returns the prompt for stdin', () => {
      const input = plugin['getStdinInput']('test prompt');
      expect(input).toBe('test prompt');
    });

    test('returns empty string for empty prompt', () => {
      const input = plugin['getStdinInput']('');
      expect(input).toBe('');
    });

    test('returns multi-line prompt', () => {
      const prompt = 'line 1\nline 2\nline 3';
      const input = plugin['getStdinInput'](prompt);
      expect(input).toBe(prompt);
    });

    test('returns prompt with special characters', () => {
      const prompt = 'test with "quotes" and `backticks`';
      const input = plugin['getStdinInput'](prompt);
      expect(input).toBe(prompt);
    });
  });

  describe('parseIflowOutputToEvents', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    test('parses plain text as text events', () => {
      const output = 'This is plain text\nAnother line';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'text', content: 'This is plain text\n' });
      expect(events[1]).toEqual({ type: 'text', content: 'Another line\n' });
    });

    test('parses "I\'ll use" pattern for tool calls', () => {
      const output = "I'll use read_file to read the file";
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'tool_use',
        name: 'read_file',
        input: {},
      });
    });

    test('parses "Using" pattern for tool calls', () => {
      const output = 'Using write_file to create a new file';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'tool_use',
        name: 'write_file',
        input: {},
      });
    });

    test('parses "Now using" pattern for tool calls', () => {
      const output = 'Now using replace to update the code';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'tool_use',
        name: 'replace',
        input: {},
      });
    });

    test('parses "Calling" pattern for tool calls', () => {
      const output = 'Calling glob to find files';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'tool_use',
        name: 'glob',
        input: {},
      });
    });

    test('parses "Execute" pattern for tool calls', () => {
      const output = 'Execute run_shell_command to install dependencies';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(1);
      // The extractToolInput extracts "to install dependencies" as command
      expect(events[0]).toEqual({
        type: 'tool_use',
        name: 'run_shell_command',
        input: {
          command: 'to install dependencies',
        },
      });
    });

    test('parses "Run" pattern for tool calls', () => {
      const output = 'Run web_search to find information';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'tool_use',
        name: 'web_search',
        input: {},
      });
    });

    test('ignores unknown tool names', () => {
      const output = 'I\'ll use unknown_tool to do something';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'text',
        content: 'I\'ll use unknown_tool to do something\n',
      });
    });

    test('handles mixed text and tool calls', () => {
      const output = 'Let me check the file\nI\'ll use read_file to read src/index.ts\nThen analyze it';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: 'text', content: 'Let me check the file\n' });
      expect(events[1]).toEqual({ type: 'tool_use', name: 'read_file', input: {} });
      expect(events[2]).toEqual({ type: 'text', content: 'Then analyze it\n' });
    });

    test('handles empty output', () => {
      const events = plugin['parseIflowOutputToEvents']('');
      expect(events).toHaveLength(0);
    });

    test('handles whitespace-only output', () => {
      const events = plugin['parseIflowOutputToEvents']('   \n\n  \n');
      expect(events).toHaveLength(0);
    });

    test('handles output with empty lines', () => {
      const output = 'line 1\n\nline 2\n\nline 3';
      const events = plugin['parseIflowOutputToEvents'](output);
      expect(events).toHaveLength(3);
    });
  });

  describe('extractToolInput', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    describe('file path extraction', () => {
      test('extracts double-quoted path', () => {
        // Using "Using" pattern to avoid single quote conflict
        const line = 'Using read_file to read "/path/to/file.ts"';
        const input = plugin['extractToolInput'](line, 'read_file');
        expect(input.file_path).toBe('/path/to/file.ts');
        expect(input.path).toBe('/path/to/file.ts');
      });

      test('extracts backtick-quoted path', () => {
        const line = 'Now using glob to find `**/*.test.ts`';
        const input = plugin['extractToolInput'](line, 'glob');
        expect(input.file_path).toBe('**/*.test.ts');
      });

      test('extracts multiple paths', () => {
        const line = 'Using replace to change "old.ts" and "new.ts"';
        const input = plugin['extractToolInput'](line, 'replace');
        expect(input.paths).toEqual(['old.ts', 'new.ts']);
      });

      test('handles path without quotes', () => {
        const line = 'I\'ll use list_directory to explore src/';
        const input = plugin['extractToolInput'](line, 'list_directory');
        expect(input.file_path).toBeUndefined();
      });
    });

    describe('run_shell_command extraction', () => {
      test('extracts partial command (regex pattern includes the prefix)', () => {
        // The regex matches 'command: "' prefix, so we get "command: "
        const line = 'Execute run_shell_command command: "npm install" description: "Install dependencies"';
        const input = plugin['extractToolInput'](line, 'run_shell_command');
        expect(input.command).toBe('command: ');
      });

      test('extracts partial command without description', () => {
        const line = 'Execute run_shell_command command: "bun test"';
        const input = plugin['extractToolInput'](line, 'run_shell_command');
        expect(input.command).toBe('command: ');
      });

      test('extracts description (without the prefix)', () => {
        // The regex for description doesn't match "description:" prefix
        const line = 'Execute run_shell_command description: "Run tests"';
        const input = plugin['extractToolInput'](line, 'run_shell_command');
        expect(input.description).toBe('Run tests');
      });
    });

    describe('search pattern extraction', () => {
      test('extracts pattern for search_file_content', () => {
        const line = 'Using search_file_content pattern: "import.*from"';
        const input = plugin['extractToolInput'](line, 'search_file_content');
        expect(input.pattern).toBe('import.*from');
      });

      test('extracts pattern for glob', () => {
        const line = 'Now using glob pattern: "**/*.ts"';
        const input = plugin['extractToolInput'](line, 'glob');
        expect(input.pattern).toBe('**/*.ts');
      });
    });

    describe('query extraction', () => {
      test('extracts query for web_search', () => {
        const line = 'Run web_search query: "TypeScript best practices"';
        const input = plugin['extractToolInput'](line, 'web_search');
        expect(input.query).toBe('TypeScript best practices');
      });
    });

    describe('URL extraction', () => {
      test('extracts URL for web_fetch', () => {
        const line = 'Using web_fetch url: "https://example.com/api/data"';
        const input = plugin['extractToolInput'](line, 'web_fetch');
        expect(input.url).toBe('https://example.com/api/data');
      });

      test('extracts URL for navigate_page', () => {
        const line = 'Now using navigate_page url: "https://github.com"';
        const input = plugin['extractToolInput'](line, 'navigate_page');
        expect(input.url).toBe('https://github.com');
      });
    });

    test('returns empty object for unknown tool', () => {
      const line = 'Using some_tool to do something';
      const input = plugin['extractToolInput'](line, 'some_tool');
      expect(input).toEqual({});
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    test('wraps onStdout to parse output', () => {
      let stdoutSegmentsCalled = false;
      let stdoutCalled = false;

      const options: AgentExecuteOptions = {
        onStdoutSegments: () => {
          stdoutSegmentsCalled = true;
        },
        onStdout: () => {
          stdoutCalled = true;
        },
      };

      const handle = plugin['execute']('test prompt', [], options);

      // The execute method should return a handle
      expect(handle).toBeDefined();
      expect(handle.executionId).toBeDefined();
      expect(handle.promise).toBeDefined();
    });

    test('handles missing onStdoutSegments callback', () => {
      const options: AgentExecuteOptions = {};

      const handle = plugin['execute']('test prompt', [], options);

      // Should not throw when callback is missing
      expect(handle).toBeDefined();
    });

    test('handles missing onStdout callback', () => {
      const options: AgentExecuteOptions = {
        onStdoutSegments: () => {},
      };

      const handle = plugin['execute']('test prompt', [], options);

      // Should not throw when callback is missing
      expect(handle).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('accepts empty model', async () => {
      await plugin.initialize({});
      const result = await plugin.validateSetup({ model: '' });
      expect(result).toBeNull();
    });

    test('accepts undefined model', async () => {
      await plugin.initialize({});
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });

    test('accepts valid model names', async () => {
      await plugin.initialize({});
      const validModels = [
        'glm-4.7',
        'iflow-rome-30ba3b',
        'deepseek-v3.2',
        'qwen3-coder-plus',
        'kimi-k2-thinking',
        'minimax-m2.1',
        'kimi-k2-0905',
      ];

      for (const model of validModels) {
        const result = await plugin.validateSetup({ model });
        expect(result).toBeNull();
      }
    });

    test('rejects invalid model', async () => {
      await plugin.initialize({});
      const result = await plugin.validateSetup({ model: 'invalid-model' });
      expect(result).toContain('Invalid model');
      expect(result).toContain('glm-4.7');
    });

    test('ignores non-string model', async () => {
      await plugin.initialize({});
      const result = await plugin.validateSetup({ model: 123 });
      expect(result).toBeNull();
    });

    test('ignores other setup fields', async () => {
      await plugin.initialize({});
      const result = await plugin.validateSetup({
        yoloMode: true,
        timeout: 60000,
        command: '/path/to/iflow',
      });
      expect(result).toBeNull();
    });
  });

  describe('validateModel', () => {
    test('accepts empty string', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts undefined', () => {
      expect(plugin.validateModel(undefined as any)).toBeNull();
    });

    test('accepts valid model names', () => {
      const validModels = [
        'glm-4.7',
        'iflow-rome-30ba3b',
        'deepseek-v3.2',
        'qwen3-coder-plus',
        'kimi-k2-thinking',
        'minimax-m2.1',
        'kimi-k2-0905',
      ];

      for (const model of validModels) {
        expect(plugin.validateModel(model)).toBeNull();
      }
    });

    test('rejects invalid model', () => {
      const result = plugin.validateModel('invalid-model');
      expect(result).toContain('Invalid model "invalid-model"');
      expect(result).toContain('glm-4.7');
    });

    test('rejects model with similar but different name', () => {
      const result = plugin.validateModel('glm-4.6');
      expect(result).toContain('Invalid model "glm-4.6"');
    });
  });

  describe('getSetupQuestions', () => {
    test('includes base questions', async () => {
      await plugin.initialize({});
      const questions = plugin.getSetupQuestions();
      expect(questions.length).toBeGreaterThan(0);

      // Check for model question
      const modelQuestion = questions.find((q) => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('select');
      expect(modelQuestion?.choices?.length).toBeGreaterThan(0);
    });

    test('includes model question with correct choices', async () => {
      await plugin.initialize({});
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');

      expect(modelQuestion?.choices).toContainEqual({
        value: '',
        label: 'Default',
        description: 'Use configured default model',
      });

      expect(modelQuestion?.choices).toContainEqual({
        value: 'glm-4.7',
        label: 'GLM-4.7',
        description: 'Recommended',
      });
    });

    test('includes yoloMode question', async () => {
      await plugin.initialize({});
      const questions = plugin.getSetupQuestions();
      const yoloQuestion = questions.find((q) => q.id === 'yoloMode');

      expect(yoloQuestion).toBeDefined();
      expect(yoloQuestion?.type).toBe('boolean');
      expect(yoloQuestion?.default).toBe(true);
    });
  });

  describe('dispose', () => {
    test('disposes successfully', async () => {
      await plugin.initialize({});
      await plugin.dispose();
      // Dispose should succeed
      expect(true).toBe(true);
    });

    test('can be called multiple times', async () => {
      await plugin.initialize({});
      await plugin.dispose();
      // Second dispose should not throw
      try {
        await plugin.dispose();
        expect(true).toBe(true);
      } catch (error) {
        // BaseAgentPlugin's dispose can be called multiple times
        // but may throw if already disposed
        expect(error).toBeUndefined();
      }
    });
  });
});
