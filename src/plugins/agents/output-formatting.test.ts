/**
 * ABOUTME: Tests for shared output formatting utilities.
 * Verifies tool call formatting, command parsing, and path handling.
 */

import { describe, expect, test } from 'bun:test';
import {
  COLORS,
  formatToolName,
  formatPath,
  formatCommand,
  formatError,
  formatPattern,
  formatUrl,
  formatToolCall,
} from './output-formatting.js';

describe('COLORS', () => {
  test('all color values are ANSI escape codes', () => {
    // Colors are ANSI escape sequences for terminal formatting
    expect(COLORS.blue).toMatch(/^\x1b\[\d+m$/);
    expect(COLORS.purple).toMatch(/^\x1b\[\d+m$/);
    expect(COLORS.cyan).toMatch(/^\x1b\[\d+m$/);
    expect(COLORS.green).toMatch(/^\x1b\[\d+m$/);
    expect(COLORS.yellow).toMatch(/^\x1b\[\d+m$/);
    expect(COLORS.pink).toMatch(/^\x1b\[\d+m$/);
    expect(COLORS.muted).toMatch(/^\x1b\[\d+m$/);
    expect(COLORS.reset).toBe('\x1b[0m');
  });
});

describe('formatToolName', () => {
  test('wraps tool name in brackets with color', () => {
    expect(formatToolName('glob')).toContain('[glob]');
    expect(formatToolName('read')).toContain('[read]');
    expect(formatToolName('bash')).toContain('[bash]');
    // Should include color codes
    expect(formatToolName('glob')).toContain(COLORS.blue);
    expect(formatToolName('glob')).toContain(COLORS.reset);
  });

  test('handles empty string', () => {
    expect(formatToolName('')).toContain('[]');
  });
});

describe('formatPath', () => {
  test('wraps path in purple color codes', () => {
    expect(formatPath('/home/user/file.ts')).toContain('/home/user/file.ts');
    expect(formatPath('/home/user/file.ts')).toContain(COLORS.purple);
    expect(formatPath('/home/user/file.ts')).toContain(COLORS.reset);
    expect(formatPath('./relative/path')).toContain('./relative/path');
  });

  test('handles empty string', () => {
    expect(formatPath('')).toContain(COLORS.purple);
    expect(formatPath('')).toContain(COLORS.reset);
  });
});

describe('formatCommand', () => {
  test('adds $ prefix to simple command', () => {
    expect(formatCommand('git status')).toBe('$ git status');
    expect(formatCommand('npm install')).toBe('$ npm install');
  });

  test('normalizes newlines to spaces', () => {
    expect(formatCommand('git commit\n-m "message"')).toBe('$ git commit -m "message"');
  });

  test('trims whitespace', () => {
    expect(formatCommand('  git status  ')).toBe('$ git status');
  });

  test('extracts command after semicolon (env var setup)', () => {
    expect(formatCommand('CI=true ; git status')).toBe('$ git status');
    expect(formatCommand('VAR1=a ; VAR2=b ; actual-command')).toBe('$ actual-command');
  });

  test('removes inline env var prefixes', () => {
    expect(formatCommand('CI=true npm test')).toBe('$ npm test');
    expect(formatCommand('VAR1=a VAR2=b command arg')).toBe('$ command arg');
  });

  test('truncates very long commands at 100 chars', () => {
    const longCommand = 'a'.repeat(150);
    const result = formatCommand(longCommand);
    expect(result).toBe('$ ' + 'a'.repeat(100) + '...');
    expect(result.length).toBe(105); // "$ " + 100 + "..."
  });

  test('does not truncate commands under 100 chars', () => {
    const shortCommand = 'a'.repeat(99);
    expect(formatCommand(shortCommand)).toBe('$ ' + shortCommand);
  });

  test('handles empty string', () => {
    expect(formatCommand('')).toBe('$ ');
  });
});

describe('formatError', () => {
  test('wraps message in Error brackets with pink color', () => {
    expect(formatError('Something went wrong')).toContain('[Error: Something went wrong]');
    expect(formatError('Something went wrong')).toContain(COLORS.pink);
    expect(formatError('Something went wrong')).toContain(COLORS.reset);
    expect(formatError('File not found')).toContain('[Error: File not found]');
  });

  test('handles empty string', () => {
    expect(formatError('')).toContain('[Error: ]');
  });
});

describe('formatPattern', () => {
  test('adds pattern: prefix with cyan color', () => {
    expect(formatPattern('*.ts')).toContain('pattern:');
    expect(formatPattern('*.ts')).toContain('*.ts');
    expect(formatPattern('*.ts')).toContain(COLORS.cyan);
    expect(formatPattern('*.ts')).toContain(COLORS.reset);
    expect(formatPattern('src/**/*.tsx')).toContain('src/**/*.tsx');
  });

  test('handles empty string', () => {
    expect(formatPattern('')).toContain('pattern:');
  });
});

describe('formatUrl', () => {
  test('wraps URL in cyan color codes', () => {
    expect(formatUrl('https://example.com')).toContain('https://example.com');
    expect(formatUrl('https://example.com')).toContain(COLORS.cyan);
    expect(formatUrl('https://example.com')).toContain(COLORS.reset);
    expect(formatUrl('http://localhost:3000')).toContain('http://localhost:3000');
  });

  test('handles empty string', () => {
    expect(formatUrl('')).toContain(COLORS.cyan);
    expect(formatUrl('')).toContain(COLORS.reset);
  });
});

describe('formatToolCall', () => {
  test('formats tool name only when no input', () => {
    expect(formatToolCall('glob')).toContain('[glob]');
    expect(formatToolCall('glob')).toContain(COLORS.blue);
    expect(formatToolCall('read', undefined)).toContain('[read]');
  });

  test('formats tool name only when input is empty object', () => {
    expect(formatToolCall('bash', {})).toContain('[bash]');
  });

  test('includes description when provided', () => {
    const result = formatToolCall('bash', { description: 'Run tests' });
    expect(result).toContain('[bash]');
    expect(result).toContain('Run tests');
  });

  test('includes formatted command', () => {
    const result = formatToolCall('bash', { command: 'npm test' });
    expect(result).toContain('[bash]');
    expect(result).toContain('$ npm test');
  });

  test('includes file_path', () => {
    const result = formatToolCall('read', { file_path: '/src/index.ts' });
    expect(result).toContain('[read]');
    expect(result).toContain('/src/index.ts');
  });

  test('includes path (alternative to file_path)', () => {
    const result = formatToolCall('glob', { path: '/src' });
    expect(result).toContain('[glob]');
    expect(result).toContain('/src');
  });

  test('prefers file_path over path when both provided', () => {
    const result = formatToolCall('read', { file_path: '/correct', path: '/wrong' });
    expect(result).toContain('[read]');
    expect(result).toContain('/correct');
    expect(result).not.toContain('/wrong');
  });

  test('includes pattern', () => {
    const result = formatToolCall('grep', { pattern: 'TODO' });
    expect(result).toContain('[grep]');
    expect(result).toContain('pattern:');
    expect(result).toContain('TODO');
  });

  test('includes query', () => {
    const result = formatToolCall('search', { query: 'hello world' });
    expect(result).toContain('[search]');
    expect(result).toContain('query:');
    expect(result).toContain('hello world');
  });

  test('includes URL', () => {
    const result = formatToolCall('fetch', { url: 'https://api.example.com' });
    expect(result).toContain('[fetch]');
    expect(result).toContain('https://api.example.com');
  });

  test('includes content preview for short content', () => {
    const result = formatToolCall('write', { content: 'hello world' });
    expect(result).toContain('[write]');
    expect(result).toContain('"hello world"');
  });

  test('truncates long content with char count', () => {
    const longContent = 'x'.repeat(300);
    const result = formatToolCall('write', { content: longContent });
    expect(result).toContain('[write]');
    expect(result).toContain('x'.repeat(200));
    expect(result).toContain('... (300 chars)');
  });

  test('includes edit diff when old_string and new_string provided', () => {
    const result = formatToolCall('edit', {
      old_string: 'const foo = 1;',
      new_string: 'const foo = 2;',
    });
    expect(result).toContain('[edit]');
    expect(result).toContain('edit:');
    expect(result).toContain('→');
  });

  test('truncates long old_string and new_string in edit diff', () => {
    const longString = 'a'.repeat(100);
    const result = formatToolCall('edit', {
      old_string: longString,
      new_string: longString,
    });
    expect(result).toContain('a'.repeat(50) + '...');
  });

  test('combines multiple fields', () => {
    const result = formatToolCall('bash', {
      description: 'Run build',
      command: 'npm run build',
    });
    expect(result).toContain('[bash]');
    expect(result).toContain('Run build');
    expect(result).toContain('$ npm run build');
  });

  test('combines all supported fields', () => {
    const result = formatToolCall('complex', {
      description: 'Test',
      command: 'cmd',
      file_path: '/path',
      pattern: '*.ts',
      query: 'search',
      url: 'http://x',
    });
    expect(result).toContain('[complex]');
    expect(result).toContain('Test');
    expect(result).toContain('$ cmd');
    expect(result).toContain('/path');
    expect(result).toContain('pattern:');
    expect(result).toContain('*.ts');
    expect(result).toContain('query:');
    expect(result).toContain('search');
    expect(result).toContain('http://x');
  });
});

describe('processAgentEvents', () => {
  // Import needed for these tests
  const { processAgentEvents } = require('./output-formatting.js');

  test('displays text events', () => {
    const events = [{ type: 'text', content: 'Hello world' }];
    const result = processAgentEvents(events);
    expect(result).toBe('Hello world');
  });

  test('displays tool_use events with formatting', () => {
    const events = [{ type: 'tool_use', name: 'read', input: { file_path: '/test.ts' } }];
    const result = processAgentEvents(events);
    expect(result).toContain('[read]');
    expect(result).toContain('/test.ts');
    // Tool calls always start with newline for separation
    expect(result.startsWith('\n')).toBe(true);
  });

  test('displays error events', () => {
    const events = [{ type: 'error', message: 'Something went wrong' }];
    const result = processAgentEvents(events);
    expect(result).toContain('[Error: Something went wrong]');
  });

  test('skips tool_result events', () => {
    const events = [
      { type: 'text', content: 'Before' },
      { type: 'tool_result', content: 'This should not appear' },
      { type: 'text', content: 'After' },
    ];
    const result = processAgentEvents(events);
    expect(result).toBe('BeforeAfter');
    expect(result).not.toContain('should not appear');
  });

  test('skips system events', () => {
    const events = [
      { type: 'text', content: 'Before' },
      { type: 'system', subtype: 'init' },
      { type: 'text', content: 'After' },
    ];
    const result = processAgentEvents(events);
    expect(result).toBe('BeforeAfter');
  });

  test('processes mixed events correctly', () => {
    const events = [
      { type: 'text', content: 'Starting task\n' },
      { type: 'tool_use', name: 'bash', input: { command: 'ls' } },
      { type: 'tool_result' },
      { type: 'text', content: 'Done!' },
    ];
    const result = processAgentEvents(events);
    expect(result).toContain('Starting task');
    expect(result).toContain('[bash]');
    expect(result).toContain('$ ls');
    expect(result).toContain('Done!');
  });

  test('tool_use always starts on its own line', () => {
    const events = [
      { type: 'text', content: 'Let me check that' },
      { type: 'tool_use', name: 'read', input: { file_path: '/test.ts' } },
    ];
    const result = processAgentEvents(events);
    // Tool call should be on its own line (newline before the color-coded [read])
    expect(result).toContain('Let me check that\n');
    expect(result).toContain('[read]');
  });

  test('tool_use on its own still has leading newline', () => {
    // This handles streaming where tool_use comes in its own chunk
    const events = [
      { type: 'tool_use', name: 'read', input: { file_path: '/test.ts' } },
    ];
    const result = processAgentEvents(events);
    // Should start with newline so it appears on its own line
    expect(result.startsWith('\n')).toBe(true);
    expect(result).toContain('[read]');
  });

  test('returns empty string for empty events array', () => {
    const result = processAgentEvents([]);
    expect(result).toBe('');
  });

  test('skips text events with empty content', () => {
    const events = [
      { type: 'text', content: '' },
      { type: 'text', content: 'visible' },
    ];
    const result = processAgentEvents(events);
    expect(result).toBe('visible');
  });
});
