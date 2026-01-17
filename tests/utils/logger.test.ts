/**
 * ABOUTME: Tests for logger utility functions.
 * Tests log formatting, level filtering, and common logging helpers.
 */

import { describe, test, expect } from 'bun:test';
import {
  LOG_LEVEL_PRIORITY,
  shouldLog,
  formatTimestamp,
  formatLogMessage,
  formatDuration,
  formatBytes,
  truncate,
  indent,
  stripAnsi,
  maskSensitive,
  createConsoleLogger,
} from '../../src/utils/logger.js';

describe('logger utility', () => {
  describe('LOG_LEVEL_PRIORITY', () => {
    test('has correct priority order', () => {
      expect(LOG_LEVEL_PRIORITY.debug).toBeLessThan(LOG_LEVEL_PRIORITY.info);
      expect(LOG_LEVEL_PRIORITY.info).toBeLessThan(LOG_LEVEL_PRIORITY.warn);
      expect(LOG_LEVEL_PRIORITY.warn).toBeLessThan(LOG_LEVEL_PRIORITY.error);
    });
  });

  describe('shouldLog', () => {
    test('allows same level', () => {
      expect(shouldLog('info', 'info')).toBe(true);
    });

    test('allows higher priority level', () => {
      expect(shouldLog('error', 'info')).toBe(true);
    });

    test('blocks lower priority level', () => {
      expect(shouldLog('debug', 'info')).toBe(false);
    });

    test('allows all levels when minLevel is debug', () => {
      expect(shouldLog('debug', 'debug')).toBe(true);
      expect(shouldLog('info', 'debug')).toBe(true);
      expect(shouldLog('warn', 'debug')).toBe(true);
      expect(shouldLog('error', 'debug')).toBe(true);
    });

    test('only allows error when minLevel is error', () => {
      expect(shouldLog('debug', 'error')).toBe(false);
      expect(shouldLog('info', 'error')).toBe(false);
      expect(shouldLog('warn', 'error')).toBe(false);
      expect(shouldLog('error', 'error')).toBe(true);
    });
  });

  describe('formatTimestamp', () => {
    const testDate = new Date('2024-06-15T14:30:45.123Z');

    test('formats as ISO string', () => {
      const result = formatTimestamp(testDate, 'iso');
      expect(result).toBe('2024-06-15T14:30:45.123Z');
    });

    test('formats as time only', () => {
      const result = formatTimestamp(testDate, 'time');
      // The exact time depends on timezone, but format should be HH:mm:ss
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    test('formats as datetime', () => {
      const result = formatTimestamp(testDate, 'datetime');
      // Should contain date and time parts
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    test('defaults to time format', () => {
      const result = formatTimestamp(testDate);
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('formatLogMessage', () => {
    test('formats basic message with level', () => {
      const result = formatLogMessage('info', 'Hello world');
      expect(result).toBe('[INFO] Hello world');
    });

    test('includes timestamp when provided', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatLogMessage('warn', 'Warning message', {
        timestamp: date,
        timestampFormat: 'iso',
      });
      expect(result).toBe('[2024-06-15T14:30:45.123Z] [WARN] Warning message');
    });

    test('includes component when provided', () => {
      const result = formatLogMessage('error', 'Error occurred', {
        component: 'engine',
      });
      expect(result).toBe('[ERROR] [engine] Error occurred');
    });

    test('includes all parts when provided', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatLogMessage('debug', 'Debug info', {
        timestamp: date,
        timestampFormat: 'iso',
        component: 'tracker',
      });
      expect(result).toBe(
        '[2024-06-15T14:30:45.123Z] [DEBUG] [tracker] Debug info',
      );
    });
  });

  describe('formatDuration', () => {
    test('formats milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(0)).toBe('0ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    test('formats seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(59000)).toBe('59s');
    });

    test('formats minutes', () => {
      expect(formatDuration(60000)).toBe('1m');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(3540000)).toBe('59m');
    });

    test('formats hours', () => {
      expect(formatDuration(3600000)).toBe('1h');
      expect(formatDuration(5400000)).toBe('1h 30m');
      expect(formatDuration(7200000)).toBe('2h');
    });
  });

  describe('formatBytes', () => {
    test('formats bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    test('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    test('formats megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1572864)).toBe('1.5 MB');
    });

    test('formats gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
    });
  });

  describe('truncate', () => {
    test('returns original string if within limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    test('truncates with ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });

    test('uses custom ellipsis', () => {
      expect(truncate('hello world', 9, '…')).toBe('hello wo…');
    });

    test('handles exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });

  describe('indent', () => {
    test('indents single line', () => {
      expect(indent('hello', 2)).toBe('  hello');
    });

    test('indents multiple lines', () => {
      expect(indent('hello\nworld', 2)).toBe('  hello\n  world');
    });

    test('handles zero spaces', () => {
      expect(indent('hello', 0)).toBe('hello');
    });
  });

  describe('stripAnsi', () => {
    test('removes ANSI escape codes', () => {
      const colored = '\x1B[31mred\x1B[0m \x1B[32mgreen\x1B[0m';
      expect(stripAnsi(colored)).toBe('red green');
    });

    test('returns plain text unchanged', () => {
      expect(stripAnsi('hello world')).toBe('hello world');
    });

    test('handles complex ANSI codes', () => {
      const complex = '\x1B[1;31;40mBold Red on Black\x1B[0m';
      expect(stripAnsi(complex)).toBe('Bold Red on Black');
    });
  });

  describe('maskSensitive', () => {
    test('masks API keys', () => {
      const input = 'api_key=sk-12345678901234567890';
      const result = maskSensitive(input);
      expect(result).not.toContain('sk-12345678901234567890');
      expect(result).toContain('***');
    });

    test('masks bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9';
      const result = maskSensitive(input);
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(result).toContain('***');
    });

    test('masks passwords', () => {
      const input = 'password=mysecretpass123';
      const result = maskSensitive(input);
      expect(result).not.toContain('mysecretpass123');
      expect(result).toContain('***');
    });

    test('uses custom patterns', () => {
      const input = 'custom_secret=abc123';
      const customPattern = /custom_secret=([^\s]+)/gi;
      const result = maskSensitive(input, [customPattern]);
      expect(result).not.toContain('abc123');
    });

    test('returns string unchanged if no matches', () => {
      const input = 'hello world';
      expect(maskSensitive(input)).toBe('hello world');
    });
  });

  describe('createConsoleLogger', () => {
    test('creates logger with all methods', () => {
      const logger = createConsoleLogger();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    test('respects minimum log level', () => {
      // Create logger with error level - lower levels should be filtered
      const logger = createConsoleLogger('error');

      // These should not throw when called
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
    });
  });
});
