/**
 * ABOUTME: Tests for the xAI Grok CLI agent plugin.
 * Tests configuration, argument building, and streaming-json parsing for Grok Build TUI.
 */

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import * as actualOs from 'node:os';

let mockedPlatform = actualOs.platform();
mock.module('node:os', () => ({
  ...actualOs,
  platform: () => mockedPlatform,
}));

// @ts-expect-error - Bun supports query strings in imports to get fresh module instances
const grokModule = await import('./grok.js?test-platform') as typeof import('./grok.js');
const { GrokAgentPlugin, parseGrokJsonLine, parseGrokOutputToEvents } = grokModule;

class TestableGrokPlugin extends GrokAgentPlugin {
  testBuildArgs(prompt: string): string[] {
    return this.buildArgs(prompt);
  }

  testGetStdinInput(prompt: string): string | undefined {
    return this.getStdinInput(prompt);
  }
}

describe('GrokAgentPlugin', () => {
  let plugin: TestableGrokPlugin;

  beforeEach(() => {
    mockedPlatform = 'linux';
    plugin = new TestableGrokPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
    mockedPlatform = 'linux';
  });

  describe('meta', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('grok');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Grok CLI');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('grok');
    });

    test('supports streaming', () => {
      expect(plugin.meta.supportsStreaming).toBe(true);
    });

    test('supports interrupt', () => {
      expect(plugin.meta.supportsInterrupt).toBe(true);
    });

    test('does not support file context', () => {
      expect(plugin.meta.supportsFileContext).toBe(false);
    });

    test('supports subagent tracing', () => {
      expect(plugin.meta.supportsSubagentTracing).toBe(true);
    });

    test('has JSONL structured output format', () => {
      expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
    });

    test('has skills paths configured', () => {
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.grok/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.grok/skills');
    });
  });

  describe('initialize', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model configuration', async () => {
      await plugin.initialize({ model: 'grok-4.5' });
      expect(await plugin.isReady()).toBe(true);
      const args = plugin.testBuildArgs('prompt');
      expect(args).toContain('grok-4.5');
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
      expect(modelQuestion?.required).toBe(false);
    });

    test('includes base questions (command, timeout)', () => {
      const questions = plugin.getSetupQuestions();
      expect(questions.find((q) => q.id === 'command')).toBeDefined();
      expect(questions.find((q) => q.id === 'timeout')).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('accepts valid grok model', async () => {
      const result = await plugin.validateSetup({ model: 'grok-4.5' });
      expect(result).toBeNull();
    });

    test('accepts empty model', async () => {
      const result = await plugin.validateSetup({ model: '' });
      expect(result).toBeNull();
    });

    test('accepts any model name (no strict validation)', async () => {
      const result = await plugin.validateSetup({ model: 'any-model-name' });
      expect(result).toBeNull();
    });
  });

  describe('validateModel', () => {
    test('accepts empty, whitespace, and custom model names', () => {
      expect(plugin.validateModel('')).toBeNull();
      expect(plugin.validateModel('   ')).toBeNull();
      expect(plugin.validateModel('grok-custom')).toBeNull();
    });
  });

  describe('detect', () => {
    test('reports a clear error when grok is not installed', async () => {
      await plugin.initialize({ command: '/definitely/missing/grok' });
      const result = await plugin.detect();
      expect(result.available).toBe(false);
      expect(result.error).toContain('Grok CLI not found in PATH');
    });
  });

  describe('getSandboxRequirements', () => {
    test('includes ~/.grok auth path', () => {
      const reqs = plugin.getSandboxRequirements();
      expect(reqs.authPaths).toContain('~/.grok');
    });

    test('includes grok binary paths', () => {
      const reqs = plugin.getSandboxRequirements();
      expect(reqs.binaryPaths).toContain('~/.grok/bin');
    });

    test('requires network', () => {
      const reqs = plugin.getSandboxRequirements();
      expect(reqs.requiresNetwork).toBe(true);
    });
  });
});

