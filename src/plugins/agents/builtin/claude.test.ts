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

  test('returns undefined for plain-text output', () => {
    const plugin = new ClaudeAgentPlugin();

    expect(plugin.extractAgentText?.('Which database should I use?')).toBeUndefined();
  });

  test('extracts assistant text without tool-result content', () => {
    const plugin = new ClaudeAgentPlugin();
    const stdout = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Which database should I use?' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: '<promise>COMPLETE</promise>',
            },
          ],
        },
      }),
    ].join('\n');

    const text = plugin.extractAgentText?.(stdout);

    expect(text).toBe('Which database should I use?');
    expect(text).not.toContain('<promise>COMPLETE</promise>');
  });

  test('includes the final result message text', () => {
    const plugin = new ClaudeAgentPlugin();
    const stdout = JSON.stringify({
      type: 'result',
      result: 'Completed summary: <promise>COMPLETE</promise>',
    });

    expect(plugin.extractAgentText?.(stdout)).toBe(
      'Completed summary: <promise>COMPLETE</promise>'
    );
  });
});
