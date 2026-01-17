/**
 * ABOUTME: Tests for clipboard utility functions.
 * Tests cross-platform clipboard write functionality with mocked child processes.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';

// Track what spawn was called with
let spawnCalls: Array<{ command: string; args: string[] }> = [];
let mockPlatform = 'darwin';
let mockSpawnBehavior: 'success' | 'enoent' | 'error' | 'stderr' | 'other-error' = 'success';
let mockSpawnSequence: Array<'success' | 'enoent' | 'error' | 'stderr' | 'other-error'> = [];
let spawnCallIndex = 0;

// Create mock stdin
function createMockStdin() {
  return {
    write: mock(() => true),
    end: mock(() => {}),
  };
}

// Create mock process
function createMockProcess(behavior: 'success' | 'enoent' | 'error' | 'stderr' | 'other-error') {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: ReturnType<typeof createMockStdin>;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdin = createMockStdin();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  // Schedule the appropriate behavior
  setImmediate(() => {
    switch (behavior) {
      case 'success':
        proc.emit('close', 0);
        break;
      case 'enoent': {
        const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        proc.emit('error', err);
        break;
      }
      case 'error':
        proc.emit('close', 1);
        break;
      case 'stderr':
        proc.stderr.emit('data', Buffer.from('Some error'));
        proc.emit('close', 1);
        break;
      case 'other-error': {
        const err = new Error('Permission denied');
        proc.emit('error', err);
        break;
      }
    }
  });

  return proc;
}

// Mock spawn function
function mockSpawn(command: string, args: string[]) {
  spawnCalls.push({ command, args });

  // Use sequence if defined, otherwise use single behavior
  let behavior: 'success' | 'enoent' | 'error' | 'stderr' | 'other-error';
  if (mockSpawnSequence.length > 0) {
    behavior = mockSpawnSequence[spawnCallIndex] ?? 'success';
    spawnCallIndex++;
  } else {
    behavior = mockSpawnBehavior;
  }

  return createMockProcess(behavior);
}

// Mock the modules before importing clipboard
mock.module('node:child_process', () => ({
  spawn: mockSpawn,
}));

mock.module('node:os', () => ({
  platform: () => mockPlatform,
}));

// Import after mocking
const { writeToClipboard } = await import('../../src/utils/clipboard.js');

describe('clipboard utility', () => {
  beforeEach(() => {
    spawnCalls = [];
    mockPlatform = 'darwin';
    mockSpawnBehavior = 'success';
    mockSpawnSequence = [];
    spawnCallIndex = 0;
  });

  afterEach(() => {
    spawnCalls = [];
    mockSpawnSequence = [];
    spawnCallIndex = 0;
  });

  describe('writeToClipboard', () => {
    test('returns error for empty text', async () => {
      const result = await writeToClipboard('');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No text provided');
    });

    test('uses pbcopy on macOS', async () => {
      mockPlatform = 'darwin';
      mockSpawnBehavior = 'success';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(true);
      expect(result.charCount).toBe(9);
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0]!.command).toBe('pbcopy');
      expect(spawnCalls[0]!.args).toEqual([]);
    });

    test('uses clip on Windows', async () => {
      mockPlatform = 'win32';
      mockSpawnBehavior = 'success';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(true);
      expect(result.charCount).toBe(9);
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0]!.command).toBe('clip');
    });

    test('tries wl-copy first on Linux', async () => {
      mockPlatform = 'linux';
      mockSpawnBehavior = 'success';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(true);
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0]!.command).toBe('wl-copy');
    });

    test('falls back to xclip if wl-copy fails on Linux', async () => {
      mockPlatform = 'linux';
      mockSpawnSequence = ['enoent', 'success'];

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(true);
      expect(spawnCalls.length).toBe(2);
      expect(spawnCalls[0]!.command).toBe('wl-copy');
      expect(spawnCalls[1]!.command).toBe('xclip');
      expect(spawnCalls[1]!.args).toEqual(['-selection', 'clipboard']);
    });

    test('falls back to xsel if xclip also fails on Linux', async () => {
      mockPlatform = 'linux';
      mockSpawnSequence = ['enoent', 'enoent', 'success'];

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(true);
      expect(spawnCalls.length).toBe(3);
      expect(spawnCalls[0]!.command).toBe('wl-copy');
      expect(spawnCalls[1]!.command).toBe('xclip');
      expect(spawnCalls[2]!.command).toBe('xsel');
      expect(spawnCalls[2]!.args).toEqual(['--clipboard', '--input']);
    });

    test('returns helpful error if all Linux clipboard tools fail', async () => {
      mockPlatform = 'linux';
      mockSpawnSequence = ['enoent', 'enoent', 'enoent'];

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No clipboard tool available');
      expect(result.error).toContain('wl-clipboard');
      expect(result.error).toContain('xclip');
    });

    test('handles command not found error', async () => {
      mockPlatform = 'darwin';
      mockSpawnBehavior = 'enoent';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command not found: pbcopy');
    });

    test('handles other spawn errors (non-ENOENT)', async () => {
      mockPlatform = 'darwin';
      mockSpawnBehavior = 'other-error';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });

    test('handles non-zero exit code with stderr', async () => {
      mockPlatform = 'darwin';
      mockSpawnBehavior = 'stderr';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Some error');
    });

    test('handles non-zero exit code without stderr', async () => {
      mockPlatform = 'darwin';
      mockSpawnBehavior = 'error';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code');
    });

    test('returns unsupported platform error for unknown OS', async () => {
      mockPlatform = 'aix';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unsupported platform: aix');
    });

    test('supports FreeBSD (uses Linux clipboard tools)', async () => {
      mockPlatform = 'freebsd';
      mockSpawnBehavior = 'success';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(true);
      expect(spawnCalls[0]!.command).toBe('wl-copy');
    });

    test('supports OpenBSD (uses Linux clipboard tools)', async () => {
      mockPlatform = 'openbsd';
      mockSpawnBehavior = 'success';

      const result = await writeToClipboard('test text');

      expect(result.success).toBe(true);
      expect(spawnCalls[0]!.command).toBe('wl-copy');
    });
  });
});
