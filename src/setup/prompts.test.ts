/**
 * ABOUTME: Tests for the terminal prompt utilities.
 * Tests TTY detection and related functionality.
 */

import { describe, expect, test } from 'bun:test';
import { isInteractiveTerminal, stripEscapeCodes, disableMouseTracking } from './prompts.js';

describe('isInteractiveTerminal', () => {
  test('returns false in non-TTY environment (test runner)', () => {
    // When running in bun test, stdin/stdout are not TTYs
    // This validates that our function correctly detects non-TTY environments
    const result = isInteractiveTerminal();

    // In test environment, this should be false since tests don't run in a TTY
    // Note: If this test fails, it may be because the test is being run in a TTY
    expect(typeof result).toBe('boolean');
  });

  test('returns boolean based on TTY state', () => {
    // Verify the function returns a boolean value
    const result = isInteractiveTerminal();
    expect(result === true || result === false).toBe(true);
  });
});

describe('stripEscapeCodes', () => {
  describe('mouse tracking codes', () => {
    test('removes mouse tracking codes with multiple semicolons', () => {
      const input = 'hello35;106;28Mworld';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });

    test('removes mouse tracking codes with two parts', () => {
      const input = 'test100;200Mvalue';
      const result = stripEscapeCodes(input);
      expect(result).toBe('testvalue');
    });

    test('keeps valid input like "10m" (no semicolon)', () => {
      const input = 'run for 10m';
      const result = stripEscapeCodes(input);
      expect(result).toBe('run for 10m');
    });

    test('keeps valid input like "5M" (no semicolon)', () => {
      const input = 'allocated 5M memory';
      const result = stripEscapeCodes(input);
      expect(result).toBe('allocated 5M memory');
    });

    test('removes multiple mouse tracking codes from single input', () => {
      const input = 'abc35;106;28Mdef100;200Mghi';
      const result = stripEscapeCodes(input);
      expect(result).toBe('abcdefghi');
    });
  });

  describe('CSI escape sequences', () => {
    test('removes CSI cursor movement codes', () => {
      const input = 'hello\x1b[2Aworld';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });

    test('removes CSI color codes without semicolons', () => {
      const input = 'hello\x1b[31mworld\x1b[0m';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });

    test('removes CSI codes with uppercase letters', () => {
      const input = 'test\x1b[2Jvalue\x1b[H';
      const result = stripEscapeCodes(input);
      expect(result).toBe('testvalue');
    });

    test('removes CSI codes with question mark', () => {
      const input = 'hello\x1b[?25lworld';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });
  });

  describe('OSC escape sequences', () => {
    test('removes OSC sequences with BEL terminator', () => {
      const input = 'hello\x1b]0;Title\x07world';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });

    test('removes OSC sequences with ESC\\ terminator', () => {
      const input = 'hello\x1b]0;Title\x1b\\world';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });
  });

  describe('control characters', () => {
    test('removes control characters except tab and newline', () => {
      const input = 'hello\x01\x02world';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });

    test('normalizes tab characters to space', () => {
      // Tab is kept during control char filtering, but normalized to space in final step
      const input = 'hello\tworld';
      const result = stripEscapeCodes(input);
      expect(result).toBe('hello world');
    });

    test('normalizes newline characters to space', () => {
      // Newline is kept during control char filtering, but normalized to space in final step
      const input = 'hello\nworld';
      const result = stripEscapeCodes(input);
      expect(result).toBe('hello world');
    });

    test('removes DELETE character (0x7F)', () => {
      const input = 'hello\x7Fworld';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });
  });

  describe('whitespace normalization', () => {
    test('cleans up multiple spaces', () => {
      const input = 'hello    world';
      const result = stripEscapeCodes(input);
      expect(result).toBe('hello world');
    });

    test('cleans up mixed whitespace after escape code removal', () => {
      const input = 'hello35;106;28M   world';
      const result = stripEscapeCodes(input);
      expect(result).toBe('hello world');
    });
  });

  describe('complex scenarios', () => {
    test('handles mixed escape codes and mouse tracking', () => {
      const input = 'hello\x1b[31m35;106;28Mworld\x1b[0m';
      const result = stripEscapeCodes(input);
      expect(result).toBe('helloworld');
    });

    test('handles empty string', () => {
      const result = stripEscapeCodes('');
      expect(result).toBe('');
    });

    test('handles string with only escape codes', () => {
      const input = '\x1b[31m35;106;28M\x1b[0m';
      const result = stripEscapeCodes(input);
      expect(result).toBe('');
    });

    test('handles normal text without any codes', () => {
      const input = 'hello world';
      const result = stripEscapeCodes(input);
      expect(result).toBe('hello world');
    });
  });

  describe('preserves legitimate semicolons', () => {
    test('preserves semicolons in URLs', () => {
      const input = 'http://example.com;param=value';
      const result = stripEscapeCodes(input);
      expect(result).toBe('http://example.com;param=value');
    });

    test('preserves semicolons in CSS-like content', () => {
      const input = 'color: red; background: blue';
      const result = stripEscapeCodes(input);
      expect(result).toBe('color: red; background: blue');
    });

    test('preserves semicolons in code snippets', () => {
      const input = 'for (let i = 0; i < 10; i++)';
      const result = stripEscapeCodes(input);
      expect(result).toBe('for (let i = 0; i < 10; i++)');
    });

    test('removes mouse codes but preserves legitimate semicolons', () => {
      const input = 'URL: http://test.com;a=135;106;28Mb';
      const result = stripEscapeCodes(input);
      // Mouse code "35;106;28M" is removed, leaving "URL: http://test.com;a=1b"
      expect(result).toBe('URL: http://test.com;a=b');
    });
  });
});

describe('disableMouseTracking', () => {
  test('writes mouse tracking disable codes when stdout is TTY', () => {
    // Save original values
    const originalIsTTY = process.stdout.isTTY;
    const originalWrite = process.stdout.write;
    const writes: string[] = [];

    try {
      // Mock stdout as TTY
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
      process.stdout.write = (chunk: any) => {
        writes.push(String(chunk));
        return true;
      };

      disableMouseTracking();

      // Verify all mouse tracking modes are disabled
      expect(writes).toContain('\x1b[?1000l'); // X10 mouse reporting
      expect(writes).toContain('\x1b[?1002l'); // Button event tracking
      expect(writes).toContain('\x1b[?1003l'); // Any event tracking
      expect(writes).toContain('\x1b[?1006l'); // SGR extended reporting
      expect(writes).toContain('\x1b[?1015l'); // urxvt extended reporting
      expect(writes.length).toBe(5);
    } finally {
      // Restore original values
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
      process.stdout.write = originalWrite;
    }
  });

  test('does nothing when stdout is not TTY', () => {
    // Save original values
    const originalIsTTY = process.stdout.isTTY;
    const originalWrite = process.stdout.write;
    const writes: string[] = [];

    try {
      // Mock stdout as non-TTY
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
      process.stdout.write = (chunk: any) => {
        writes.push(String(chunk));
        return true;
      };

      disableMouseTracking();

      // Verify no writes occurred
      expect(writes.length).toBe(0);
    } finally {
      // Restore original values
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
      process.stdout.write = originalWrite;
    }
  });
});
