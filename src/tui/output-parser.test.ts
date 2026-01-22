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

describe('StreamingOutputParser with opencode format', () => {
  test('parses opencode text events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const textEvent = JSON.stringify({
      type: 'text',
      part: { text: 'OpenCode says hello' },
    });
    parser.push(textEvent + '\n');
    expect(parser.getOutput()).toContain('OpenCode says hello');
  });

  test('parses opencode tool_use events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const toolUse = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'Bash',
        state: { input: { command: 'ls -la', timeout: 5000 } },
      },
    });
    parser.push(toolUse + '\n');
    const output = parser.getOutput();
    expect(output).toContain('[Tool: Bash]');
    expect(output).toContain('command=ls -la');
  });

  test('parses opencode tool_use with name field', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const toolUse = JSON.stringify({
      type: 'tool_use',
      part: { name: 'Read' },
    });
    parser.push(toolUse + '\n');
    expect(parser.getOutput()).toContain('[Tool: Read]');
  });

  test('shows opencode tool_result errors', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const toolResult = JSON.stringify({
      type: 'tool_result',
      part: {
        state: { isError: true, error: 'File not found' },
      },
    });
    parser.push(toolResult + '\n');
    expect(parser.getOutput()).toContain('[Tool Error]');
    expect(parser.getOutput()).toContain('File not found');
  });

  test('shows opencode tool_result errors with is_error field', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const toolResult = JSON.stringify({
      type: 'tool_result',
      part: {
        state: { is_error: true, content: 'Permission denied' },
      },
    });
    parser.push(toolResult + '\n');
    expect(parser.getOutput()).toContain('[Tool Error]');
    expect(parser.getOutput()).toContain('Permission denied');
  });

  test('hides successful opencode tool_result', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const toolResult = JSON.stringify({
      type: 'tool_result',
      part: {
        state: { isError: false, content: 'Success content' },
      },
    });
    parser.push(toolResult + '\n');
    // Successful results should not be displayed
    expect(parser.getOutput()).toBe('');
  });

  test('parses opencode error events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const errorEvent = JSON.stringify({
      type: 'error',
      error: { message: 'Something went wrong' },
    });
    parser.push(errorEvent + '\n');
    expect(parser.getOutput()).toContain('Error: Something went wrong');
  });

  test('hides opencode step_start events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const stepStart = JSON.stringify({ type: 'step_start' });
    parser.push(stepStart + '\n');
    expect(parser.getOutput()).toBe('');
  });

  test('hides opencode step_finish events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const stepFinish = JSON.stringify({ type: 'step_finish' });
    parser.push(stepFinish + '\n');
    expect(parser.getOutput()).toBe('');
  });

  test('falls back to generic parsing for non-opencode JSON', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'opencode' });
    const genericJson = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Generic message' }] },
    });
    parser.push(genericJson + '\n');
    expect(parser.getOutput()).toContain('Generic message');
  });
});

describe('StreamingOutputParser with codex format', () => {
  test('parses codex item.completed agent_message events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Hello from Codex' },
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('Hello from Codex');
  });

  test('parses codex item.started command_execution events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.started',
      item: { type: 'command_execution', command: 'ls -la' },
    });
    parser.push(event + '\n');
    const output = parser.getOutput();
    expect(output).toContain('[Shell]');
    expect(output).toContain('ls -la');
  });

  test('shows codex command_execution errors', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'invalid-command',
        exit_code: 1,
        aggregated_output: 'command not found',
      },
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('[Shell Error]');
    expect(parser.getOutput()).toContain('command not found');
  });

  test('parses codex file operation events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.started',
      item: { type: 'file_edit', file_path: '/path/to/file.ts' },
    });
    parser.push(event + '\n');
    const output = parser.getOutput();
    expect(output).toContain('[file_edit]');
    expect(output).toContain('/path/to/file.ts');
  });

  test('parses codex file_read events with path field', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.started',
      item: { type: 'file_read', path: '/other/file.ts' },
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('[file_read]');
    expect(parser.getOutput()).toContain('/other/file.ts');
  });

  test('parses codex error events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'error',
      error: { message: 'API error occurred' },
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('Error: API error occurred');
  });

  test('parses codex error events with string error', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'error',
      error: 'Simple string error',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('Error: Simple string error');
  });

  test('skips codex lifecycle events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const events = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc123' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100 } }),
    ];
    for (const event of events) {
      parser.push(event + '\n');
    }
    expect(parser.getOutput()).toBe('');
  });

  test('skips item.completed for command_execution with exit_code 0', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.completed',
      item: { type: 'command_execution', exit_code: 0 },
    });
    parser.push(event + '\n');
    // Successful command completion should not produce output
    expect(parser.getOutput()).toBe('');
  });

  test('skips item.completed for file operations', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.completed',
      item: { type: 'file_edit', file_path: '/path/to/file.ts' },
    });
    parser.push(event + '\n');
    // Completed file operations should not produce output
    expect(parser.getOutput()).toBe('');
  });

  test('falls back to generic parsing for non-codex JSON', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const genericJson = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Generic message' }] },
    });
    parser.push(genericJson + '\n');
    expect(parser.getOutput()).toContain('Generic message');
  });

  test('returns cyan colored segments for command_execution', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'item.started',
      item: { type: 'command_execution', command: 'pwd' },
    });
    parser.push(event + '\n');
    const segments = parser.getSegments();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.color).toBe('cyan');
  });

  test('returns yellow colored segments for errors', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'codex' });
    const event = JSON.stringify({
      type: 'error',
      error: 'Test error',
    });
    parser.push(event + '\n');
    const segments = parser.getSegments();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.color).toBe('yellow');
  });
});

