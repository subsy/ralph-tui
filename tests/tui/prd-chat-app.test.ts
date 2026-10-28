/**
 * ABOUTME: Tests for PrdChatApp utility functions.
 * Tests ANSI code stripping and output formatting for clean PRD output.
 */

import { describe, test, expect } from 'bun:test';
import { 
  stripAnsiCodes,
  formatToolName,
  formatPath,
  formatCommand,
  formatError,
  formatPattern,
  formatUrl,
  segmentsToPlainText,
  formatErrorSegments,
  processAgentEvents
} from '../../src/plugins/agents/output-formatting.js';

describe('PrdChatApp utilities', () => {
  describe('stripAnsiCodes', () => {
    test('removes color codes from text', () => {
      const input = '\x1B[38;5;252m\x1B[1m### US-001: Title\x1B[0m\x1B[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('### US-001: Title');
    });

    test('removes multiple ANSI sequences', () => {
      const input = '\x1B[31mRed\x1B[0m \x1B[32mGreen\x1B[0m \x1B[34mBlue\x1B[0m';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Red Green Blue');
    });

    test('preserves text without ANSI codes', () => {
      const input = '### US-001: Simple Title\n\nDescription here.';
      const result = stripAnsiCodes(input);
      expect(result).toBe(input);
    });

    test('handles empty string', () => {
      expect(stripAnsiCodes('')).toBe('');
    });

    test('handles bold and reset codes', () => {
      const input = '\x1B[1mBold\x1B[0m Normal';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Bold Normal');
    });

    test('handles cursor movement codes', () => {
      const input = '\x1B[2KCleared line\x1B[1GStart';
      const result = stripAnsiCodes(input);
      expect(result).toBe('Cleared lineStart');
    });

    test('strips Kiro-style output formatting', () => {
      // Real example from Kiro output
      const input = `\x1B[38;5;252m\x1B[1m### US-001: Database Schema Setup\x1B[0m\x1B[0m
\x1B[1mDescription:\x1B[0m As a developer, I want to set up the database schema.

\x1B[1m**Acceptance Criteria:**\x1B[0m
- [ ] Create SQLite database file`;
      
      const result = stripAnsiCodes(input);
      expect(result).toContain('### US-001: Database Schema Setup');
      expect(result).toContain('Description:');
      expect(result).toContain('**Acceptance Criteria:**');
      expect(result).not.toContain('\x1B');
    });
  });

  describe('formatToolName', () => {
    test('formats tool name with styling', () => {
      const result = formatToolName('read_file');
      expect(result).toContain('read_file');
    });
  });

  describe('formatPath', () => {
    test('formats file path', () => {
      const result = formatPath('/src/index.ts');
      expect(result).toContain('/src/index.ts');
    });
  });

  describe('formatCommand', () => {
    test('formats shell command', () => {
      const result = formatCommand('npm install');
      expect(result).toContain('npm install');
    });
  });

  describe('formatError', () => {
    test('formats error message', () => {
      const result = formatError('Something went wrong');
      expect(result).toContain('Something went wrong');
    });
  });

  describe('formatPattern', () => {
    test('formats search pattern', () => {
      const result = formatPattern('*.ts');
      expect(result).toContain('*.ts');
    });
  });

  describe('formatUrl', () => {
    test('formats URL', () => {
      const result = formatUrl('https://example.com');
      expect(result).toContain('https://example.com');
    });
  });

  describe('segmentsToPlainText', () => {
    test('converts segments to plain text', () => {
      const segments = [
        { text: 'Hello ', color: 'red' as const },
        { text: 'World', color: 'blue' as const }
      ];
      const result = segmentsToPlainText(segments);
      expect(result).toBe('Hello World');
    });

    test('handles empty segments array', () => {
      const result = segmentsToPlainText([]);
      expect(result).toBe('');
    });
  });

  describe('formatErrorSegments', () => {
    test('formats error message as segments', () => {
      const result = formatErrorSegments('Something failed');
      expect(result).toHaveLength(3);
      expect(result[1].text).toContain('Something failed');
      expect(result[1].color).toBe('pink');
    });
  });

  describe('processAgentEvents', () => {
    test('processes text events', () => {
      const events = [{ type: 'text' as const, content: 'Hello world' }];
      const result = processAgentEvents(events);
      expect(result).toContain('Hello world');
    });

    test('processes error events', () => {
      const events = [{ type: 'error' as const, message: 'Test error' }];
      const result = processAgentEvents(events);
      expect(result).toContain('Test error');
    });
  });
});

// Test PRD questions module
import { getQuestionCount, getQuestionById } from '../../src/prd/questions.js';

describe('PRD questions', () => {
  test('getQuestionCount returns correct count', () => {
    const count = getQuestionCount();
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(5);
  });

  test('getQuestionById returns question for valid id', () => {
    const question = getQuestionById('users');
    expect(question).toBeDefined();
    expect(question?.id).toBe('users');
  });

  test('getQuestionById returns undefined for invalid id', () => {
    const question = getQuestionById('nonexistent');
    expect(question).toBeUndefined();
  });
});
