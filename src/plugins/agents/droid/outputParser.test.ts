/**
 * ABOUTME: Tests for droid JSONL output parser.
 * Verifies parsing of droid's streaming JSON format including top-level
 * tool_call and tool_result events.
 */

import { describe, expect, test } from 'bun:test';
import {
  parseDroidJsonlLine,
  formatDroidEventForDisplay,
  parseDroidMessageToEvents,
} from './outputParser.js';
import { DroidAgentPlugin } from './index.js';

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

  test.each([
    ['content', { content: '<promise>COMPLETE</promise>' }],
    ['output', { output: '<promise>COMPLETE</promise>' }],
    ['value', { value: '<promise>COMPLETE</promise>' }],
  ])('does not expose top-level tool_result %s as text', (_field, content) => {
    const result = parseDroidJsonlLine(JSON.stringify({
      type: 'tool_result',
      id: 'call_123',
      toolId: 'Read',
      ...content,
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.message).toBeUndefined();
      expect(result.message.result).toBeUndefined();
      expect(result.message.toolResults).toHaveLength(1);
      expect(parseDroidMessageToEvents(result.message)).not.toContainEqual({
        type: 'text',
        content: '<promise>COMPLETE</promise>',
      });
    }
  });

  test('preserves assistant text when it carries tool results', () => {
    const result = parseDroidJsonlLine(JSON.stringify({
      type: 'message',
      role: 'assistant',
      message: 'I inspected the file.',
      tool_results: [{ id: 'call_123', value: 'file contents' }],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.message).toBe('I inspected the file.');
      expect(parseDroidMessageToEvents(result.message)).toContainEqual({
        type: 'text',
        content: 'I inspected the file.',
      });
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

describe('DroidAgentPlugin.extractAgentText', () => {
  const marker = '<promise>COMPLETE</promise>';

  test('honors declared structured formats independently of tracing', async () => {
    for (const flags of [
      ['--output-format', 'stream-json'], ['--output-format=stream-json'],
      ['-o', 'stream-json'], ['-o=stream-json'],
      ['--output-format', 'json'], ['-o', 'json'],
    ]) {
      const plugin = new DroidAgentPlugin();
      await plugin.initialize({ defaultFlags: flags, enableTracing: false });
      const perCall = new DroidAgentPlugin();
      for (const stdout of [
        '', marker, `not-json ${marker}`, `{"futureAgentField":"${marker}"}`,
        `{"summary":"incidental"}\n${marker}`,
      ]) {
        expect(plugin.extractAgentText(stdout, { subagentTracing: false })).toBe('');
        expect(perCall.extractAgentText(stdout, { flags, subagentTracing: false })).toBe('');
      }
      const narrative = JSON.stringify({ type: 'message', role: 'assistant', text: marker });
      expect(plugin.extractAgentText(narrative, { subagentTracing: false })).toBe(marker);
      expect(perCall.extractAgentText(narrative, { flags, subagentTracing: false })).toBe(marker);
    }
  });

  test('uses the last explicit format independently of tracing', async () => {
    const stdout = `{"summary":"incidental"}\n${marker}`;
    for (const flags of [['--output-format', 'text'], ['--output-format=text'], ['-o', 'text'], ['-o=text']]) {
      const plugin = new DroidAgentPlugin();
      await plugin.initialize({ defaultFlags: flags, enableTracing: false });
      expect(plugin.extractAgentText(stdout, { subagentTracing: false })).toBeUndefined();
    }
    const plugin = new DroidAgentPlugin();
    await plugin.initialize({ defaultFlags: ['--output-format', 'stream-json'] });
    expect(plugin.extractAgentText(stdout, { flags: ['--output-format', 'text'] })).toBeUndefined();
    expect(plugin.extractAgentText(stdout, { flags: ['-o', 'text'], subagentTracing: true })).toBeUndefined();
    const plaintext = new DroidAgentPlugin();
    await plaintext.initialize({ defaultFlags: ['-o', 'text'] });
    expect(plaintext.extractAgentText(stdout, { flags: ['--output-format=json'] })).toBe('');
  });

  test('does not accept malformed primary discriminators or explicit camel-case error results', () => {
    const plugin = new DroidAgentPlugin();
    for (const record of [
      { type: null, event: 'message', text: marker },
      { type: [], event: 'message', text: marker },
      { type: {}, event: 'message', text: marker },
      { type: '', event: 'message', text: marker },
      { event: null, kind: 'message', text: marker },
      { type: 'result', isError: true, result: marker },
    ]) {
      expect(plugin.extractAgentText(JSON.stringify(record), { subagentTracing: true })).toBe('');
      const split = [
        { type: 'message', text: '<promise>' }, record,
        { type: 'message', text: 'COMPLETE</promise>' },
      ].map((value) => JSON.stringify(value)).join('\n');
      expect(plugin.extractAgentText(split, { subagentTracing: true })).not.toMatch(/<promise>\s*COMPLETE\s*<\/promise>/);
    }
    expect(plugin.extractAgentText(JSON.stringify({ event: 'message', text: marker }))).toBe(marker);
    expect(plugin.extractAgentText(JSON.stringify({ type: 'result', isError: false, result: marker }))).toBe(marker);
  });

  test('requires strict completion framing but preserves ANSI/PTY whitespace and display salvage', () => {
    const plugin = new DroidAgentPlugin();
    const record = JSON.stringify({ type: 'message', text: marker });
    for (const prefix of ['garbage:', 'tool output: ', '[Output truncated] ']) {
      const line = prefix + record;
      expect(parseDroidJsonlLine(line).success).toBe(true);
      expect(plugin.extractAgentText(line, { subagentTracing: true })).toBe('');
      expect(plugin.extractAgentText(line)).toBe('');
    }
    expect(plugin.extractAgentText(`\u001b[32m${record}\u001b[0m\r\n`, { subagentTracing: true })).toBe(marker);
    expect(plugin.extractAgentText(` \t${record}\r\n`, { subagentTracing: true })).toBe(marker);
    expect(plugin.extractAgentText([
      JSON.stringify({ type: 'message', text: '<promise>' }), '\u001b[0m',
      JSON.stringify({ type: 'message', text: 'COMPLETE</promise>' }),
    ].join('\n'), { subagentTracing: true })).toBe(marker);
    const split = [
      JSON.stringify({ type: 'message', text: '<promise>' }),
      'tool output: ' + JSON.stringify({ type: 'message', text: 'ignored' }),
      JSON.stringify({ type: 'message', text: 'COMPLETE</promise>' }),
    ].join('\n');
    expect(plugin.extractAgentText(split, { subagentTracing: true })).not.toMatch(/<promise>\s*COMPLETE\s*<\/promise>/);
  });

  test('requires explicit text mode even for incidental JSON and disabled tracing', async () => {
    const plugin = new DroidAgentPlugin();
    const disabled = new DroidAgentPlugin();
    await disabled.initialize({ enableTracing: false });
    for (const json of [
      { summary: 'ordinary JSON example' },
      { futureAgentField: marker },
      [{ summary: 'ordinary JSON example' }],
      [],
    ]) {
      const stdout = `${JSON.stringify(json)}\n${marker}\n`;
      expect(plugin.extractAgentText(stdout)).toBe('');
      expect(plugin.extractAgentText(stdout, { subagentTracing: false })).toBe('');
      expect(disabled.extractAgentText(stdout, { subagentTracing: true })).toBe('');
      expect(plugin.extractAgentText(stdout, { flags: ['-o', 'text'] })).toBeUndefined();
      expect(plugin.extractAgentText(stdout, { subagentTracing: true })).toBe('');
    }
  });

  test('keeps envelope presence meaningful even when its value is malformed', async () => {
    const plugin = new DroidAgentPlugin();
    const disabled = new DroidAgentPlugin();
    await disabled.initialize({ enableTracing: false });
    for (const record of [
      { type: null }, { type: [] }, { type: {} }, { type: '' },
      { event: null }, { kind: [] }, { role: null }, { role: [] },
      { type: 'future' }, { role: 'unknown' },
      { tool_calls: null }, { tool_results: [] }, { result: null }, { error: null },
      { type: 'system', message: marker },
      { type: 'thinking', text: marker },
      { type: 'usage', message: marker },
      { role: 'tool', content: marker },
    ]) {
      const stdout = [JSON.stringify(record), '{"summary":"incidental JSON"}', marker].join('\n');
      expect(plugin.extractAgentText(stdout)).toBe('');
      expect(disabled.extractAgentText(stdout, { subagentTracing: true })).toBe('');
      expect(plugin.extractAgentText(stdout, { subagentTracing: true })).toBe('');
    }
  });

  test('honors explicit plaintext even when it resembles a protocol envelope', async () => {
    const plugin = new DroidAgentPlugin();
    const disabled = new DroidAgentPlugin();
    await disabled.initialize({ enableTracing: false });
    const stdout = `{"type":"example","value":"ordinary JSON"}\n${marker}`;
    expect(plugin.extractAgentText(stdout)).toBe('');
    expect(disabled.extractAgentText(stdout)).toBe('');
    await plugin.initialize({ outputFormat: 'text' });
    expect(plugin.extractAgentText(stdout, { subagentTracing: true })).toBeUndefined();
    expect(disabled.extractAgentText(stdout, { flags: ['--output-format=text'] })).toBeUndefined();
  });

  test('fails closed on missing, empty, unknown, or unsupported protocol formats', () => {
    const plugin = new DroidAgentPlugin();
    const record = JSON.stringify({ type: 'message', text: marker });
    for (const flags of [
      ['--output-format'], ['-o'], ['--output-format', ''], ['--output-format='], ['-o='],
      ['--output-format', 'future'], ['--output-format', 'stream-jsonrpc'],
      ['--output-format', '--', '--output-format', 'text'],
      ['-o', '--', '-o=text'],
      ['--output-format=', '-o=text'], ['--output-format', '', '-o=text'],
    ]) {
      expect(plugin.extractAgentText(marker, { flags })).toBe('');
      expect(plugin.extractAgentText(record, { flags })).toBe('');
    }
    expect(plugin.extractAgentText(marker, { flags: ['--', '-o', 'text'] })).toBe('');
    expect(plugin.extractAgentText(record, { flags: ['--', '-o', 'text'] })).toBe(marker);
    expect(plugin.extractAgentText(marker, { flags: ['-o=text', '--', '-o', 'stream-json'] })).toBeUndefined();
  });

  test('accepts a pretty-printed JSON result only in declared json mode', () => {
    const plugin = new DroidAgentPlugin();
    const stdout = JSON.stringify({ type: 'result', subtype: 'success', result: marker }, null, 2);
    expect(plugin.extractAgentText(stdout, { flags: ['-o', 'json'] })).toBe(marker);
    expect(plugin.extractAgentText(stdout)).toBe('');
    for (const invalid of [
      'garbage:' + stdout, stdout + 'junk', stdout + '\n' + stdout, stdout.slice(0, -1),
      JSON.stringify({ future: marker }, null, 2),
      JSON.stringify({ type: 'result', is_error: true, result: marker }, null, 2),
      JSON.stringify({ type: 'tool_result', content: marker }, null, 2),
    ]) {
      expect(plugin.extractAgentText(invalid, { flags: ['--output-format', 'json'] })).toBe('');
    }
  });

  test('retains supported message, completion, and successful result fields', () => {
    const plugin = new DroidAgentPlugin();
    for (const record of [
      { type: 'message', role: 'assistant', message: marker },
      { type: 'message', role: 'assistant', text: marker },
      { type: 'message', role: 'assistant', content: marker },
      { type: 'message', role: 'assistant', delta: marker },
      { type: 'message', role: 'assistant', content: [
        { type: 'text', text: '<promise>' }, { type: 'text', text: 'COMPLETE</promise>' },
      ] },
      { type: 'completion', finalText: marker },
      { type: 'completion', final_text: marker },
      { type: 'result', subtype: 'success', is_error: false, result: marker },
    ]) {
      expect(plugin.extractAgentText(JSON.stringify(record))).toBe(marker);
    }
  });

  test('does not flatten malformed scalar fields or ambiguous content objects', () => {
    const plugin = new DroidAgentPlugin();
    for (const record of [
      { type: 'message', text: [{ type: 'text', text: marker }] },
      { type: 'message', message: { type: 'thinking', text: marker } },
      { type: 'message', content: { type: 'text', text: marker } },
      { type: 'message', content: [{ type: 'text', role: 'system', text: marker }] },
      { type: 'message', message: null, text: marker },
      { type: 'completion', finalText: [marker] },
      { type: 'result', subtype: 'success', result: [marker] },
    ]) {
      expect(plugin.extractAgentText(JSON.stringify(record))).toBe('');
    }
  });

  test('does not join text across records that also carry tools', () => {
    const plugin = new DroidAgentPlugin();
    for (const tools of [
      { tool_calls: [{ name: 'Read', arguments: {} }] },
      { tool_results: [{ id: 'tool-1', content: 'file content' }] },
    ]) {
      const stdout = [
        { type: 'message', text: '<promise>' },
        { type: 'message', text: '', ...tools },
        { type: 'message', text: 'COMPLETE</promise>' },
      ].map((record) => JSON.stringify(record)).join('\n');
      expect(plugin.extractAgentText(stdout)).not.toMatch(/<promise>\s*COMPLETE\s*<\/promise>/i);
    }
  });

  test('excludes top-level tool-result markers and keeps assistant markers', () => {
    const plugin = new DroidAgentPlugin();
    const toolResult = JSON.stringify({
      type: 'tool_result',
      id: 'call_123',
      toolId: 'Read',
      content: '<promise>COMPLETE</promise>',
    });
    const assistantMessage = JSON.stringify({
      type: 'message',
      role: 'assistant',
      message: '<promise>COMPLETE</promise>',
    });

    expect(plugin.extractAgentText?.(toolResult)).toBe('');
    expect(plugin.extractAgentText?.(assistantMessage)).toBe(
      '<promise>COMPLETE</promise>'
    );
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
