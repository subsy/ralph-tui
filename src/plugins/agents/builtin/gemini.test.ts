/**
 * ABOUTME: Tests for the Gemini CLI agent plugin.
 * Tests configuration, argument building, and JSONL parsing for Google's Gemini CLI.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  GeminiAgentPlugin,
  extractErrorMessage,
  parseGeminiJsonLine,
  parseGeminiOutputToEvents,
} from './gemini.js';

describe('GeminiAgentPlugin', () => {
  let plugin: GeminiAgentPlugin;

  beforeEach(() => {
    plugin = new GeminiAgentPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('meta', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('gemini');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Gemini CLI');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('gemini-cli');
    });

    test('supports legacy gemini alias', () => {
      expect(plugin.meta.commandAliases).toEqual(['gemini']);
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
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.gemini/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.gemini/skills');
    });
  });

  describe('initialize', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model configuration', async () => {
      await plugin.initialize({ model: 'gemini-2.5-pro' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts yoloMode configuration', async () => {
      await plugin.initialize({ yoloMode: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout configuration', async () => {
      await plugin.initialize({ timeout: 300000 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('getSetupQuestions', () => {
    test('includes model question with choices', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('select');
      expect(modelQuestion?.choices?.length).toBeGreaterThan(0);
    });

    test('includes gemini model choices', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      const choices = modelQuestion?.choices ?? [];
      const values = choices.map((c) => c.value);
      expect(values).toContain('gemini-2.5-pro');
      expect(values).toContain('gemini-2.5-flash');
    });

    test('includes yoloMode question', () => {
      const questions = plugin.getSetupQuestions();
      const yoloQuestion = questions.find((q) => q.id === 'yoloMode');
      expect(yoloQuestion).toBeDefined();
      expect(yoloQuestion?.type).toBe('boolean');
      expect(yoloQuestion?.default).toBe(true);
    });

    test('includes base questions (command, timeout)', () => {
      const questions = plugin.getSetupQuestions();
      expect(questions.find((q) => q.id === 'command')).toBeDefined();
      expect(questions.find((q) => q.id === 'timeout')).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('accepts valid gemini model', async () => {
      const result = await plugin.validateSetup({ model: 'gemini-2.5-pro' });
      expect(result).toBeNull();
    });

    test('accepts empty model', async () => {
      const result = await plugin.validateSetup({ model: '' });
      expect(result).toBeNull();
    });

    test('rejects invalid model format', async () => {
      const result = await plugin.validateSetup({ model: 'gpt-4o' });
      expect(result).not.toBeNull();
      expect(result).toContain('gemini-');
    });
  });

  describe('validateModel', () => {
    test('accepts valid gemini model', () => {
      expect(plugin.validateModel('gemini-2.5-pro')).toBeNull();
      expect(plugin.validateModel('gemini-2.5-flash')).toBeNull();
      expect(plugin.validateModel('gemini-exp')).toBeNull();
    });

    test('accepts empty model', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('rejects non-gemini model', () => {
      const result = plugin.validateModel('gpt-4o');
      expect(result).not.toBeNull();
      expect(result).toContain('gemini-');
    });
  });
});

describe('GeminiAgentPlugin buildArgs', () => {
  let plugin: GeminiAgentPlugin;

  // Create a test subclass to access protected method
  class TestableGeminiPlugin extends GeminiAgentPlugin {
    testBuildArgs(prompt: string): string[] {
      return (this as unknown as { buildArgs: (p: string) => string[] }).buildArgs(prompt);
    }

    testGetStdinInput(prompt: string): string | undefined {
      return (this as unknown as { getStdinInput: (p: string) => string | undefined }).getStdinInput(prompt);
    }
  }

  beforeEach(() => {
    plugin = new TestableGeminiPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  test('includes --output-format stream-json', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableGeminiPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
  });

  test('includes --yolo by default', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableGeminiPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--yolo');
  });

  test('omits --yolo when disabled', async () => {
    await plugin.initialize({ yoloMode: false });
    const args = (plugin as TestableGeminiPlugin).testBuildArgs('test prompt');
    expect(args).not.toContain('--yolo');
  });

  test('includes model flag when specified', async () => {
    await plugin.initialize({ model: 'gemini-2.5-flash' });
    const args = (plugin as TestableGeminiPlugin).testBuildArgs('test prompt');
    expect(args).toContain('-m');
    expect(args).toContain('gemini-2.5-flash');
  });

  test('omits model flag when not specified', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableGeminiPlugin).testBuildArgs('test prompt');
    expect(args).not.toContain('-m');
  });

  test('returns prompt via stdin', async () => {
    await plugin.initialize({});
    const stdinInput = (plugin as TestableGeminiPlugin).testGetStdinInput('my test prompt');
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
});

describe('parseGeminiJsonLine', () => {
  test('returns empty array for empty input', () => {
    expect(parseGeminiJsonLine('')).toEqual([]);
    expect(parseGeminiJsonLine('   ')).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseGeminiJsonLine('not json')).toEqual([]);
    expect(parseGeminiJsonLine('{ invalid')).toEqual([]);
  });

  test('parses assistant message', () => {
    const input = JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: 'Hello from Gemini',
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('text');
    expect((events[0] as { content: string }).content).toBe('Hello from Gemini');
  });

  test('skips user messages', () => {
    const input = JSON.stringify({
      type: 'message',
      role: 'user',
      content: 'User input',
    });
    expect(parseGeminiJsonLine(input)).toEqual([]);
  });

  test('parses tool_call event', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      name: 'Bash',
      arguments: { command: 'ls' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('Bash');
  });

  test('parses function_call event', () => {
    const input = JSON.stringify({
      type: 'function_call',
      function: { name: 'Read' },
      args: { path: '/test' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('Read');
  });

  test('parses tool_result event with error', () => {
    const input = JSON.stringify({
      type: 'tool_result',
      is_error: true,
      error: 'File not found',
    });
    const events = parseGeminiJsonLine(input);
    expect(events.some(e => e.type === 'error')).toBe(true);
    expect(events.some(e => e.type === 'tool_result')).toBe(true);
  });

  test('parses function_result event with error', () => {
    const input = JSON.stringify({
      type: 'function_result',
      error: { message: 'Permission denied' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('error');
    expect(events[1]?.type).toBe('tool_result');
  });

  test('parses tool_result without error', () => {
    const input = JSON.stringify({
      type: 'tool_result',
      is_error: false,
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_result');
  });

  test('parses error event', () => {
    const input = JSON.stringify({
      type: 'error',
      error: 'API error occurred',
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('API error occurred');
  });

  test('parses error event with message object', () => {
    const input = JSON.stringify({
      type: 'error',
      message: 'Error from message field',
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('Error from message field');
  });

  test('skips init events', () => {
    const input = JSON.stringify({ type: 'init', session_id: 'abc' });
    expect(parseGeminiJsonLine(input)).toEqual([]);
  });

  test('skips result/stats events', () => {
    const input = JSON.stringify({ type: 'result', stats: { tokens: 100 } });
    expect(parseGeminiJsonLine(input)).toEqual([]);
  });
});

describe('parseGeminiOutputToEvents', () => {
  test('parses multiple JSONL lines', () => {
    const lines = [
      JSON.stringify({ type: 'message', role: 'assistant', content: 'Line 1' }),
      JSON.stringify({ type: 'message', role: 'assistant', content: 'Line 2' }),
    ].join('\n');
    const events = parseGeminiOutputToEvents(lines);
    expect(events.length).toBe(2);
    expect((events[0] as { content: string }).content).toBe('Line 1');
    expect((events[1] as { content: string }).content).toBe('Line 2');
  });

  test('handles empty lines', () => {
    const lines = '\n\n' + JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello' }) + '\n\n';
    const events = parseGeminiOutputToEvents(lines);
    expect(events.length).toBe(1);
  });

  test('handles mixed valid and invalid lines', () => {
    const lines = [
      'YOLO mode enabled',
      JSON.stringify({ type: 'message', role: 'assistant', content: 'Valid' }),
      'some warning',
    ].join('\n');
    const events = parseGeminiOutputToEvents(lines);
    expect(events.length).toBe(1);
    expect((events[0] as { content: string }).content).toBe('Valid');
  });
});

describe('parseGeminiJsonLine edge cases', () => {
  test('handles tool_call with input field', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      name: 'Write',
      input: { path: '/test', content: 'data' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { input: unknown }).input).toEqual({ path: '/test', content: 'data' });
  });

  test('handles tool_call with args field', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      name: 'Read',
      args: { file: '/path' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { input: unknown }).input).toEqual({ file: '/path' });
  });

  test('handles message without content', () => {
    const input = JSON.stringify({
      type: 'message',
      role: 'assistant',
    });
    const events = parseGeminiJsonLine(input);
    expect(events).toEqual([]);
  });

  test('handles tool_result with error object', () => {
    const input = JSON.stringify({
      type: 'tool_result',
      error: { message: 'Tool failed' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('Tool failed');
  });

  test('handles error event without error or message field', () => {
    const input = JSON.stringify({
      type: 'error',
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { message: string }).message).toBe('Unknown error');
  });

  test('handles function_call with function.name', () => {
    const input = JSON.stringify({
      type: 'function_call',
      function: { name: 'Glob' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('Glob');
  });

  test('handles tool_call without name', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      arguments: { foo: 'bar' },
    });
    const events = parseGeminiJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('unknown');
  });

  test('handles function_result with is_error true', () => {
    const input = JSON.stringify({
      type: 'function_result',
      is_error: true,
      error: 'Failed',
    });
    const events = parseGeminiJsonLine(input);
    expect(events.some(e => e.type === 'error')).toBe(true);
    expect(events.some(e => e.type === 'tool_result')).toBe(true);
  });
});

describe('extractErrorMessage edge cases', () => {
  test('handles circular reference gracefully', () => {
    // Create an object that would fail JSON.stringify
    const obj: Record<string, unknown> = { foo: 'bar' };
    obj.circular = obj; // Create circular reference

    const result = extractErrorMessage(obj);
    // Should fall back to 'Unknown error' when stringify fails
    expect(result).toBe('Unknown error');
  });
});
