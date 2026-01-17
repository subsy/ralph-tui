/**
 * ABOUTME: Tests for the OpenCodeAgentPlugin.
 * Tests specific behaviors like model validation, setup questions, and agent types.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { OpenCodeAgentPlugin } from '../../src/plugins/agents/builtin/opencode.js';

describe('OpenCodeAgentPlugin', () => {
  let plugin: OpenCodeAgentPlugin;

  beforeEach(() => {
    plugin = new OpenCodeAgentPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('opencode');
    });

    test('has correct default command', () => {
      expect(plugin.meta.defaultCommand).toBe('opencode');
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

    test('does not support subagent tracing', () => {
      expect(plugin.meta.supportsSubagentTracing).toBe(false);
    });
  });

  describe('initialization', () => {
    test('initializes with default config', async () => {
      await plugin.initialize({});
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts provider config', async () => {
      await plugin.initialize({ provider: 'anthropic' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts model config', async () => {
      await plugin.initialize({ model: 'claude-3-5-sonnet' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts agent type config', async () => {
      await plugin.initialize({ agent: 'build' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts format config', async () => {
      await plugin.initialize({ format: 'json' });
      expect(await plugin.isReady()).toBe(true);
    });

    test('accepts timeout config', async () => {
      await plugin.initialize({ timeout: 120000 });
      expect(await plugin.isReady()).toBe(true);
    });

    test('ignores invalid agent type', async () => {
      await plugin.initialize({ agent: 'invalid' });
      expect(await plugin.isReady()).toBe(true);
    });
  });

  describe('validateModel', () => {
    test('accepts empty string', () => {
      expect(plugin.validateModel('')).toBeNull();
    });

    test('accepts provider/model format', () => {
      expect(plugin.validateModel('anthropic/claude-3-5-sonnet')).toBeNull();
    });

    test('accepts openai provider format', () => {
      expect(plugin.validateModel('openai/gpt-4o')).toBeNull();
    });

    test('accepts model without provider', () => {
      expect(plugin.validateModel('claude-3-5-sonnet')).toBeNull();
    });

    test('rejects malformed provider/model', () => {
      const result = plugin.validateModel('provider/');
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid model format');
    });

    test('rejects empty provider with slash', () => {
      const result = plugin.validateModel('/model');
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid model format');
    });
  });

  describe('validateSetup', () => {
    test('accepts valid agent type: general', async () => {
      expect(await plugin.validateSetup({ agent: 'general' })).toBeNull();
    });

    test('accepts valid agent type: build', async () => {
      expect(await plugin.validateSetup({ agent: 'build' })).toBeNull();
    });

    test('accepts valid agent type: plan', async () => {
      expect(await plugin.validateSetup({ agent: 'plan' })).toBeNull();
    });

    test('accepts empty agent type', async () => {
      expect(await plugin.validateSetup({ agent: '' })).toBeNull();
    });

    test('rejects invalid agent type', async () => {
      const result = await plugin.validateSetup({ agent: 'invalid' });
      expect(result).not.toBeNull();
      expect(result).toContain('Invalid agent type');
    });

    test('accepts any provider string', async () => {
      // OpenCode supports 75+ providers - validation is delegated to CLI
      expect(await plugin.validateSetup({ provider: 'anthropic' })).toBeNull();
      expect(await plugin.validateSetup({ provider: 'openai' })).toBeNull();
      expect(await plugin.validateSetup({ provider: 'google' })).toBeNull();
      expect(await plugin.validateSetup({ provider: 'custom-provider' })).toBeNull();
    });
  });

  describe('getSetupQuestions', () => {
    test('includes command question from base', () => {
      const questions = plugin.getSetupQuestions();
      const commandQuestion = questions.find((q) => q.id === 'command');
      expect(commandQuestion).toBeDefined();
      expect(commandQuestion?.type).toBe('path');
    });

    test('includes provider question', () => {
      const questions = plugin.getSetupQuestions();
      const providerQuestion = questions.find((q) => q.id === 'provider');
      expect(providerQuestion).toBeDefined();
      expect(providerQuestion?.type).toBe('select');
      expect(providerQuestion?.choices?.some((c) => c.value === 'anthropic')).toBe(true);
      expect(providerQuestion?.choices?.some((c) => c.value === 'openai')).toBe(true);
    });

    test('includes model question', () => {
      const questions = plugin.getSetupQuestions();
      const modelQuestion = questions.find((q) => q.id === 'model');
      expect(modelQuestion).toBeDefined();
      expect(modelQuestion?.type).toBe('text');
    });

    test('includes agent type question', () => {
      const questions = plugin.getSetupQuestions();
      const agentQuestion = questions.find((q) => q.id === 'agent');
      expect(agentQuestion).toBeDefined();
      expect(agentQuestion?.type).toBe('select');
      expect(agentQuestion?.choices?.length).toBe(3);
    });

    // Note: format is not a setup question - it's hardcoded to 'json'
    // because the streaming output parser requires JSON format to work
  });

  describe('dispose', () => {
    test('disposes cleanly', async () => {
      await plugin.initialize({});
      await plugin.dispose();
      expect(await plugin.isReady()).toBe(false);
    });
  });
});