describe('GrokAgentPlugin buildArgs', () => {
  let plugin: TestableGrokPlugin;

  beforeEach(() => {
    mockedPlatform = 'linux';
    plugin = new TestableGrokPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
    mockedPlatform = 'linux';
  });

  test('includes --always-approve', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).toContain('--always-approve');
  });

  test('includes --output-format streaming-json', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('streaming-json');
  });

  test('does not use stream-json or dangerously-skip-permissions', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).not.toContain('stream-json');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  test('includes model flag when specified', async () => {
    await plugin.initialize({ model: 'grok-4.5' });
    const args = plugin.testBuildArgs('test prompt');
    expect(args).toContain('--model');
    expect(args).toContain('grok-4.5');
  });

  test('omits model flag when not specified', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).not.toContain('--model');
  });

  test('treats a whitespace-only model as unset', async () => {
    await plugin.initialize({ model: '   ' });
    const args = plugin.testBuildArgs('test prompt');
    expect(args).not.toContain('--model');
  });

  test('trims surrounding whitespace from the model', async () => {
    await plugin.initialize({ model: '  grok-4.5  ' });
    const args = plugin.testBuildArgs('test prompt');
    expect(args).toContain('grok-4.5');
  });

  test('uses stdin prompt delivery on non-Windows', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('my test prompt');
    const stdinInput = plugin.testGetStdinInput('my test prompt');

    if (process.platform === 'win32') {
      expect(args).toContain('-p');
      expect(args).toContain('my test prompt');
      expect(stdinInput).toBeUndefined();
    } else {
      expect(args).toContain('--prompt-file');
      expect(args).toContain('/dev/stdin');
      expect(stdinInput).toBe('my test prompt');
    }
  });

  test('uses the prompt argument on Windows', async () => {
    mockedPlatform = 'win32';
    await plugin.initialize({ model: 'grok-4.5' });
    const args = plugin.testBuildArgs('my Windows prompt');

    expect(args).toEqual([
      '--always-approve',
      '--output-format',
      'streaming-json',
      '-p',
      'my Windows prompt',
      '--model',
      'grok-4.5',
    ]);
    expect(plugin.testGetStdinInput('my Windows prompt')).toBeUndefined();
  });
});

describe('parseGrokJsonLine', () => {
  test('returns empty array for empty input', () => {
    expect(parseGrokJsonLine('')).toEqual([]);
    expect(parseGrokJsonLine('   ')).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseGrokJsonLine('not json')).toEqual([]);
    expect(parseGrokJsonLine('{ invalid')).toEqual([]);
  });

  test('parses text delta events', () => {
    const input = JSON.stringify({ type: 'text', data: 'Hello from Grok' });
    const events = parseGrokJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('text');
    expect((events[0] as { content: string }).content).toBe('Hello from Grok');
  });

  test('skips empty text data', () => {
    const input = JSON.stringify({ type: 'text', data: '' });
    expect(parseGrokJsonLine(input)).toEqual([]);
  });

  test('skips thought events', () => {
    const input = JSON.stringify({ type: 'thought', data: 'internal reasoning...' });
    expect(parseGrokJsonLine(input)).toEqual([]);
  });

  test('skips available_commands events', () => {
    const input = JSON.stringify({ type: 'available_commands', tools: ['read_file'] });
    expect(parseGrokJsonLine(input)).toEqual([]);
  });

  test('skips usage events', () => {
    const input = JSON.stringify({
      type: 'usage',
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    expect(parseGrokJsonLine(input)).toEqual([]);
  });

  test('skips end events', () => {
    const input = JSON.stringify({
      type: 'end',
      stopReason: 'end_turn',
      sessionId: 'abc',
    });
    expect(parseGrokJsonLine(input)).toEqual([]);
  });

  test('parses tool_call event', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      toolCallId: 'call-1',
      title: 'list_dir',
      kind: 'list',
      status: 'pending',
      toolName: 'list_dir',
      rawInput: { target_directory: '.' },
      content: [],
      locations: [],
    });
    const events = parseGrokJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('list_dir');
    expect((events[0] as { input: Record<string, unknown> }).input).toEqual({
      target_directory: '.',
    });
  });

  test('uses title as tool name fallback', () => {
    const input = JSON.stringify({
      type: 'tool_call',
      title: 'read_file',
      status: 'pending',
    });
    const events = parseGrokJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('read_file');
  });

  test('parses tool_call_update completed as tool_result', () => {
    const input = JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      content: [],
      rawOutput: { type: 'ListDir', Content: { content: 'files...' } },
    });
    const events = parseGrokJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_result');
  });

  test('skips tool_call_update with null status', () => {
    const input = JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-1',
      status: null,
      content: [],
      rawOutput: null,
    });
    expect(parseGrokJsonLine(input)).toEqual([]);
  });

  test('parses failed tool_call_update as error + tool_result', () => {
    const input = JSON.stringify({
      type: 'tool_call_update',
      status: 'failed',
      error: { message: 'Permission denied' },
    });
    const events = parseGrokJsonLine(input);
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('Permission denied');
    expect(events[1]?.type).toBe('tool_result');
  });

  test('parses top-level error event', () => {
    const input = JSON.stringify({
      type: 'error',
      error: { message: 'API rate limit' },
    });
    const events = parseGrokJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('API rate limit');
  });

  test('parses error with string error field', () => {
    const input = JSON.stringify({
      type: 'error',
      error: 'Something went wrong',
    });
    const events = parseGrokJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { message: string }).message).toBe('Something went wrong');
  });
});