describe('StreamingOutputParser with gemini format', () => {
  test('parses gemini assistant message events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: 'Hello from Gemini',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('Hello from Gemini');
  });

  test('skips gemini user message events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'message',
      role: 'user',
      content: 'User input should not appear',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toBe('');
  });

  test('parses gemini tool_use events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'tool_use',
      tool_name: 'Bash',
      parameters: { command: 'ls -la' },
    });
    parser.push(event + '\n');
    const output = parser.getOutput();
    expect(output).toContain('[Tool: Bash]');
    expect(output).toContain('command=ls -la');
  });

  test('parses gemini tool_use with name field', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'tool_use',
      name: 'Read',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('[Tool: Read]');
  });

  test('parses gemini tool_use with arguments field', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'tool_use',
      tool_name: 'Write',
      arguments: { path: '/foo/bar.ts' },
    });
    parser.push(event + '\n');
    const output = parser.getOutput();
    expect(output).toContain('[Tool: Write]');
    expect(output).toContain('path=/foo/bar.ts');
  });

  test('shows gemini tool_result errors with is_error', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'tool_result',
      is_error: true,
      error: 'File not found',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('[Tool Error]');
    expect(parser.getOutput()).toContain('File not found');
  });

  test('shows gemini tool_result errors with status', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'tool_result',
      status: 'error',
      error: { message: 'Permission denied' },
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('[Tool Error]');
    expect(parser.getOutput()).toContain('Permission denied');
  });

  test('hides successful gemini tool_result', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'tool_result',
      is_error: false,
      status: 'success',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toBe('');
  });

  test('parses gemini error events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'error',
      error: { message: 'API limit exceeded' },
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('Error: API limit exceeded');
  });

  test('parses gemini error events with string error', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'error',
      error: 'Simple error message',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toContain('Error: Simple error message');
  });

  test('skips gemini init events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'init',
      session_id: 'abc123',
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toBe('');
  });

  test('skips gemini result/stats events', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'result',
      stats: { total_tokens: 1000, input_tokens: 500, output_tokens: 500 },
    });
    parser.push(event + '\n');
    expect(parser.getOutput()).toBe('');
  });

  test('falls back to generic parsing for non-gemini JSON', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const genericJson = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Generic message' }] },
    });
    parser.push(genericJson + '\n');
    expect(parser.getOutput()).toContain('Generic message');
  });

  test('returns cyan colored segments for tool_use', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'tool_use',
      name: 'Bash',
    });
    parser.push(event + '\n');
    const segments = parser.getSegments();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.color).toBe('cyan');
  });

  test('returns yellow colored segments for errors', () => {
    const parser = new StreamingOutputParser({ agentPlugin: 'gemini' });
    const event = JSON.stringify({
      type: 'error',
      error: 'Test error',
    });
    parser.push(event + '\n');
    const segments = parser.getSegments();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.color).toBe('yellow');
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

  test('parses opencode JSONL output', () => {
    const lines = [
      JSON.stringify({ type: 'text', part: { text: 'Hello from OpenCode' } }),
      JSON.stringify({ type: 'tool_use', part: { tool: 'Bash', state: { input: { command: 'pwd' } } } }),
      JSON.stringify({ type: 'tool_result', part: { state: { isError: false } } }),
    ].join('\n');
    const result = parseAgentOutput(lines, 'opencode');
    expect(result).toContain('Hello from OpenCode');
    expect(result).toContain('[Tool: Bash]');
    // Successful tool results should not appear
    expect(result).not.toContain('Success');
  });

  test('parses opencode error in JSONL output', () => {
    const lines = [
      JSON.stringify({ type: 'text', part: { text: 'Starting' } }),
      JSON.stringify({ type: 'error', error: { message: 'API limit reached' } }),
    ].join('\n');
    const result = parseAgentOutput(lines, 'opencode');
    expect(result).toContain('Starting');
    expect(result).toContain('Error: API limit reached');
  });

  test('parses codex JSONL output', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello from Codex' } }),
      JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'pwd' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100 } }),
    ].join('\n');
    const result = parseAgentOutput(lines, 'codex');
    expect(result).toContain('Hello from Codex');
    expect(result).toContain('[Shell] pwd');
    // Lifecycle events should not appear
    expect(result).not.toContain('thread.started');
    expect(result).not.toContain('turn.completed');
  });

  test('parses codex error in JSONL output', () => {
    const lines = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Starting' } }),
      JSON.stringify({ type: 'error', error: { message: 'Rate limit exceeded' } }),
    ].join('\n');
    const result = parseAgentOutput(lines, 'codex');
    expect(result).toContain('Starting');
    expect(result).toContain('Error: Rate limit exceeded');
  });

  test('parses gemini JSONL output', () => {
    const lines = [
      JSON.stringify({ type: 'init', session_id: 'xyz' }),
      JSON.stringify({ type: 'message', role: 'user', content: 'User input' }),
      JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello from Gemini' }),
      JSON.stringify({ type: 'tool_use', tool_name: 'Bash', parameters: { command: 'ls' } }),
      JSON.stringify({ type: 'result', stats: { total_tokens: 500 } }),
    ].join('\n');
    const result = parseAgentOutput(lines, 'gemini');
    expect(result).toContain('Hello from Gemini');
    expect(result).toContain('[Tool: Bash]');
    // User messages and init/stats should not appear
    expect(result).not.toContain('User input');
    expect(result).not.toContain('session_id');
  });

  test('parses gemini error in JSONL output', () => {
    const lines = [
      JSON.stringify({ type: 'message', role: 'assistant', content: 'Working' }),
      JSON.stringify({ type: 'error', error: 'Something went wrong' }),
    ].join('\n');
    const result = parseAgentOutput(lines, 'gemini');
    expect(result).toContain('Working');
    expect(result).toContain('Error: Something went wrong');
  });
});
