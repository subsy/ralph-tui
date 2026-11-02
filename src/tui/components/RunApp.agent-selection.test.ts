/**
 * ABOUTME: Regression tests for runtime agent selection and persisted defaults.
 * Covers returning to an unchanged saved default after a temporary runtime switch.
 */

import { expect, mock, test } from 'bun:test';
import { applyAgentModelSelection } from './RunApp.js';
import type { StoredConfig } from '../../config/types.js';
import type { AgentPluginConfig } from '../../plugins/agents/types.js';

test.each(['opus', undefined])('reapplies an unchanged saved agent/model after an unsaved switch: %s', async model => {
  const stored: StoredConfig = {
    agent: 'work-claude', model,
    agents: [{ name: 'work-claude', plugin: 'claude', options: { mode: 'configured' } }],
  };
  const engine = { switchToUserAgent: mock(async (_config: AgentPluginConfig, _model?: string) => {}) };
  const save = mock(async () => {});
  await applyAgentModelSelection({ agentName: 'codex', model: undefined, saveAsDefault: false }, engine, stored, save);
  expect(save).not.toHaveBeenCalled();
  engine.switchToUserAgent.mockClear();
  await applyAgentModelSelection({ agentName: 'work-claude', model, saveAsDefault: true }, engine, stored, save);
  expect(save).toHaveBeenCalledTimes(1);
  expect(engine.switchToUserAgent).toHaveBeenCalledTimes(1);
  expect(engine.switchToUserAgent).toHaveBeenCalledWith(stored.agents![0], model);
});

test('changed saved defaults delegate the single runtime switch to the settings callback', async () => {
  const stored: StoredConfig = { agent: 'claude', model: 'opus' };
  const engine = { switchToUserAgent: mock(async (_config: AgentPluginConfig, _model?: string) => {}) };
  const save = mock(async (next: StoredConfig) => {
    await engine.switchToUserAgent({ name: next.agent!, plugin: next.agent!, options: {} }, next.model);
  });
  await applyAgentModelSelection({ agentName: 'codex', model: undefined, saveAsDefault: true }, engine, stored, save);
  expect(engine.switchToUserAgent).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].model).toBeUndefined();
});
