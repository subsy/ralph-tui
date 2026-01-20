/**
 * ABOUTME: Tests for BeadsRustTrackerPlugin br CLI integration.
 * Verifies detection, task listing, and single-task retrieval via JSON output.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';

let mockAccessShouldFail = false;

let mockSpawnArgs: Array<{ cmd: string; args: string[] }> = [];
let mockSpawnExitCode = 0;
let mockSpawnStdout = '';
let mockSpawnStderr = '';

type MockSpawnResponse = { exitCode: number; stdout?: string; stderr?: string };
let mockSpawnResponses: MockSpawnResponse[] = [];

function createMockChildProcess(response?: MockSpawnResponse) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  const stdout = response?.stdout ?? mockSpawnStdout;
  const stderr = response?.stderr ?? mockSpawnStderr;
  const exitCode = response?.exitCode ?? mockSpawnExitCode;

  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  }, 0);

  return proc;
}

mock.module('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    mockSpawnArgs.push({ cmd, args });
    const response = mockSpawnResponses.shift();
    return createMockChildProcess(response);
  },
}));

mock.module('node:fs/promises', () => ({
  access: async () => {
    if (mockAccessShouldFail) {
      throw new Error('ENOENT');
    }
  },
  constants: {
    R_OK: 4,
  },
}));

const { BeadsRustTrackerPlugin } = await import('./index.js');

describe('BeadsRustTrackerPlugin', () => {
  beforeEach(() => {
    mockAccessShouldFail = false;
    mockSpawnArgs = [];
    mockSpawnExitCode = 0;
    mockSpawnStdout = '';
    mockSpawnStderr = '';
    mockSpawnResponses = [];
  });

  test('reports unavailable when .beads directory is missing', async () => {
    mockAccessShouldFail = true;

    const plugin = new BeadsRustTrackerPlugin();
    await plugin.initialize({ workingDir: '/test' });
    const result = await plugin.detect();

    expect(result.available).toBe(false);
    expect(result.error).toContain('Beads directory not found');
    expect(mockSpawnArgs.length).toBe(0);
  });

  test('reports unavailable when br --version fails', async () => {
    mockSpawnResponses = [
      { exitCode: 1, stderr: 'br: command not found' },
      { exitCode: 1, stderr: 'br: command not found' },
    ];

    const plugin = new BeadsRustTrackerPlugin();
    await plugin.initialize({ workingDir: '/test' });
    const result = await plugin.detect();

    expect(result.available).toBe(false);
    expect(result.error).toContain('br binary not available');
    expect(mockSpawnArgs.some((c) => c.cmd === 'br')).toBe(true);
  });

  test('extracts version from br --version output', async () => {
    mockSpawnResponses = [
      { exitCode: 0, stdout: 'br version 0.4.1\n' },
      { exitCode: 0, stdout: 'br version 0.4.1\n' },
    ];

    const plugin = new BeadsRustTrackerPlugin();
    await plugin.initialize({ workingDir: '/test' });
    const result = await plugin.detect();

    expect(result.available).toBe(true);
    expect(result.brVersion).toBe('0.4.1');
    expect(result.brPath).toBe('br');
  });

  describe('getTasks', () => {
    test('executes br list --json --all', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'open', priority: 2 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      await plugin.getTasks();

      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.cmd).toBe('br');
      expect(mockSpawnArgs[0]?.args).toEqual(['list', '--json', '--all']);
    });

    test('supports --parent filtering', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic.1', title: 'Child', status: 'open', priority: 0 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      await plugin.getTasks({ parentId: 'epic' });

      expect(mockSpawnArgs[0]?.args).toEqual([
        'list',
        '--json',
        '--all',
        '--parent',
        'epic',
      ]);
    });

    test('supports --label filtering', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 't1',
              title: 'Task 1',
              status: 'open',
              priority: 0,
              labels: ['a', 'b'],
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      await plugin.getTasks({ labels: ['a', 'b'] });

      expect(mockSpawnArgs[0]?.args).toEqual([
        'list',
        '--json',
        '--all',
        '--label',
        'a,b',
      ]);
    });

    test('supports --status filtering and maps status/priority', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Done', status: 'closed', priority: 99 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks({ status: 'completed' });

      expect(mockSpawnArgs[0]?.args).toEqual([
        'list',
        '--json',
        '--all',
        '--status',
        'closed',
      ]);

      expect(tasks[0]?.status).toBe('completed');
      expect(tasks[0]?.priority).toBe(4);
    });
  });

  describe('getTask', () => {
    test('executes br show <id> --json', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'open', priority: 2 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getTask('t1');

      expect(task?.id).toBe('t1');
      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.cmd).toBe('br');
      expect(mockSpawnArgs[0]?.args).toEqual(['show', 't1', '--json']);
    });

    test('returns undefined when task is not found', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        { exitCode: 1, stderr: 'not found' },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getTask('missing');

      expect(task).toBeUndefined();
      expect(mockSpawnArgs[0]?.args).toEqual(['show', 'missing', '--json']);
    });

    test('parses dependency information', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 't1',
              title: 'Task 1',
              status: 'open',
              priority: 2,
              dependencies: [
                {
                  id: 'dep1',
                  title: 'Dep 1',
                  status: 'open',
                  dependency_type: 'blocks',
                },
                {
                  id: 'parent1',
                  title: 'Parent 1',
                  status: 'open',
                  dependency_type: 'parent-child',
                },
              ],
              dependents: [
                {
                  id: 'child1',
                  title: 'Child 1',
                  status: 'open',
                  dependency_type: 'blocks',
                },
              ],
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      const task = await plugin.getTask('t1');

      expect(task?.dependsOn).toEqual(['dep1']);
      expect(task?.blocks).toEqual(['child1']);
    });

    test('returns undefined when br show returns an empty array', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        { exitCode: 0, stdout: JSON.stringify([]) },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      const task = await plugin.getTask('t1');
      expect(task).toBeUndefined();
    });
  });

  describe('getNextTask', () => {
    test('executes br ready --json and supports filters', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'open', priority: 2 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      await plugin.getNextTask({
        limit: 25,
        parentId: 'epic',
        labels: ['a', 'b'],
        priority: [0, 2],
        assignee: 'alice',
      });

      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.cmd).toBe('br');
      expect(mockSpawnArgs[0]?.args).toEqual([
        'ready',
        '--json',
        '--limit',
        '25',
        '--parent',
        'epic',
        '--label',
        'a,b',
        '--priority',
        '0',
        '--assignee',
        'alice',
      ]);
    });

    test('prefers in_progress tasks over open tasks', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't-open', title: 'Open', status: 'open', priority: 1 },
            {
              id: 't-wip',
              title: 'In progress',
              status: 'in_progress',
              priority: 4,
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getNextTask();

      expect(task?.id).toBe('t-wip');
      expect(mockSpawnArgs[0]?.args).toEqual(['ready', '--json', '--limit', '10']);
    });

    test('excludes tasks listed in excludeIds', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 't-wip',
              title: 'In progress',
              status: 'in_progress',
              priority: 1,
            },
            { id: 't-open', title: 'Open', status: 'open', priority: 2 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getNextTask({ excludeIds: ['t-wip'] });

      expect(task?.id).toBe('t-open');
    });

    test('returns undefined when br ready fails', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        { exitCode: 1, stderr: 'boom' },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getNextTask();

      expect(task).toBeUndefined();
      expect(mockSpawnArgs[0]?.args).toEqual(['ready', '--json', '--limit', '10']);
    });
  });

  describe('completeTask', () => {
    test('executes br close <id> without --force', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [
        { exitCode: 0 },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'closed', priority: 2 },
          ]),
        },
      ];

      const result = await plugin.completeTask('t1');

      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('completed');
      expect(mockSpawnArgs.length).toBe(2);
      expect(mockSpawnArgs[0]?.args).toEqual(['close', 't1']);
      expect(mockSpawnArgs[1]?.args).toEqual(['show', 't1', '--json']);
    });

    test('supports --reason', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [
        { exitCode: 0 },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'closed', priority: 2 },
          ]),
        },
      ];

      await plugin.completeTask('t1', 'shipped');

      expect(mockSpawnArgs[0]?.args).toEqual(['close', 't1', '--reason', 'shipped']);
    });

    test('returns failure result when br close fails', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [{ exitCode: 1, stderr: 'permission denied' }];

      const result = await plugin.completeTask('t1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('permission denied');
      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.args).toEqual(['close', 't1']);
    });
  });

  describe('updateTaskStatus', () => {
    test('executes br update <id> --status <status> and returns updated task', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [
        { exitCode: 0 },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'in_progress', priority: 2 },
          ]),
        },
      ];

      const task = await plugin.updateTaskStatus('t1', 'in_progress');

      expect(task?.status).toBe('in_progress');
      expect(mockSpawnArgs.length).toBe(2);
      expect(mockSpawnArgs[0]?.args).toEqual([
        'update',
        't1',
        '--status',
        'in_progress',
      ]);
      expect(mockSpawnArgs[1]?.args).toEqual(['show', 't1', '--json']);
    });

    test('maps completed to br closed', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [
        { exitCode: 0 },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'closed', priority: 2 },
          ]),
        },
      ];

      const task = await plugin.updateTaskStatus('t1', 'completed');

      expect(mockSpawnArgs[0]?.args).toEqual(['update', 't1', '--status', 'closed']);
      expect(task?.status).toBe('completed');
    });

    test('returns undefined when br update fails', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [{ exitCode: 1, stderr: 'permission denied' }];

      const task = await plugin.updateTaskStatus('t1', 'in_progress');

      expect(task).toBeUndefined();
      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.args).toEqual([
        'update',
        't1',
        '--status',
        'in_progress',
      ]);
    });
  });

  describe('sync', () => {
    test('executes br sync --flush-only and returns success', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [{ exitCode: 0, stdout: 'flushed\n' }];

      const result = await plugin.sync();

      expect(result.success).toBe(true);
      expect(result.syncedAt).toBeTruthy();
      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.cmd).toBe('br');
      expect(mockSpawnArgs[0]?.args).toEqual(['sync', '--flush-only']);
    });

    test('returns failure result when br sync --flush-only fails', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      mockSpawnResponses = [{ exitCode: 1, stderr: 'write failed' }];

      const result = await plugin.sync();

      expect(result.success).toBe(false);
      expect(result.error).toContain('write failed');
      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.cmd).toBe('br');
      expect(mockSpawnArgs[0]?.args).toEqual(['sync', '--flush-only']);
    });
  });
});
