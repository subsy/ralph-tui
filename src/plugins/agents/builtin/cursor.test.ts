/**
 * ABOUTME: Tests for the Cursor Agent CLI plugin.
 * Tests configuration, argument building, and JSONL parsing for Cursor's agent CLI.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  CursorAgentPlugin,
  extractErrorMessage,
  parseCursorJsonLine,
  parseCursorOutputToEvents,
} from './cursor.js';

describe('CursorAgentPlugin', () => {
  let plugin: CursorAgentPlugin;

  beforeEach(() => {
    plugin = new CursorAgentPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('meta', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('cursor');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Cursor Agent');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('agent');
    });

    test('supports streaming', () => {
      expect(plugin.meta.supportsStreaming).toBe(true);
    });

    test('supports interrupt', () => {
      expect(plugin.meta.supportsInterrupt).toBe(true);
    });

    test('supports subagent tracing', () => {
      expect(plugin.meta.supportsSubagentTracing).toBe(true);
    });

    test('has JSONL structured output format', () => {
      expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
    });

    test('has skills paths configured', () => {
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.cursor/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.cursor/skills');
    });
  });

  describe('initialize', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model configuration', async () => {
      await plugin.initialize({ model: 'claude-4.5-sonnet' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts force configuration', async () => {
      await plugin.initialize({ force: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts mode configuration', async () => {
      await plugin.initialize({ mode: 'plan' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout configuration', async () => {
      await plugin.initialize({ timeout: 300000 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('getSetupQuestions', () => {
    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('text');
    });

    test('includes force question', () => {
      const questions = plugin.getSetupQuestions();
      const forceQuestion = questions.find((q) => q.id === 'force');
      expect(forceQuestion).toBeDefined();
      expect(forceQuestion?.type).toBe('boolean');
      expect(forceQuestion?.default).toBe(true);
    });

    test('includes mode question with choices', () => {
      const questions = plugin.getSetupQuestions();
      const modeQuestion = questions.find((q) => q.id === 'mode');
      expect(modeQuestion).toBeDefined();
      expect(modeQuestion?.type).toBe('select');
      expect(modeQuestion?.choices?.length).toBe(3);
      const values = modeQuestion?.choices?.map((c) => c.value) ?? [];
      expect(values).toContain('agent');
      expect(values).toContain('plan');
      expect(values).toContain('ask');
    });

    test('includes base questions (command, timeout)', () => {
      const questions = plugin.getSetupQuestions();
      expect(questions.find((q) => q.id === 'command')).toBeDefined();
      expect(questions.find((q) => q.id === 'timeout')).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('accepts valid mode', async () => {
      const result = await plugin.validateSetup({ mode: 'agent' });
      expect(result).toBeNull();
    });

    test('accepts plan mode', async () => {
      const result = await plugin.validateSetup({ mode: 'plan' });
      expect(result).toBeNull();
    });

    test('accepts ask mode', async () => {
      const result = await plugin.validateSetup({ mode: 'ask' });
      expect(result).toBeNull();
    });

    test('accepts empty mode', async () => {
      const result = await plugin.validateSetup({ mode: '' });
      expect(result).toBeNull();
    });

    test('rejects invalid mode', async () => {
      const result = await plugin.validateSetup({ mode: 'invalid' });
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid mode');
    });
  });

  describe('validateModel', () => {
    test('accepts any model', () => {
      // Cursor accepts various models, no strict validation
      expect(plugin.validateModel('claude-4.5-sonnet')).toBeNull();
      expect(plugin.validateModel('gpt-5.2')).toBeNull();
      expect(plugin.validateModel('custom-model')).toBeNull();
    });

    test('accepts empty model', () => {
      expect(plugin.validateModel('')).toBeNull();
    });
  });

  describe('getSandboxRequirements', () => {
    test('includes cursor auth paths', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.authPaths).toContain('~/.cursor');
      expect(requirements.authPaths).toContain('~/.config/cursor');
    });

    test('requires network', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.requiresNetwork).toBe(true);
    });
  });
});

describe('CursorAgentPlugin buildArgs', () => {
  let plugin: CursorAgentPlugin;

  // Create a test subclass to access protected method
  class TestableCursorPlugin extends CursorAgentPlugin {
    testBuildArgs(prompt: string): string[] {
      return (this as unknown as { buildArgs: (p: string) => string[] }).buildArgs(prompt);
    }

    testGetStdinInput(prompt: string): string | undefined {
      return (this as unknown as { getStdinInput: (p: string) => string | undefined }).getStdinInput(prompt);
    }
  }

  beforeEach(() => {
    plugin = new TestableCursorPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  test('includes --print flag', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--print');
  });

  test('includes --output-format stream-json', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
  });

  test('includes --force by default', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--force');
  });

  test('omits --force when disabled', async () => {
    await plugin.initialize({ force: false });
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).not.toContain('--force');
  });

  test('includes model flag when specified', async () => {
    await plugin.initialize({ model: 'claude-4.5-sonnet' });
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--model');
    expect(args).toContain('claude-4.5-sonnet');
  });

  test('omits model flag when not specified', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).not.toContain('--model');
  });

  test('includes mode flag when not agent', async () => {
    await plugin.initialize({ mode: 'plan' });
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--mode');
    expect(args).toContain('plan');
  });

  test('omits mode flag for default agent mode', async () => {
    await plugin.initialize({ mode: 'agent' });
    const args = (plugin as TestableCursorPlugin).testBuildArgs('test prompt');
    expect(args).not.toContain('--mode');
  });

  test('returns prompt via stdin', async () => {
    await plugin.initialize({});
    const stdinInput = (plugin as TestableCursorPlugin).testGetStdinInput('my test prompt');
    expect(stdinInput).toBe('my test prompt');
  });
});

describe('extractErrorMessage', () => {
  test('returns empty string for falsy input', () => {
    expect(extractErrorMessage(null)).toBe('');
    expect(extractErrorMessage(undefined)).toBe('');
    expect(extractErrorMessage('')).toBe('');
  });

  test('returns string directly', () => {
    expect(extractErrorMessage('error message')).toBe('error message');
  });

  test('extracts message property from object', () => {
    expect(extractErrorMessage({ message: 'error from message' })).toBe('error from message');
  });

  test('extracts error property from object', () => {
    expect(extractErrorMessage({ error: 'error from error' })).toBe('error from error');
  });

  test('prefers message over error property', () => {
    expect(extractErrorMessage({ message: 'from message', error: 'from error' })).toBe('from message');
  });

  test('stringifies object without message/error', () => {
    const result = extractErrorMessage({ foo: 'bar' });
    expect(result).toBe('{"foo":"bar"}');
  });

  test('converts non-object to string', () => {
    expect(extractErrorMessage(123)).toBe('123');
    expect(extractErrorMessage(true)).toBe('true');
  });

  test('handles circular reference gracefully', () => {
    const obj: Record<string, unknown> = { foo: 'bar' };
    obj.circular = obj;
    const result = extractErrorMessage(obj);
    expect(result).toBe('Unknown error');
  });
});

describe('parseCursorJsonLine', () => {
  test('returns empty array for empty input', () => {
    expect(parseCursorJsonLine('')).toEqual([]);
    expect(parseCursorJsonLine('   ')).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseCursorJsonLine('not json')).toEqual([]);
    expect(parseCursorJsonLine('{ invalid')).toEqual([]);
  });

  test('parses system init event', () => {
    const input = JSON.stringify({
      type: 'system',
      subtype: 'init',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('system');
    expect((events[0] as { subtype: string }).subtype).toBe('init');
  });

  test('parses assistant text message', () => {
    const input = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello from Cursor' },
        ],
      },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('text');
    expect((events[0] as { content: string }).content).toBe('Hello from Cursor');
  });

  test('parses assistant tool_use message', () => {
    const input = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Shell', input: { command: 'ls' } },
        ],
      },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('Shell');
  });

  test('parses mixed assistant content', () => {
    const input = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Running command' },
          { type: 'tool_use', name: 'Bash', input: { command: 'echo test' } },
        ],
      },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('text');
    expect(events[1]?.type).toBe('tool_use');
  });

  test('parses tool_call started event', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      name: 'Read',
      input: { path: '/test' },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('Read');
  });

  test('parses tool_call completed event', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'completed',
      is_error: false,
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_result');
  });

  test('parses tool_call completed with error', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'completed',
      is_error: true,
      error: 'File not found',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('File not found');
    expect(events[1]?.type).toBe('tool_result');
  });

  test('parses error event', () => {
    const input = JSON.stringify({
      type: 'error',
      error: 'API error occurred',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('API error occurred');
  });

  test('parses error event with message field', () => {
    const input = JSON.stringify({
      type: 'error',
      message: 'Error from message field',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('Error from message field');
  });

  test('skips result events', () => {
    const input = JSON.stringify({ type: 'result', duration: 1000 });
    expect(parseCursorJsonLine(input)).toEqual([]);
  });
});

describe('parseCursorOutputToEvents', () => {
  test('parses multiple JSONL lines', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Line 1' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Line 2' }] } }),
    ].join('\n');
    const events = parseCursorOutputToEvents(lines);
    expect(events.length).toBe(2);
    expect((events[0] as { content: string }).content).toBe('Line 1');
    expect((events[1] as { content: string }).content).toBe('Line 2');
  });

  test('handles empty lines', () => {
    const lines = '\n\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }) + '\n\n';
    const events = parseCursorOutputToEvents(lines);
    expect(events.length).toBe(1);
  });

  test('handles mixed valid and invalid lines', () => {
    const lines = [
      'some log message',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Valid' }] } }),
      'another warning',
    ].join('\n');
    const events = parseCursorOutputToEvents(lines);
    expect(events.length).toBe(1);
    expect((events[0] as { content: string }).content).toBe('Valid');
  });
});

describe('parseCursorJsonLine edge cases', () => {
  test('handles tool_call with tool field instead of name', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool: 'Glob',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('Glob');
  });

  test('handles Cursor tool_call format with nested tool_call object', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      call_id: 'test-id',
      tool_call: {
        readToolCall: {
          args: { path: '/test/file.txt' },
        },
      },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('Read');
    expect((events[0] as { input: Record<string, unknown> }).input).toEqual({ path: '/test/file.txt' });
  });

  test('handles Cursor tool_call format with bashToolCall', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool_call: {
        bashToolCall: {
          args: { command: 'ls -la' },
        },
      },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('Bash');
    expect((events[0] as { input: Record<string, unknown> }).input).toEqual({ command: 'ls -la' });
  });

  test('handles Cursor tool_call format with writeToolCall', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool_call: {
        writeToolCall: {
          args: { path: '/test/new.txt', content: 'hello' },
        },
      },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('Write');
  });

  test('handles tool_call without name or tool', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('unknown');
  });

  test('handles assistant message without content', () => {
    const input = JSON.stringify({
      type: 'assistant',
      message: {},
    });
    expect(parseCursorJsonLine(input)).toEqual([]);
  });

  test('handles assistant without message', () => {
    const input = JSON.stringify({
      type: 'assistant',
    });
    expect(parseCursorJsonLine(input)).toEqual([]);
  });

  test('handles tool_call completed with error object', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      subtype: 'completed',
      error: { message: 'Tool failed' },
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('Tool failed');
  });

  test('handles error event without error or message field', () => {
    const input = JSON.stringify({
      type: 'error',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { message: string }).message).toBe('Unknown error');
  });

  test('handles system event with various subtypes', () => {
    const input = JSON.stringify({
      type: 'system',
      subtype: 'config',
    });
    const events = parseCursorJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('system');
    expect((events[0] as { subtype: string }).subtype).toBe('config');
  });
});
