/**
 * ABOUTME: Tests for the Codex CLI agent plugin.
 * Tests configuration, argument building, and JSONL parsing for OpenAI's Codex CLI.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  CodexAgentPlugin,
  extractErrorMessage,
  parseCodexJsonLine,
  parseCodexOutputToEvents,
} from './codex.js';

describe('CodexAgentPlugin', () => {
  let plugin: CodexAgentPlugin;

  beforeEach(() => {
    plugin = new CodexAgentPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('meta', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('codex');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Codex CLI');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('codex');
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
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.codex/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.codex/skills');
    });
  });

  describe('initialize', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model configuration', async () => {
      await plugin.initialize({ model: 'gpt-4o' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts fullAuto configuration', async () => {
      await plugin.initialize({ fullAuto: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts sandbox configuration', async () => {
      await plugin.initialize({ sandbox: 'read-only' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout configuration', async () => {
      await plugin.initialize({ timeout: 300000 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('getSandboxRequirements', () => {
    test('returns auth paths for codex config', () => {
      const reqs = plugin.getSandboxRequirements();
      expect(reqs.authPaths).toContain('~/.codex');
      expect(reqs.authPaths).toContain('~/.config/codex');
      expect(reqs.authPaths).toContain('~/.local/share/codex');
    });

    test('returns binary paths including mise', () => {
      const reqs = plugin.getSandboxRequirements();
      expect(reqs.binaryPaths).toContain('~/.local/bin');
      expect(reqs.binaryPaths).toContain('~/.local/share/mise/installs');
    });

    test('requires network access', () => {
      const reqs = plugin.getSandboxRequirements();
      expect(reqs.requiresNetwork).toBe(true);
    });
  });

  describe('getSetupQuestions', () => {
    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('text');
    });

    test('includes fullAuto question', () => {
      const questions = plugin.getSetupQuestions();
      const autoQuestion = questions.find((q) => q.id === 'fullAuto');
      expect(autoQuestion).toBeDefined();
      expect(autoQuestion?.type).toBe('boolean');
      expect(autoQuestion?.default).toBe(true);
    });

    test('includes sandbox question', () => {
      const questions = plugin.getSetupQuestions();
      const sandboxQuestion = questions.find((q) => q.id === 'sandbox');
      expect(sandboxQuestion).toBeDefined();
      expect(sandboxQuestion?.type).toBe('select');
      expect(sandboxQuestion?.choices?.length).toBeGreaterThan(0);
    });

    test('includes base questions (command, timeout)', () => {
      const questions = plugin.getSetupQuestions();
      expect(questions.find((q) => q.id === 'command')).toBeDefined();
      expect(questions.find((q) => q.id === 'timeout')).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('accepts valid configuration', async () => {
      const result = await plugin.validateSetup({ model: 'gpt-4o' });
      expect(result).toBeNull();
    });

    test('accepts empty model', async () => {
      const result = await plugin.validateSetup({ model: '' });
      expect(result).toBeNull();
    });
  });

  describe('validateModel', () => {
    test('accepts any model name', () => {
      expect(plugin.validateModel('gpt-4o')).toBeNull();
      expect(plugin.validateModel('gpt-4o-mini')).toBeNull();
      expect(plugin.validateModel('custom-model')).toBeNull();
      expect(plugin.validateModel('')).toBeNull();
    });
  });
});

describe('CodexAgentPlugin buildArgs', () => {
  let plugin: CodexAgentPlugin;

  // Create a test subclass to access protected method
  class TestableCodexPlugin extends CodexAgentPlugin {
    testBuildArgs(prompt: string): string[] {
      return (this as unknown as { buildArgs: (p: string) => string[] }).buildArgs(prompt);
    }

    testGetStdinInput(prompt: string): string | undefined {
      return (this as unknown as { getStdinInput: (p: string) => string | undefined }).getStdinInput(prompt);
    }
  }

  beforeEach(() => {
    plugin = new TestableCodexPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  test('includes exec subcommand', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).toContain('exec');
  });

  test('includes --full-auto by default', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--full-auto');
  });

  test('uses approval flag when full-auto with custom sandbox', async () => {
    await plugin.initialize({ sandbox: 'danger-full-access' });
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).not.toContain('--full-auto');
    expect(args).toContain('-a');
    expect(args).toContain('on-request');
    expect(args.indexOf('-a')).toBeLessThan(args.indexOf('exec'));
  });

  test('omits --full-auto when disabled', async () => {
    await plugin.initialize({ fullAuto: false });
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).not.toContain('--full-auto');
  });

  test('includes --json for structured output', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--json');
  });

  test('includes model flag when specified', async () => {
    await plugin.initialize({ model: 'gpt-4o' });
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-4o');
  });

  test('includes sandbox mode', async () => {
    await plugin.initialize({ sandbox: 'read-only' });
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
  });

  test('uses workspace-write as default sandbox', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).toContain('--sandbox');
    expect(args).toContain('workspace-write');
  });

  test('includes - for stdin input', async () => {
    await plugin.initialize({});
    const args = (plugin as TestableCodexPlugin).testBuildArgs('test prompt');
    expect(args).toContain('-');
  });

  test('returns prompt via stdin', async () => {
    await plugin.initialize({});
    const stdinInput = (plugin as TestableCodexPlugin).testGetStdinInput('my test prompt');
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

describe('parseCodexJsonLine', () => {
  test('returns empty array for empty input', () => {
    expect(parseCodexJsonLine('')).toEqual([]);
    expect(parseCodexJsonLine('   ')).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseCodexJsonLine('not json')).toEqual([]);
    expect(parseCodexJsonLine('{ invalid')).toEqual([]);
  });

  test('parses item.completed agent_message', () => {
    const input = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Hello world' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('text');
    expect((events[0] as { content: string }).content).toBe('Hello world');
  });

  test('parses item.started command_execution', () => {
    const input = JSON.stringify({
      type: 'item.started',
      item: { type: 'command_execution', command: 'ls -la' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('shell');
  });

  test('parses item.completed command_execution with error', () => {
    const input = JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        exit_code: 1,
        aggregated_output: 'command not found',
      },
    });
    const events = parseCodexJsonLine(input);
    expect(events.some(e => e.type === 'error')).toBe(true);
    expect(events.some(e => e.type === 'tool_result')).toBe(true);
  });

  test('parses item.completed command_execution with exit_code 0', () => {
    const input = JSON.stringify({
      type: 'item.completed',
      item: { type: 'command_execution', exit_code: 0 },
    });
    const events = parseCodexJsonLine(input);
    // Successful command - only tool_result, no error
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_result');
  });

  test('parses item.started file_edit', () => {
    const input = JSON.stringify({
      type: 'item.started',
      item: { type: 'file_edit', file_path: '/path/to/file.ts' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('file_edit');
  });

  test('parses item.completed file_edit', () => {
    const input = JSON.stringify({
      type: 'item.completed',
      item: { type: 'file_edit', file_path: '/path/to/file.ts' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_result');
  });

  test('parses error event with message object', () => {
    const input = JSON.stringify({
      type: 'error',
      error: { message: 'API error' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toBe('API error');
  });

  test('returns empty array for item without item property', () => {
    const input = JSON.stringify({ type: 'item.completed' });
    expect(parseCodexJsonLine(input)).toEqual([]);
  });

  test('skips lifecycle events', () => {
    expect(parseCodexJsonLine(JSON.stringify({ type: 'thread.started' }))).toEqual([]);
    expect(parseCodexJsonLine(JSON.stringify({ type: 'turn.started' }))).toEqual([]);
    expect(parseCodexJsonLine(JSON.stringify({ type: 'turn.completed' }))).toEqual([]);
  });
});

describe('parseCodexOutputToEvents', () => {
  test('parses multiple JSONL lines', () => {
    const lines = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Line 1' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Line 2' } }),
    ].join('\n');
    const events = parseCodexOutputToEvents(lines);
    expect(events.length).toBe(2);
    expect((events[0] as { content: string }).content).toBe('Line 1');
    expect((events[1] as { content: string }).content).toBe('Line 2');
  });

  test('handles empty lines', () => {
    const lines = '\n\n' + JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello' } }) + '\n\n';
    const events = parseCodexOutputToEvents(lines);
    expect(events.length).toBe(1);
  });

  test('handles mixed valid and invalid lines', () => {
    const lines = [
      'not json',
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Valid' } }),
      'also not json',
    ].join('\n');
    const events = parseCodexOutputToEvents(lines);
    expect(events.length).toBe(1);
    expect((events[0] as { content: string }).content).toBe('Valid');
  });
});

describe('parseCodexJsonLine edge cases', () => {
  test('parses file_write with path field', () => {
    const input = JSON.stringify({
      type: 'item.started',
      item: { type: 'file_write', path: '/other/path.ts' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('file_write');
  });

  test('parses file_read event', () => {
    const input = JSON.stringify({
      type: 'item.started',
      item: { type: 'file_read', file_path: '/read/this.ts' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { name: string }).name).toBe('file_read');
  });

  test('parses error event with string error', () => {
    const input = JSON.stringify({
      type: 'error',
      error: 'Direct string error',
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as { message: string }).message).toBe('Direct string error');
  });

  test('parses error event with event.error object', () => {
    const input = JSON.stringify({
      type: 'error',
      error: { message: 'Nested error message' },
    });
    const events = parseCodexJsonLine(input);
    expect((events[0] as { message: string }).message).toBe('Nested error message');
  });

  test('handles command_execution with null exit_code', () => {
    const input = JSON.stringify({
      type: 'item.completed',
      item: { type: 'command_execution', exit_code: null },
    });
    const events = parseCodexJsonLine(input);
    // exit_code null means still running/no error, just tool_result
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_result');
  });

  test('truncates long aggregated_output', () => {
    const longOutput = 'x'.repeat(600);
    const input = JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        exit_code: 1,
        aggregated_output: longOutput,
      },
    });
    const events = parseCodexJsonLine(input);
    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { message: string }).message.length).toBeLessThanOrEqual(500);
  });

  test('handles event with missing item type', () => {
    const input = JSON.stringify({
      type: 'item.completed',
      item: { text: 'no type field' },
    });
    const events = parseCodexJsonLine(input);
    expect(events).toEqual([]);
  });

  test('handles file operation with neither file_path nor path', () => {
    const input = JSON.stringify({
      type: 'item.started',
      item: { type: 'file_edit' },
    });
    const events = parseCodexJsonLine(input);
    expect(events.length).toBe(1);
    expect((events[0] as unknown as { input: { path: string } }).input.path).toBe('unknown');
  });
});
