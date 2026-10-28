/**
 * ABOUTME: Tests for AgentModelPicker helper behavior.
 * Covers agent config resolution, model listing, validation, and model normalization.
 */

import { beforeAll, describe, expect, mock, test } from 'bun:test';

let listModelsForAgent: typeof import('./AgentModelPicker.js').listModelsForAgent;
let normalizeModelValue: typeof import('./AgentModelPicker.js').normalizeModelValue;
let resolveAgentConfigForSelection: typeof import('./AgentModelPicker.js').resolveAgentConfigForSelection;
let validateModelForAgent: typeof import('./AgentModelPicker.js').validateModelForAgent;
let registryUsable = true;

beforeAll(async () => {
  mock.restore();
  const { getAgentRegistry } = await import('../../plugins/agents/registry.js');
  registryUsable = typeof getAgentRegistry().createInstance === 'function';
  const { registerBuiltinAgents } = await import('../../plugins/agents/builtin/index.js');
  const helpers = await import('./AgentModelPicker.js');
  listModelsForAgent = helpers.listModelsForAgent;
  normalizeModelValue = helpers.normalizeModelValue;
  resolveAgentConfigForSelection = helpers.resolveAgentConfigForSelection;
  validateModelForAgent = helpers.validateModelForAgent;
  if (registryUsable) {
    registerBuiltinAgents();
  }
});

describe('AgentModelPicker helpers', () => {
  test('resolves configured agent aliases to their plugin config', () => {
    const config = resolveAgentConfigForSelection('work-claude', [
      {
        name: 'work-claude',
        plugin: 'claude',
        options: { printMode: 'stream' },
      },
    ]);

    expect(config).toEqual({
      name: 'work-claude',
      plugin: 'claude',
      options: { printMode: 'stream' },
    });
  });

  test('falls back to a minimal plugin config for bare plugin names', () => {
    expect(resolveAgentConfigForSelection('codex')).toEqual({
      name: 'codex',
      plugin: 'codex',
      options: {},
    });
  });

  test('returns known models for agents that enumerate them', () => {
    if (!registryUsable) return;
    expect(listModelsForAgent('claude')).toEqual(['sonnet', 'opus', 'haiku']);
  });

  test('returns an empty model list for open-ended agents', () => {
    if (!registryUsable) return;
    expect(listModelsForAgent('codex')).toEqual([]);
  });

  test('validates models with the selected agent plugin', () => {
    if (!registryUsable) return;
    expect(validateModelForAgent('claude', [], 'sonnet')).toBeNull();
    expect(validateModelForAgent('claude', [], 'gpt-4o')).toContain('Invalid model');
  });

  test('normalizes blank model input to undefined', () => {
    expect(normalizeModelValue('  ')).toBeUndefined();
    expect(normalizeModelValue(' opus ')).toBe('opus');
  });
});