describe('parseGrokOutputToEvents', () => {
  test('parses multiple JSONL lines', () => {
    const lines = [
      JSON.stringify({ type: 'text', data: 'Hi' }),
      JSON.stringify({ type: 'text', data: ' there' }),
    ].join('\n');
    const events = parseGrokOutputToEvents(lines);
    expect(events.length).toBe(2);
    expect((events[0] as { content: string }).content).toBe('Hi');
    expect((events[1] as { content: string }).content).toBe(' there');
  });

  test('handles empty lines', () => {
    const lines =
      '\n\n' + JSON.stringify({ type: 'text', data: 'Hello' }) + '\n\n';
    const events = parseGrokOutputToEvents(lines);
    expect(events.length).toBe(1);
  });

  test('handles mixed valid and invalid lines', () => {
    const lines = [
      'some status text',
      JSON.stringify({ type: 'text', data: 'Valid' }),
      'another status line',
      JSON.stringify({ type: 'thought', data: 'skip me' }),
    ].join('\n');
    const events = parseGrokOutputToEvents(lines);
    expect(events.length).toBe(1);
    expect((events[0] as { content: string }).content).toBe('Valid');
  });

  test('returns empty array for empty input', () => {
    expect(parseGrokOutputToEvents('')).toEqual([]);
  });

  test('parses realistic tool flow', () => {
    const lines = [
      JSON.stringify({ type: 'available_commands', tools: ['list_dir'] }),
      JSON.stringify({ type: 'thought', data: 'I should list' }),
      JSON.stringify({
        type: 'tool_call',
        toolName: 'list_dir',
        rawInput: { target_directory: '.' },
        status: 'pending',
      }),
      JSON.stringify({
        type: 'tool_call_update',
        status: 'completed',
        rawOutput: { type: 'ListDir' },
      }),
      JSON.stringify({ type: 'text', data: 'DONE' }),
      JSON.stringify({ type: 'end', stopReason: 'end_turn' }),
    ].join('\n');
    const events = parseGrokOutputToEvents(lines);
    expect(events.map((e) => e.type)).toEqual(['tool_use', 'tool_result', 'text']);
    expect((events[0] as { name: string }).name).toBe('list_dir');
    expect((events[2] as { content: string }).content).toBe('DONE');
  });
});
