/**
 * ABOUTME: Tests for the Beads tracker plugin, focusing on task completion.
 * Uses Bun's mock.module to mock child_process.spawn.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';

// Create a mock spawn function that we can control
let mockSpawnArgs: string[][] = [];
let mockSpawnExitCode = 0;
let mockSpawnStdout = '';
let mockSpawnStderr = '';

function createMockChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  // Emit data and close asynchronously
  setTimeout(() => {
    if (mockSpawnStdout) {
      proc.stdout.emit('data', Buffer.from(mockSpawnStdout));
    }
    if (mockSpawnStderr) {
      proc.stderr.emit('data', Buffer.from(mockSpawnStderr));
    }
    proc.emit('close', mockSpawnExitCode);
  }, 0);

  return proc;
}

// Mock the child_process module before importing beads
mock.module('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    mockSpawnArgs.push(args);
    return createMockChildProcess();
  },
}));

// Import after mocking
const { BeadsTrackerPlugin } = await import('./beads/index.js');

describe('BeadsTrackerPlugin', () => {
  beforeEach(() => {
    // Reset mock state before each test
    mockSpawnArgs = [];
    mockSpawnExitCode = 0;
    mockSpawnStdout = '';
    mockSpawnStderr = '';
  });

  // Helper to create and initialize a plugin
  async function createPlugin(config: Record<string, unknown> = {}) {
    const plugin = new BeadsTrackerPlugin();
    await plugin.initialize({ workingDir: '/test', ...config });
    return plugin;
  }

  describe('completeTask', () => {
    test('uses bd close command with --force flag', async () => {
      // Return valid array format for both close (ignored) and getTask calls
      mockSpawnStdout = '[{"id": "test-001", "title": "Test", "status": "closed", "priority": 2}]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      await plugin.completeTask('test-001', 'Task completed');

      // Find the close command call (there may be multiple calls for getTask)
      const closeCall = mockSpawnArgs.find((args) => args.includes('close'));
      expect(closeCall).toBeDefined();
      expect(closeCall).toContain('close');
      expect(closeCall).toContain('test-001');
      expect(closeCall).toContain('--force');
      expect(closeCall).toContain('--reason');
      expect(closeCall).toContain('Task completed');
    });

    test('includes --force flag even without reason', async () => {
      // Return valid array format for both close (ignored) and getTask calls
      mockSpawnStdout = '[{"id": "test-002", "title": "Test", "status": "closed", "priority": 2}]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      await plugin.completeTask('test-002');

      const closeCall = mockSpawnArgs.find((args) => args.includes('close'));
      expect(closeCall).toBeDefined();
      expect(closeCall).toContain('--force');
      // Verify --reason is NOT present when no reason provided
      expect(closeCall).not.toContain('--reason');
    });

    test('returns success result on successful close', async () => {
      // Return valid JSON for both close and subsequent getTask calls
      mockSpawnStdout = '[{"id": "test-003", "title": "Test Task", "status": "closed", "priority": 2}]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      const result = await plugin.completeTask('test-003', 'Done');

      expect(result.success).toBe(true);
      expect(result.message).toContain('test-003');
      expect(result.message).toContain('closed successfully');
    });

    test('returns failure result on command error', async () => {
      mockSpawnStdout = '';
      mockSpawnStderr = 'Error: task not found';
      mockSpawnExitCode = 1;

      const plugin = await createPlugin();
      const result = await plugin.completeTask('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to close');
      expect(result.error).toContain('task not found');
    });
  });
});
