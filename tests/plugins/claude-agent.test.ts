/**
 * ABOUTME: Tests for the ClaudeAgentPlugin.
 * Tests prompt building, response parsing, JSONL parsing, and setup validation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeAgentPlugin } from '../../src/plugins/agents/builtin/claude.js';
import type { ClaudeJsonlMessage, JsonlParseResult } from '../../src/plugins/agents/builtin/claude.js';

describe('ClaudeAgentPlugin', () => {
  let plugin: ClaudeAgentPlugin;

  beforeEach(() => {
    plugin = new ClaudeAgentPlugin();
  });

  afterEach(async () => {
    // Guard against double-dispose when explicit dispose test runs
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
      expect(plugin.meta.id).toBe('claude');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('claude');
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

    test('uses jsonl for structured output', () => {
      expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts printMode config', async () => {
      await plugin.initialize({ printMode: 'json' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'sonnet' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts skipPermissions config', async () => {
      await plugin.initialize({ skipPermissions: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 60000 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts empty string', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts sonnet', () => {
      expect(plugin.validateModel('sonnet')).toBeNull();
    });

    test('accepts opus', () => {
      expect(plugin.validateModel('opus')).toBeNull();
    });

    test('accepts haiku', () => {
      expect(plugin.validateModel('haiku')).toBeNull();
    });

    test('rejects invalid model', () => {
      const result = plugin.validateModel('gpt-4');
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid model');
      expect(result).toContain('sonnet');
      expect(result).toContain('opus');
      expect(result).toContain('haiku');
    });
  });

  describe('validateSetup', () => {
    test('accepts valid printMode', async () => {
      expect(await plugin.validateSetup({ printMode: 'text' })).toBeNull();
      expect(await plugin.validateSetup({ printMode: 'json' })).toBeNull();
      expect(await plugin.validateSetup({ printMode: 'stream' })).toBeNull();
    });

    test('accepts empty printMode', async () => {
      expect(await plugin.validateSetup({ printMode: '' })).toBeNull();
    });

    test('rejects invalid printMode', async () => {
      const result = await plugin.validateSetup({ printMode: 'invalid' });
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid print mode');
    });

    test('accepts valid model', async () => {
      expect(await plugin.validateSetup({ model: 'sonnet' })).toBeNull();
      expect(await plugin.validateSetup({ model: 'opus' })).toBeNull();
      expect(await plugin.validateSetup({ model: 'haiku' })).toBeNull();
    });

    test('accepts empty model', async () => {
      expect(await plugin.validateSetup({ model: '' })).toBeNull();
    });

    test('rejects invalid model', async () => {
      const result = await plugin.validateSetup({ model: 'invalid' });
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid model');
    });
  });

  describe('getSetupQuestions', () => {
    test('includes command question from base', () => {
      const questions = plugin.getSetupQuestions();
      const commandQuestion = questions.find((q) => q.id === 'command');
      expect(commandQuestion).toBeDefined();
      expect(commandQuestion?.type).toBe('path');
    });

    test('includes printMode question', () => {
      const questions = plugin.getSetupQuestions();
      const printModeQuestion = questions.find((q) => q.id === 'printMode');
      expect(printModeQuestion).toBeDefined();
      expect(printModeQuestion?.type).toBe('select');
      expect(printModeQuestion?.choices?.length).toBeGreaterThan(0);
    });

    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('select');
      expect(modelQuestion?.choices?.some((c) => c.value === 'sonnet')).toBe(true);
    });

    test('includes skipPermissions question', () => {
      const questions = plugin.getSetupQuestions();
      const skipQuestion = questions.find((q) => q.id === 'skipPermissions');
      expect(skipQuestion).toBeDefined();
      expect(skipQuestion?.type).toBe('boolean');
      expect(skipQuestion?.default).toBe(true);
    });
  });

  describe('VALID_MODELS constant', () => {
    test('contains expected models', () => {
      expect(ClaudeAgentPlugin.VALID_MODELS).toContain('sonnet');
      expect(ClaudeAgentPlugin.VALID_MODELS).toContain('opus');
      expect(ClaudeAgentPlugin.VALID_MODELS).toContain('haiku');
      expect(ClaudeAgentPlugin.VALID_MODELS.length).toBe(3);
    });
  });

  describe('parseJsonlLine', () => {
    test('parses valid JSON line', () => {
      const json = '{"type": "assistant", "message": "Hello"}';
      const result = ClaudeAgentPlugin.parseJsonlLine(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe('assistant');
        expect(result.message.message).toBe('Hello');
      }
    });

    test('returns failure for empty line', () => {
      const result = ClaudeAgentPlugin.parseJsonlLine('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Empty line');
      }
    });

    test('returns failure for whitespace-only line', () => {
      const result = ClaudeAgentPlugin.parseJsonlLine('   \n\t  ');
      expect(result.success).toBe(false);
    });

    test('returns failure for invalid JSON', () => {
      const result = ClaudeAgentPlugin.parseJsonlLine('not json');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.raw).toBe('not json');
        expect(result.error).toBeDefined();
      }
    });

    test('extracts tool information', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        tool: { name: 'read_file', input: { path: '/test.txt' } },
      });
      const result = ClaudeAgentPlugin.parseJsonlLine(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.tool?.name).toBe('read_file');
        expect(result.message.tool?.input?.path).toBe('/test.txt');
      }
    });

    test('extracts cost information', () => {
      const json = JSON.stringify({
        type: 'result',
        cost: { inputTokens: 100, outputTokens: 50, totalUSD: 0.01 },
      });
      const result = ClaudeAgentPlugin.parseJsonlLine(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.cost?.inputTokens).toBe(100);
        expect(result.message.cost?.outputTokens).toBe(50);
        expect(result.message.cost?.totalUSD).toBe(0.01);
      }
    });

    test('extracts session ID', () => {
      const json = JSON.stringify({
        type: 'init',
        sessionId: 'session-123',
      });
      const result = ClaudeAgentPlugin.parseJsonlLine(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.sessionId).toBe('session-123');
      }
    });

    test('extracts result data', () => {
      const json = JSON.stringify({
        type: 'result',
        result: { success: true, data: 'completed' },
      });
      const result = ClaudeAgentPlugin.parseJsonlLine(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.result).toEqual({ success: true, data: 'completed' });
      }
    });

    test('preserves raw JSON in message', () => {
      const original = { type: 'custom', custom_field: 'value' };
      const json = JSON.stringify(original);
      const result = ClaudeAgentPlugin.parseJsonlLine(json);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.raw.custom_field).toBe('value');
      }
    });
  });

  describe('parseJsonlOutput', () => {
    test('parses multiple JSON lines', () => {
      const output = [
        '{"type": "init", "sessionId": "123"}',
        '{"type": "assistant", "message": "Hello"}',
        '{"type": "result", "result": "done"}',
      ].join('\n');

      const result = ClaudeAgentPlugin.parseJsonlOutput(output);

      expect(result.messages.length).toBe(3);
      expect(result.fallback.length).toBe(0);
    });

    test('handles mixed valid and invalid lines', () => {
      const output = [
        '{"type": "init"}',
        'plain text line',
        '{"type": "result"}',
      ].join('\n');

      const result = ClaudeAgentPlugin.parseJsonlOutput(output);

      expect(result.messages.length).toBe(2);
      expect(result.fallback.length).toBe(1);
      expect(result.fallback[0]).toBe('plain text line');
    });

    test('ignores empty lines in output', () => {
      const output = '{"type": "init"}\n\n\n{"type": "result"}';

      const result = ClaudeAgentPlugin.parseJsonlOutput(output);

      expect(result.messages.length).toBe(2);
      expect(result.fallback.length).toBe(0);
    });

    test('handles empty output', () => {
      const result = ClaudeAgentPlugin.parseJsonlOutput('');

      expect(result.messages.length).toBe(0);
      expect(result.fallback.length).toBe(0);
    });
  });

  describe('createStreamingJsonlParser', () => {
    test('parses complete lines from chunks', () => {
      const parser = ClaudeAgentPlugin.createStreamingJsonlParser();

      const results1 = parser.push('{"type": "init"}\n');
      expect(results1.length).toBe(1);
      expect(results1[0]?.success).toBe(true);

      const results2 = parser.push('{"type": "result"}\n');
      expect(results2.length).toBe(1);
      expect(results2[0]?.success).toBe(true);
    });

    test('handles partial lines across chunks', () => {
      const parser = ClaudeAgentPlugin.createStreamingJsonlParser();

      // First chunk - partial line
      const results1 = parser.push('{"type": ');
      expect(results1.length).toBe(0);

      // Second chunk - completes the line
      const results2 = parser.push('"init"}\n');
      expect(results2.length).toBe(1);
      expect(results2[0]?.success).toBe(true);
      if (results2[0]?.success) {
        expect(results2[0].message.type).toBe('init');
      }
    });

    test('flush handles remaining buffer', () => {
      const parser = ClaudeAgentPlugin.createStreamingJsonlParser();

      // Push without newline
      parser.push('{"type": "final"}');

      // Flush the remaining content
      const results = parser.flush();
      expect(results.length).toBe(1);
      expect(results[0]?.success).toBe(true);
    });

    test('getState returns accumulated results', () => {
      const parser = ClaudeAgentPlugin.createStreamingJsonlParser();

      parser.push('{"type": "init"}\n');
      parser.push('not json\n');
      parser.push('{"type": "result"}\n');

      const state = parser.getState();
      expect(state.messages.length).toBe(2);
      expect(state.fallback.length).toBe(1);
    });

    test('handles multiple lines in single chunk', () => {
      const parser = ClaudeAgentPlugin.createStreamingJsonlParser();

      const results = parser.push('{"type": "a"}\n{"type": "b"}\n{"type": "c"}\n');
      expect(results.length).toBe(3);
    });

    test('flush returns empty for empty buffer', () => {
      const parser = ClaudeAgentPlugin.createStreamingJsonlParser();
      parser.push('{"type": "init"}\n');

      const results = parser.flush();
      expect(results.length).toBe(0);
    });
  });

  describe('dispose', () => {
    test('disposes cleanly', async () => {
      await plugin.initialize({});
      await plugin.dispose();
      expect(await plugin.isReady()).toBe(false);
    });
  });

  describe('getSandboxRequirements', () => {
    test('returns correct auth paths', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.authPaths).toContain('~/.claude');
      expect(requirements.authPaths).toContain('~/.anthropic');
    });

    test('returns correct binary paths', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.binaryPaths).toContain('/usr/local/bin');
      expect(requirements.binaryPaths).toContain('~/.local/bin');
      expect(requirements.binaryPaths).toContain('~/.local/share/claude');
    });

    test('requires network', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.requiresNetwork).toBe(true);
    });

    test('includes runtime paths for bun and nvm', () => {
      const requirements = plugin.getSandboxRequirements();
      expect(requirements.runtimePaths).toContain('~/.bun');
      expect(requirements.runtimePaths).toContain('~/.nvm');
    });
  });
});
