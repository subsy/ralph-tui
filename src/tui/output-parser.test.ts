/**
 * ABOUTME: Tests for TUI streaming output parser.
 * Verifies JSONL parsing, newline handling, and content extraction
 * for real-time agent output display.
 */

import { describe, expect, test } from 'bun:test';
import { StreamingOutputParser, parseAgentOutput } from './output-parser.js';

describe('StreamingOutputParser', () => {
  test('extracts plain text lines', () => {
    const parser = new StreamingOutputParser();
    parser.push('Hello world\n');
    expect(parser.getOutput()).toBe('Hello world\n');
  });

  test('buffers incomplete lines until newline', () => {
    const parser = new StreamingOutputParser();
    parser.push('Hello');
    expect(parser.getOutput()).toBe(''); // Buffered, no output yet
    parser.push(' world\n');
    expect(parser.getOutput()).toBe('Hello world\n');
  });

  test('strips trailing newlines from content before adding parser newline', () => {
    const parser = new StreamingOutputParser();
    // Simulate content that already has trailing newline (like from formatToolCall)
    parser.push('[Bash] $ ls\n\n'); // Content has double newline
    const output = parser.getOutput();
    // Should have single newline, not double
    expect(output).toBe('[Bash] $ ls\n');
  });

  test('handles multiple lines in single chunk', () => {
    const parser = new StreamingOutputParser();
    parser.push('line 1\nline 2\nline 3\n');
    expect(parser.getOutput()).toBe('line 1\nline 2\nline 3\n');
  });

  test('reset clears buffer and output', () => {
    const parser = new StreamingOutputParser();
    parser.push('some content\n');
    expect(parser.getOutput()).toBe('some content\n');
    parser.reset();
    expect(parser.getOutput()).toBe('');
  });

  test('parses JSONL assistant message with text', () => {
    const parser = new StreamingOutputParser();
    const jsonLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello from Claude' }] },
    });
    parser.push(jsonLine + '\n');
    expect(parser.getOutput()).toContain('Hello from Claude');
  });

  test('skips user/tool_result JSONL events', () => {
    const parser = new StreamingOutputParser();
    const userEvent = JSON.stringify({ type: 'user', content: 'should not appear' });
    parser.push(userEvent + '\n');
    expect(parser.getOutput()).toBe('');
  });

  test('skips system JSONL events', () => {
    const parser = new StreamingOutputParser();
    const systemEvent = JSON.stringify({ type: 'system', subtype: 'init' });
    parser.push(systemEvent + '\n');
    expect(parser.getOutput()).toBe('');
  });
});

describe('StreamingOutputParser with droid format', () => {
  test('parses droid tool_call events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'droid' });
    const toolCall = JSON.stringify({
      type: 'tool_call',
      toolName: 'Bash',
      parameters: { command: 'ls -la' },
    });
    parser.push(toolCall + '\n');
    const output = parser.getOutput();
    expect(output).toContain('[Bash]');
    expect(output).toContain('ls -la');
  });

  test('parses droid message events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'droid' });
    const message = JSON.stringify({
      type: 'message',
      role: 'assistant',
      text: 'Droid says hello',
    });
    parser.push(message + '\n');
    expect(parser.getOutput()).toContain('Droid says hello');
  });
});

describe('parseAgentOutput', () => {
  test('extracts result from Claude JSONL', () => {
    const rawOutput = JSON.stringify({
      type: 'result',
      result: 'Task completed successfully',
    });
    const result = parseAgentOutput(rawOutput);
    expect(result).toContain('Task completed successfully');
  });

  test('handles plain text output', () => {
    const rawOutput = 'Just some plain text output';
    const result = parseAgentOutput(rawOutput);
    expect(result).toBe('Just some plain text output');
  });

  test('returns empty string for empty input', () => {
    expect(parseAgentOutput('')).toBe('');
    expect(parseAgentOutput('   ')).toBe('');
  });

  test('strips ANSI codes from output', () => {
    const rawOutput = '\x1b[94mcolored text\x1b[0m';
    const result = parseAgentOutput(rawOutput);
    expect(result).toBe('colored text');
  });
});
