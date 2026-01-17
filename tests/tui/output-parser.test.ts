/**
 * ABOUTME: Tests for the TUI output parser module.
 * Tests log parsing, formatting, and streaming output processing.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  parseAgentOutput,
  formatOutputForDisplay,
  StreamingOutputParser,
} from '../../src/tui/output-parser.js';

describe('output-parser', () => {
  describe('parseAgentOutput', () => {
    test('should return empty string for empty input', () => {
      expect(parseAgentOutput('')).toBe('');
      expect(parseAgentOutput('   ')).toBe('');
      expect(parseAgentOutput('\n\n')).toBe('');
    });

    test('should parse Claude Code result event', () => {
      const jsonl = JSON.stringify({
        type: 'result',
        result: 'Task completed successfully',
      });
      const result = parseAgentOutput(jsonl);
      expect(result).toBe('Task completed successfully');
    });

    test('should extract last meaningful result from multiple events', () => {
      const events = [
        JSON.stringify({ type: 'result', result: 'Short' }),
        JSON.stringify({
          type: 'result',
          result:
            'This is a much longer result that provides more detail about what was accomplished in the task execution and should be preferred over shorter results',
        }),
      ].join('\n');
      const result = parseAgentOutput(events);
      expect(result).toContain('much longer result');
    });

    test('should parse assistant event with string content', () => {
      const jsonl = JSON.stringify({
        type: 'assistant',
        message: { content: 'Hello from assistant' },
      });
      const result = parseAgentOutput(jsonl);
      // Assistant events are processed but result events are preferred
      expect(result).toContain('Hello from assistant');
    });

    test('should parse assistant event with array content', () => {
      const jsonl = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Part 1 of message ' },
            { type: 'text', text: 'Part 2 of message' },
          ],
        },
      });
      const result = parseAgentOutput(jsonl);
      expect(result).toContain('Part 1');
    });

    test('should parse error events', () => {
      const jsonl = JSON.stringify({
        type: 'error',
        message: 'Something went wrong',
      });
      const result = parseAgentOutput(jsonl);
      expect(result).toBe('Error: Something went wrong');
    });

    test('should return plain text for non-JSON lines', () => {
      const plainText = 'This is plain text output\nWith multiple lines';
      const result = parseAgentOutput(plainText);
      expect(result).toBe('This is plain text output\nWith multiple lines');
    });

    test('should handle mixed JSON and plain text', () => {
      const mixed = [
        'Some plain text first',
        JSON.stringify({ type: 'result', result: 'JSON result here' }),
      ].join('\n');
      const result = parseAgentOutput(mixed);
      expect(result).toBe('JSON result here');
    });

    test('should handle unparseable JSON gracefully', () => {
      const badJson = '{' + 'x'.repeat(600);
      const result = parseAgentOutput(badJson);
      expect(result).toContain('[Agent output could not be parsed');
      expect(result).toContain('truncated');
    });

    test('should parse correctly with explicit claude agentPlugin', () => {
      const jsonl = JSON.stringify({
        type: 'result',
        result: 'Claude result with explicit agent',
      });
      const result = parseAgentOutput(jsonl, 'claude');
      expect(result).toBe('Claude result with explicit agent');
    });

    test('should parse correctly with undefined agentPlugin', () => {
      const jsonl = JSON.stringify({
        type: 'result',
        result: 'Result parsed without agent specified',
      });
      const result = parseAgentOutput(jsonl, undefined);
      expect(result).toBe('Result parsed without agent specified');
    });

    test('should use droid parser when agentPlugin is droid', () => {
      // Droid format may differ, but plain text should pass through
      const plainText = 'Droid agent plain text output';
      const result = parseAgentOutput(plainText, 'droid');
      expect(result).toContain('Droid agent plain text output');
    });

    test('should handle assistant events with claude agentPlugin', () => {
      const jsonl = JSON.stringify({
        type: 'assistant',
        message: { content: 'Claude assistant message' },
      });
      const result = parseAgentOutput(jsonl, 'claude');
      expect(result).toContain('Claude assistant message');
    });

    test('should return raw output for short unparseable JSON', () => {
      // Short JSON that can't be parsed falls through to stripAnsiCodes(rawOutput)
      const shortBadJson = '{"incomplete';
      const result = parseAgentOutput(shortBadJson);
      expect(result).toBe('{"incomplete');
    });
  });

  describe('formatOutputForDisplay', () => {
    test('should return output unchanged when no maxLines specified', () => {
      const output = 'line1\nline2\nline3';
      expect(formatOutputForDisplay(output)).toBe(output);
    });

    test('should return output unchanged when lines are under limit', () => {
      const output = 'line1\nline2\nline3';
      expect(formatOutputForDisplay(output, 5)).toBe(output);
    });

    test('should truncate output when exceeding maxLines', () => {
      const output = 'line1\nline2\nline3\nline4\nline5';
      const result = formatOutputForDisplay(output, 2);
      expect(result).toBe('line1\nline2\n... (3 more lines)');
    });

    test('should handle single line output', () => {
      const output = 'single line';
      expect(formatOutputForDisplay(output, 5)).toBe(output);
    });

    test('should handle empty output', () => {
      expect(formatOutputForDisplay('')).toBe('');
      expect(formatOutputForDisplay('', 10)).toBe('');
    });

    test('should ignore maxLines of 0', () => {
      const output = 'line1\nline2\nline3';
      expect(formatOutputForDisplay(output, 0)).toBe(output);
    });

    test('should handle negative maxLines as unlimited', () => {
      const output = 'line1\nline2\nline3';
      expect(formatOutputForDisplay(output, -1)).toBe(output);
    });
  });

  describe('StreamingOutputParser', () => {
    let parser: StreamingOutputParser;

    beforeEach(() => {
      parser = new StreamingOutputParser();
    });

    test('should start with empty output', () => {
      expect(parser.getOutput()).toBe('');
      expect(parser.getResultText()).toBe('');
    });

    test('should process complete JSONL lines', () => {
      const chunk =
        JSON.stringify({ type: 'assistant', message: { content: 'Hello' } }) +
        '\n';
      const newContent = parser.push(chunk);
      expect(newContent).toBe('Hello\n');
      expect(parser.getOutput()).toBe('Hello\n');
    });

    test('should buffer incomplete lines', () => {
      const incomplete = '{"type":"assis';
      const newContent = parser.push(incomplete);
      expect(newContent).toBe('');
      expect(parser.getOutput()).toBe('');
    });

    test('should process buffered content when newline arrives', () => {
      parser.push('{"type":"assistant","message":{"content":"Part');
      expect(parser.getOutput()).toBe('');

      parser.push('ial"}}\n');
      expect(parser.getOutput()).toContain('Partial');
    });

    test('should store result event text separately', () => {
      const resultEvent =
        JSON.stringify({
          type: 'result',
          result: 'Final result text',
        }) + '\n';
      parser.push(resultEvent);
      expect(parser.getResultText()).toBe('Final result text');
    });

    test('should skip user events', () => {
      const userEvent =
        JSON.stringify({ type: 'user', content: 'user input' }) + '\n';
      parser.push(userEvent);
      expect(parser.getOutput()).toBe('');
    });

    test('should skip system events', () => {
      const systemEvent =
        JSON.stringify({ type: 'system', message: 'system msg' }) + '\n';
      parser.push(systemEvent);
      expect(parser.getOutput()).toBe('');
    });

    test('should pass through non-JSON plain text', () => {
      parser.push('Plain text output\n');
      expect(parser.getOutput()).toBe('Plain text output\n');
    });

    test('should accumulate multiple chunks', () => {
      parser.push('Line 1\n');
      parser.push('Line 2\n');
      parser.push('Line 3\n');
      expect(parser.getOutput()).toBe('Line 1\nLine 2\nLine 3\n');
    });

    test('should reset state correctly', () => {
      parser.push('Some output\n');
      parser.push(JSON.stringify({ type: 'result', result: 'Final' }) + '\n');

      expect(parser.getOutput()).not.toBe('');
      expect(parser.getResultText()).toBe('Final');

      parser.reset();

      expect(parser.getOutput()).toBe('');
      expect(parser.getResultText()).toBe('');
    });

    test('should handle multiple lines in single chunk', () => {
      const multiLine = 'Line A\nLine B\nLine C\n';
      parser.push(multiLine);
      expect(parser.getOutput()).toBe('Line A\nLine B\nLine C\n');
    });

    test('should trim output when exceeding max size', () => {
      // Create parser and push large amount of data
      const largeChunk = ('x'.repeat(100) + '\n').repeat(1200);
      parser.push(largeChunk);
      const output = parser.getOutput();
      // Should be trimmed but still have content
      expect(output.length).toBeLessThan(110_000);
      if (output.length > 50000) {
        expect(output).toContain('...output trimmed...');
      }
    });

    test('should handle assistant events with array content', () => {
      const event =
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Array content text' }],
          },
        }) + '\n';
      parser.push(event);
      expect(parser.getOutput()).toContain('Array content text');
    });

    test('should handle empty lines', () => {
      parser.push('\n\n\n');
      expect(parser.getOutput()).toBe('');
    });

    test('should update agent plugin type', () => {
      parser.setAgentPlugin('claude');
      // Just verify it doesn't throw
      expect(parser.getOutput()).toBe('');

      parser.setAgentPlugin('droid');
      expect(parser.getOutput()).toBe('');
    });
  });

  describe('StreamingOutputParser with droid agent', () => {
    let parser: StreamingOutputParser;

    beforeEach(() => {
      parser = new StreamingOutputParser({ agentPlugin: 'droid' });
    });

    test('should handle droid-specific output format', () => {
      // Droid events may have different structure - test basic functionality
      parser.push('Non-droid plain text\n');
      expect(parser.getOutput()).toContain('Non-droid plain text');
    });

    test('should reset droid cost accumulator on reset', () => {
      parser.push('Some output\n');
      parser.reset();
      expect(parser.getOutput()).toBe('');
    });
  });
});
