/**
 * ABOUTME: Tests for droid JSONL output parser.
 * Verifies parsing of droid's streaming JSON format including top-level
 * tool_call and tool_result events.
 */

import { describe, expect, test } from 'bun:test';
import {
  parseDroidJsonlLine,
  formatDroidEventForDisplay,
} from './outputParser.js';

describe('parseDroidJsonlLine', () => {
  test('parses top-level tool_call event', () => {
    const line = JSON.stringify({
      type: 'tool_call',
      id: 'call_123',
      toolName: 'Bash',
      parameters: { command: 'ls -la' },
    });
    const result = parseDroidJsonlLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.type).toBe('tool_call');
      expect(result.message.toolCalls).toHaveLength(1);
      expect(result.message.toolCalls![0].name).toBe('Bash');
      expect(result.message.toolCalls![0].id).toBe('call_123');
      expect(result.message.toolCalls![0].arguments).toEqual({ command: 'ls -la' });
    }
  });

  test('parses top-level tool_result event', () => {
    const line = JSON.stringify({
      type: 'tool_result',
      id: 'call_123',
      toolId: 'Bash',
      isError: false,
      value: 'total 48\ndrwxr-xr-x 1 user user 224 Jan 16 19:11 .',
    });
    const result = parseDroidJsonlLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.type).toBe('tool_result');
      expect(result.message.toolResults).toHaveLength(1);
      expect(result.message.toolResults![0].toolUseId).toBe('call_123');
      expect(result.message.toolResults![0].content).toContain('total 48');
      expect(result.message.toolResults![0].isError).toBe(false);
    }
  });

  test('parses message event with text', () => {
    const line = JSON.stringify({
      type: 'message',
      role: 'assistant',
      text: 'Hello, this is the response',
    });
    const result = parseDroidJsonlLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.type).toBe('message');
      expect(result.message.message).toBe('Hello, this is the response');
    }
  });

  test('parses completion event with usage', () => {
    const line = JSON.stringify({
      type: 'completion',
      finalText: 'Done!',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
      },
    });
    const result = parseDroidJsonlLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.type).toBe('completion');
      expect(result.message.result).toBe('Done!');
      expect(result.message.cost?.inputTokens).toBe(1000);
      expect(result.message.cost?.outputTokens).toBe(500);
      expect(result.message.cost?.cacheReadTokens).toBe(200);
    }
  });

  test('handles empty line', () => {
    const result = parseDroidJsonlLine('');
    expect(result.success).toBe(false);
  });

  test('handles invalid JSON', () => {
    const result = parseDroidJsonlLine('not json');
    expect(result.success).toBe(false);
  });

  test('strips ANSI escape codes', () => {
    const line = '\x1b[94m' + JSON.stringify({ type: 'message', text: 'test' }) + '\x1b[0m';
    const result = parseDroidJsonlLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.message).toBe('test');
    }
  });
});

describe('formatDroidEventForDisplay', () => {
  test('formats tool_call as bracketed tool name', () => {
    const result = parseDroidJsonlLine(JSON.stringify({
      type: 'tool_call',
      toolName: 'Glob',
      parameters: { pattern: '*.ts' },
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      const display = formatDroidEventForDisplay(result.message);
      expect(display).toContain('[Glob]');
      expect(display).toContain('pattern:');
      expect(display).toContain('*.ts');
    }
  });

  test('formats bash command with $ prefix', () => {
    const result = parseDroidJsonlLine(JSON.stringify({
      type: 'tool_call',
      toolName: 'Bash',
      parameters: { command: 'npm test' },
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      const display = formatDroidEventForDisplay(result.message);
      expect(display).toContain('[Bash]');
      expect(display).toContain('$ npm test');
    }
  });

  test('formats read with file path', () => {
    const result = parseDroidJsonlLine(JSON.stringify({
      type: 'tool_call',
      toolName: 'Read',
      parameters: { file_path: '/home/user/test.ts' },
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      const display = formatDroidEventForDisplay(result.message);
      expect(display).toContain('[Read]');
      expect(display).toContain('/home/user/test.ts');
    }
  });

  test('returns undefined for tool_result (intentionally skipped)', () => {
    const result = parseDroidJsonlLine(JSON.stringify({
      type: 'tool_result',
      id: 'call_123',
      value: 'some output',
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      const display = formatDroidEventForDisplay(result.message);
      // Tool results are skipped in display
      expect(display).toBeUndefined();
    }
  });

  test('returns undefined for user message (input echo)', () => {
    const result = parseDroidJsonlLine(JSON.stringify({
      type: 'message',
      role: 'user',
      text: 'user input',
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      const display = formatDroidEventForDisplay(result.message);
      // User messages are skipped
      expect(display).toBeUndefined();
    }
  });
});
