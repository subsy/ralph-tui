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
  test('all color values are empty strings (disabled for TUI)', () => {
    // Colors are disabled because TUI framework escapes ANSI codes
    expect(COLORS.blue).toBe('');
    expect(COLORS.purple).toBe('');
    expect(COLORS.cyan).toBe('');
    expect(COLORS.green).toBe('');
    expect(COLORS.yellow).toBe('');
    expect(COLORS.pink).toBe('');
    expect(COLORS.muted).toBe('');
    expect(COLORS.reset).toBe('');
  });
});

describe('formatToolName', () => {
  test('wraps tool name in brackets', () => {
    expect(formatToolName('glob')).toBe('[glob]');
    expect(formatToolName('read')).toBe('[read]');
    expect(formatToolName('bash')).toBe('[bash]');
  });

  test('handles empty string', () => {
    expect(formatToolName('')).toBe('[]');
  });
});

describe('formatPath', () => {
  test('returns path unchanged (colors disabled)', () => {
    expect(formatPath('/home/user/file.ts')).toBe('/home/user/file.ts');
    expect(formatPath('./relative/path')).toBe('./relative/path');
  });

  test('handles empty string', () => {
    expect(formatPath('')).toBe('');
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
  test('wraps message in Error brackets', () => {
    expect(formatError('Something went wrong')).toBe('[Error: Something went wrong]');
    expect(formatError('File not found')).toBe('[Error: File not found]');
  });

  test('handles empty string', () => {
    expect(formatError('')).toBe('[Error: ]');
  });
});

describe('formatPattern', () => {
  test('adds pattern: prefix', () => {
    expect(formatPattern('*.ts')).toBe('pattern: *.ts');
    expect(formatPattern('src/**/*.tsx')).toBe('pattern: src/**/*.tsx');
  });

  test('handles empty string', () => {
    expect(formatPattern('')).toBe('pattern: ');
  });
});

describe('formatUrl', () => {
  test('returns URL unchanged (colors disabled)', () => {
    expect(formatUrl('https://example.com')).toBe('https://example.com');
    expect(formatUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  test('handles empty string', () => {
    expect(formatUrl('')).toBe('');
  });
});

describe('formatToolCall', () => {
  test('formats tool name only when no input', () => {
    expect(formatToolCall('glob')).toBe('[glob]\n');
    expect(formatToolCall('read', undefined)).toBe('[read]\n');
  });

  test('formats tool name only when input is empty object', () => {
    expect(formatToolCall('bash', {})).toBe('[bash]\n');
  });

  test('includes description when provided', () => {
    const result = formatToolCall('bash', { description: 'Run tests' });
    expect(result).toBe('[bash] Run tests\n');
  });

  test('includes formatted command', () => {
    const result = formatToolCall('bash', { command: 'npm test' });
    expect(result).toBe('[bash] $ npm test\n');
  });

  test('includes file_path', () => {
    const result = formatToolCall('read', { file_path: '/src/index.ts' });
    expect(result).toBe('[read] /src/index.ts\n');
  });

  test('includes path (alternative to file_path)', () => {
    const result = formatToolCall('glob', { path: '/src' });
    expect(result).toBe('[glob] /src\n');
  });

  test('prefers file_path over path when both provided', () => {
    const result = formatToolCall('read', { file_path: '/correct', path: '/wrong' });
    expect(result).toBe('[read] /correct\n');
  });

  test('includes pattern', () => {
    const result = formatToolCall('grep', { pattern: 'TODO' });
    expect(result).toBe('[grep] pattern: TODO\n');
  });

  test('includes query', () => {
    const result = formatToolCall('search', { query: 'hello world' });
    expect(result).toBe('[search] query: hello world\n');
  });

  test('includes URL', () => {
    const result = formatToolCall('fetch', { url: 'https://api.example.com' });
    expect(result).toBe('[fetch] https://api.example.com\n');
  });

  test('includes content preview for short content', () => {
    const result = formatToolCall('write', { content: 'hello world' });
    expect(result).toBe('[write] "hello world"\n');
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
    expect(result).toBe('[bash] Run build $ npm run build\n');
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
    expect(result).toContain('pattern: *.ts');
    expect(result).toContain('query: search');
    expect(result).toContain('http://x');
  });
});
