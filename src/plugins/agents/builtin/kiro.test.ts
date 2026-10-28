/**
 * ABOUTME: Tests for the Kiro CLI agent plugin.
 * Verifies model enumeration used by the agent/model picker.
 */

import { describe, expect, test } from 'bun:test';
import { KiroAgentPlugin } from './kiro.js';

describe('KiroAgentPlugin', () => {
  test('lists known non-empty Kiro models', () => {
    const plugin = new KiroAgentPlugin();

    expect(plugin.listModels()).toEqual([
      'claude-sonnet4',
      'claude-sonnet4.5',
      'claude-haiku4.5',
      'claude-opus4.5',
    ]);
  });
});
