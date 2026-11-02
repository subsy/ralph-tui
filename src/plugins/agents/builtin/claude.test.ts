/**
 * ABOUTME: Tests for the Claude Code agent plugin.
 * Verifies model enumeration used by the agent/model picker.
 */

import { describe, expect, test } from 'bun:test';
import { ClaudeAgentPlugin } from './claude.js';

describe('ClaudeAgentPlugin', () => {
  test('lists known Claude model aliases', () => {
    const plugin = new ClaudeAgentPlugin();

    expect(plugin.listModels()).toEqual(['sonnet', 'opus', 'haiku']);
  });
});
