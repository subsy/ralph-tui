/**
 * ABOUTME: Tests for the Antigravity CLI agent plugin.
 * Tests configuration, argument building, and stream-json parsing for Google's agy CLI.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  AntigravityAgentPlugin,
  parseAntigravityJsonLine,
  parseAntigravityOutputToEvents,
} from './antigravity.js';

describe('AntigravityAgentPlugin', () => {
  let plugin: AntigravityAgentPlugin;

  beforeEach(() => {
    plugin = new AntigravityAgentPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('meta', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('antigravity');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Antigravity CLI');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('agy');
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
      expect(plugin.meta.skillsPaths?.personal).toBe('~/.gemini/antigravity-cli/skills');
      expect(plugin.meta.skillsPaths?.repo).toBe('.agents/skills');
    });
  });

  describe('initialize', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model configuration', async () => {
      await plugin.initialize({ model: 'gemini-3.1-pro-low' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts skipPermissions configuration', async () => {
      await plugin.initialize({ skipPermissions: false });
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

    test('includes known antigravity model choices', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      const values = (modelQuestion?.choices ?? []).map((c) => c.value);
      expect(values).toContain('gemini-3.1-pro-low');
      expect(values).toContain('claude-sonnet-4-6');
      expect(values).toContain('gpt-oss-120b-medium');
    });

    test('includes skipPermissions question', () => {
      const questions = plugin.getSetupQuestions();
      const skipQuestion = questions.find((q) => q.id === 'skipPermissions');
      expect(skipQuestion).toBeDefined();
      expect(skipQuestion?.type).toBe('boolean');
      expect(skipQuestion?.default).toBe(true);
    });

    test('includes base questions (command, timeout)', () => {
      const questions = plugin.getSetupQuestions();
      expect(questions.find((q) => q.id === 'command')).toBeDefined();
      expect(questions.find((q) => q.id === 'timeout')).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('accepts valid model', async () => {
      const result = await plugin.validateSetup({ model: 'gemini-3.1-pro-high' });
      expect(result).toBeNull();
    });

    test('accepts empty model', async () => {
      const result = await plugin.validateSetup({ model: '' });
      expect(result).toBeNull();
    });
  });

  describe('validateModel', () => {
    test('accepts known models', () => {
      expect(plugin.validateModel('gemini-3.1-pro-low')).toBeNull();
      expect(plugin.validateModel('claude-opus-4-6-thinking')).toBeNull();
    });

    test('accepts empty model', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts unknown model strings (list drifts)', () => {
      expect(plugin.validateModel('gemini-future-model-high')).toBeNull();
    });
  });

  describe('listModels', () => {
    test('lists known Antigravity models', () => {
      const models = plugin.listModels();
      expect(models).toContain('gemini-3.6-flash-low');
      expect(models).toContain('gemini-3.1-pro-high');
      expect(models).toContain('claude-sonnet-4-6');
    });
  });

  describe('getSandboxRequirements', () => {
    test('includes gemini auth path', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.authPaths).toContain('~/.gemini');
      expect(requirements.requiresNetwork).toBe(true);
    });
  });
});

describe('AntigravityAgentPlugin buildArgs', () => {
  class TestableAntigravityPlugin extends AntigravityAgentPlugin {
    testBuildArgs(prompt: string): string[] {
      return (this as unknown as { buildArgs: (p: string) => string[] }).buildArgs(prompt);
    }

    testGetStdinInput(prompt: string): string | undefined {
      return (this as unknown as { getStdinInput: (p: string) => string | undefined }).getStdinInput(prompt);
    }
  }

  let plugin: TestableAntigravityPlugin;

  beforeEach(() => {
    plugin = new TestableAntigravityPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  test('includes --output-format stream-json', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
  });

  test('includes --dangerously-skip-permissions by default', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  test('omits --dangerously-skip-permissions when disabled', async () => {
    await plugin.initialize({ skipPermissions: false });
    const args = plugin.testBuildArgs('test prompt');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  test('includes model flag when specified', async () => {
    await plugin.initialize({ model: 'gemini-3.1-pro-low' });
    const args = plugin.testBuildArgs('test prompt');
    expect(args).toContain('--model');
    expect(args).toContain('gemini-3.1-pro-low');
  });

  test('omits model flag when not specified', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).not.toContain('--model');
  });

  test('does not pass --print (requires prompt arg; stdin is used instead)', async () => {
    await plugin.initialize({});
    const args = plugin.testBuildArgs('test prompt');
    expect(args).not.toContain('--print');
    expect(args).not.toContain('-p');
    expect(args).not.toContain('--prompt');
  });

  test('returns prompt via stdin', async () => {
    await plugin.initialize({});
    expect(plugin.testGetStdinInput('my test prompt')).toBe('my test prompt');
  });
});

describe('parseAntigravityJsonLine', () => {
  test('returns empty array for empty input', () => {
    expect(parseAntigravityJsonLine('')).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseAntigravityJsonLine('not json')).toEqual([]);
    expect(parseAntigravityJsonLine('{ invalid')).toEqual([]);
  });

  test('skips init events', () => {
    const input = JSON.stringify({
      event: 'init',
      init: { model: 'gemini-3.1-pro-low', tools: [] },
    });
    expect(parseAntigravityJsonLine(input)).toEqual([]);
  });

  test('parses agent_response text_delta', () => {
    const input = JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 3,
        state: 'DONE',
        step_type: 'agent_response',
        text_delta: 'Hello to you.\n',
      },
    });
    const events = parseAntigravityJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('text');
    expect((events[0] as { content: string }).content).toBe('Hello to you.\n');
  });

  test('skips agent_response without text_delta', () => {
    const input = JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 1,
        state: 'DONE',
        step_type: 'agent_response',
      },
    });
    expect(parseAntigravityJsonLine(input)).toEqual([]);
  });

  test('parses tool ACTIVE as tool_use', () => {
    const input = JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 4,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'list_dir',
        tool_info: {
          name: 'list_dir',
          parameters: { DirectoryPath: '/tmp' },
        },
      },
    });
    const events = parseAntigravityJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('list_dir');
    expect((events[0] as { input: unknown }).input).toEqual({ DirectoryPath: '/tmp' });
  });

  test('parses tool DONE as tool_result', () => {
    const input = JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 4,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'list_dir',
        tool_info: { name: 'list_dir', parameters: {} },
      },
    });
    const events = parseAntigravityJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('tool_result');
  });

  test('skips user_input and checkpoint steps', () => {
    expect(
      parseAntigravityJsonLine(
        JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'user_input', state: 'DONE' },
        })
      )
    ).toEqual([]);
    expect(
      parseAntigravityJsonLine(
        JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'checkpoint', state: 'DONE' },
        })
      )
    ).toEqual([]);
  });

  test('parses result ERROR', () => {
    const input = JSON.stringify({
      event: 'result',
      result: {
        status: 'ERROR',
        response: '',
        error: 'Error: empty prompt',
      },
    });
    const events = parseAntigravityJsonLine(input);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0] as { message: string }).message).toContain('empty prompt');
  });

  test('skips result SUCCESS', () => {
    const input = JSON.stringify({
      event: 'result',
      result: {
        status: 'SUCCESS',
        response: 'Hello to you.\n',
      },
    });
    expect(parseAntigravityJsonLine(input)).toEqual([]);
  });

  test('handles missing step_update payload', () => {
    expect(parseAntigravityJsonLine(JSON.stringify({ event: 'step_update' }))).toEqual([]);
  });

  test('handles tool without tool_name using tool_info.name', () => {
    const input = JSON.stringify({
      event: 'step_update',
      step_update: {
        state: 'ACTIVE',
        step_type: 'tool',
        tool_info: { name: 'grep_search', parameters: { Pattern: 'foo' } },
      },
    });
    const events = parseAntigravityJsonLine(input);
    expect(events[0]?.type).toBe('tool_use');
    expect((events[0] as { name: string }).name).toBe('grep_search');
  });
});

describe('parseAntigravityOutputToEvents', () => {
  test('parses multiple JSONL lines', () => {
    const lines = [
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'Line 1', state: 'DONE' },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'Line 2', state: 'DONE' },
      }),
    ].join('\n');
    const events = parseAntigravityOutputToEvents(lines);
    expect(events.length).toBe(2);
    expect((events[0] as { content: string }).content).toBe('Line 1');
    expect((events[1] as { content: string }).content).toBe('Line 2');
  });

  test('handles empty and invalid lines', () => {
    const lines = [
      '',
      'not json',
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'Valid', state: 'ACTIVE' },
      }),
      JSON.stringify({ event: 'init', init: {} }),
    ].join('\n');
    const events = parseAntigravityOutputToEvents(lines);
    expect(events.length).toBe(1);
    expect((events[0] as { content: string }).content).toBe('Valid');
  });
});
