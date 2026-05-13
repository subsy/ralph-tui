/**
 * ABOUTME: Tests for SettingsView helper behavior.
 * Verifies model setting choices are derived from selected agent metadata.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { registerBuiltinAgents } from '../../plugins/agents/builtin/index.js';
import {
  buildModelOptionsForAgent,
  buildSettingDefinitions,
} from './SettingsView.js';

beforeAll(() => {
  registerBuiltinAgents();
});

describe('SettingsView helpers', () => {
  test('shows known Claude models as select choices', () => {
    const settings = buildSettingDefinitions(['claude'], [], { agent: 'claude' });
    const modelSetting = settings.find((setting) => setting.key === 'model');

    expect(modelSetting?.type).toBe('select');
    expect(modelSetting?.options).toEqual(['', 'sonnet', 'opus', 'haiku']);
  });

  test('resolves configured agent aliases for model choices', () => {
    const options = buildModelOptionsForAgent(
      'work-claude',
      [
        {
          name: 'work-claude',
          plugin: 'claude',
          options: {},
        },
      ],
      undefined
    );

    expect(options).toEqual(['', 'sonnet', 'opus', 'haiku']);
  });

  test('keeps open-ended agents as free text', () => {
    const settings = buildSettingDefinitions(['codex'], [], { agent: 'codex' });
    const modelSetting = settings.find((setting) => setting.key === 'model');

    expect(modelSetting?.type).toBe('text');
    expect(modelSetting?.options).toBeUndefined();
  });

  test('clears model override when the default choice is selected', () => {
    const settings = buildSettingDefinitions(['claude'], [], {
      agent: 'claude',
      model: 'opus',
    });
    const modelSetting = settings.find((setting) => setting.key === 'model');

    expect(modelSetting?.setValue({ agent: 'claude', model: 'opus' }, '')).toEqual({
      agent: 'claude',
    });
  });
});
