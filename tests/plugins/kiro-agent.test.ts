/**
 * ABOUTME: Tests for the KiroAgentPlugin.
 * Tests metadata, initialization, and setup questions.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { KiroAgentPlugin } from '../../src/plugins/agents/builtin/kiro.js';

describe('KiroAgentPlugin', () => {
  let plugin: KiroAgentPlugin;

  beforeEach(() => {
    plugin = new KiroAgentPlugin();
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
      expect(plugin.meta.id).toBe('kiro');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('kiro-cli');
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

    test('does not support subagent tracing', () => {
      // Kiro outputs text only, no structured JSONL
      expect(plugin.meta.supportsSubagentTracing).toBe(false);
    });

    test('has no structured output format', () => {
      expect(plugin.meta.structuredOutputFormat).toBeUndefined();
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts trustAllTools config', async () => {
      await plugin.initialize({ trustAllTools: false });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts agent config', async () => {
      await plugin.initialize({ agent: 'my-custom-agent' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 60000 });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts any value (Kiro does not expose model selection)', () => {
      expect(plugin.validateModel('')).toBeNull();
      expect(plugin.validateModel('anything')).toBeNull();
    });
  });

  describe('setup questions', () => {
    test('includes trustAllTools question', () => {
      const questions = plugin.getSetupQuestions();
      const trustQuestion = questions.find(q => q.id === 'trustAllTools');
      expect(trustQuestion).toBeDefined();
      expect(trustQuestion?.type).toBe('boolean');
      expect(trustQuestion?.default).toBe(true);
    });

    test('includes agent question', () => {
      const questions = plugin.getSetupQuestions();
      const agentQuestion = questions.find(q => q.id === 'agent');
      expect(agentQuestion).toBeDefined();
      expect(agentQuestion?.type).toBe('text');
      expect(agentQuestion?.default).toBe('');
    });
  });
});
