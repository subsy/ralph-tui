/**
 * ABOUTME: Tests for the CodexAgentPlugin.
 * Tests metadata, initialization, and setup questions.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CodexAgentPlugin } from '../../src/plugins/agents/builtin/codex.js';

describe('CodexAgentPlugin', () => {
  let plugin: CodexAgentPlugin;

  beforeEach(() => {
    plugin = new CodexAgentPlugin();
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
      expect(plugin.meta.id).toBe('codex');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('codex');
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
      await plugin.initialize({ model: 'gpt-4o' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts fullAuto config', async () => {
      await plugin.initialize({ fullAuto: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts sandbox config', async () => {
      await plugin.initialize({ sandbox: 'read-only' });
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

    test('accepts any model (no strict validation)', () => {
      expect(plugin.validateModel('gpt-4o')).toBeNull();
      expect(plugin.validateModel('o1-preview')).toBeNull();
      expect(plugin.validateModel('custom-model')).toBeNull();
    });
  });

  describe('setup questions', () => {
    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find(q => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('text');
    });

    test('includes fullAuto question', () => {
      const questions = plugin.getSetupQuestions();
      const fullAutoQuestion = questions.find(q => q.id === 'fullAuto');
      expect(fullAutoQuestion).toBeDefined();
      expect(fullAutoQuestion?.type).toBe('boolean');
      expect(fullAutoQuestion?.default).toBe(true);
    });

    test('includes sandbox question', () => {
      const questions = plugin.getSetupQuestions();
      const sandboxQuestion = questions.find(q => q.id === 'sandbox');
      expect(sandboxQuestion).toBeDefined();
      expect(sandboxQuestion?.type).toBe('select');
      expect(sandboxQuestion?.default).toBe('workspace-write');
    });
  });
});
