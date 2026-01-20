/**
 * ABOUTME: Tests for the GeminiAgentPlugin.
 * Tests metadata, initialization, and model validation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { GeminiAgentPlugin } from '../../src/plugins/agents/builtin/gemini.js';

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
      expect(plugin.meta.defaultCommand).toBe('gemini');
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
  });

  describe('validateModel', () => {
    test('accepts empty string', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts gemini-2.5-pro', () => {
      expect(plugin.validateModel('gemini-2.5-pro')).toBeNull();
    });

    test('accepts gemini-2.5-flash', () => {
      expect(plugin.validateModel('gemini-2.5-flash')).toBeNull();
    });

    test('rejects non-gemini model', () => {
      const result = plugin.validateModel('gpt-4');
      expect(result).not.toBeNull();
      expect(result).toContain('gemini-');
    });
  });

  describe('setup questions', () => {
    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('select');
    });

    test('includes yoloMode question', () => {
      const questions = plugin.getSetupQuestions();
      const yoloQuestion = questions.find(q => q.id === 'yoloMode');
      expect(yoloQuestion).toBeDefined();
      expect(yoloQuestion?.type).toBe('boolean');
      expect(yoloQuestion?.default).toBe(true);
    });
  });
});
