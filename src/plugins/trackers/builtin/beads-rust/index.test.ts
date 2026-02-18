/**
 * ABOUTME: Tests for BeadsRustTrackerPlugin br CLI integration.
 * Verifies detection, task listing, and single-task retrieval via JSON output.
 *
 * IMPORTANT: The mock is set up in beforeAll (not at module level) to prevent
 * polluting other test files. The module under test is dynamically imported
 * after the mock is applied.
 */

import { describe, test, expect, mock, beforeEach, beforeAll, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';

let mockAccessShouldFail = false;

let mockSpawnArgs: Array<{ cmd: string; args: string[] }> = [];
let mockSpawnExitCode = 0;
let mockSpawnStdout = '';
let mockSpawnStderr = '';

let mockReadFileShouldFail = false;
let mockReadFileContent = '';
let mockReadFilePaths: string[] = [];

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

// Declare the class type for the import
let BeadsRustTrackerPlugin: typeof import('./index.js').BeadsRustTrackerPlugin;

describe('BeadsRustTrackerPlugin', () => {
  beforeAll(async () => {
    // Apply mocks BEFORE importing the module under test
    mock.module('node:child_process', () => ({
      spawn: (cmd: string, args: string[]) => {
        mockSpawnArgs.push({ cmd, args });
        const response = mockSpawnResponses.shift();
        return createMockChildProcess(response);
      },
    }));

    mock.module('node:fs', () => ({
      constants: {
        R_OK: 4,
      },
      readFileSync: (path: string) => {
        if (path.endsWith('template.hbs')) {
          return 'br close {{taskId}}\nbr sync --flush-only\n';
        }
        return '';
      },
    }));

    mock.module('node:fs/promises', () => ({
      access: async () => {
        if (mockAccessShouldFail) {
          throw new Error('ENOENT');
        }
      },
      readFile: async (path: string) => {
        mockReadFilePaths.push(path);
        if (mockReadFileShouldFail) {
          throw new Error('ENOENT');
        }
        return mockReadFileContent;
      },
      constants: {
        R_OK: 4,
      },
    }));

    // Import the module so it uses the mocked versions
    const module = await import('./index.js');
    BeadsRustTrackerPlugin = module.BeadsRustTrackerPlugin;
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mockAccessShouldFail = false;
    mockSpawnArgs = [];
    mockSpawnExitCode = 0;
    mockSpawnStdout = '';
    mockSpawnStderr = '';
    mockSpawnResponses = [];
    mockReadFileShouldFail = false;
    mockReadFileContent = '';
    mockReadFilePaths = [];
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
    test('executes br list --json --all with --limit 0 to bypass default limit', async () => {
      // The --limit 0 flag is critical to bypass br's default limit of 50 results.
      // Without it, epics with more than 50 tasks would have tasks truncated.
      // See: https://github.com/subsy/ralph-tui/issues/233
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
      expect(mockSpawnArgs[0]?.args).toEqual(['list', '--json', '--all', '--limit', '0']);
    });

    test('supports --parent filtering via in-memory filtering', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        // First: br list --json --all (returns all tasks)
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic.1', title: 'Child', status: 'open', priority: 0 },
            { id: 'other.1', title: 'Other', status: 'open', priority: 0 },
          ]),
        },
        // Second: br dep list epic --direction up --json (returns children)
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { issue_id: 'epic.1', depends_on_id: 'epic', type: 'parent-child', title: 'Child', status: 'open', priority: 0 }
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks({ parentId: 'epic' });

      // Should call list first, then dep list to get children
      expect(mockSpawnArgs[0]?.args).toEqual(['list', '--json', '--all', '--limit', '0']);
      expect(mockSpawnArgs[1]?.args).toEqual(['dep', 'list', 'epic', '--direction', 'up', '--json']);

      // Should only return child tasks
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe('epic.1');
    });

    test('uses setEpicId for parent filtering when filter is not provided', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic-parent-child', title: 'Tracked child', status: 'open', priority: 1 },
            { id: 'other', title: 'Unrelated task', status: 'open', priority: 1 },
          ]),
        },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              issue_id: 'epic-parent-child',
              depends_on_id: 'epic-parent',
              type: 'parent-child',
              title: 'Tracked child',
              status: 'open',
              priority: 1,
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      plugin.setEpicId('epic-parent');
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks();

      expect(mockSpawnArgs[1]?.args).toEqual([
        'dep',
        'list',
        'epic-parent',
        '--direction',
        'up',
        '--json',
      ]);
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe('epic-parent-child');
    });

    test('returns empty array when br dep list fails for parent filtering', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        // First: br list --json --all (returns all tasks)
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic.1', title: 'Child', status: 'open', priority: 0 },
          ]),
        },
        // Second: br dep list fails
        { exitCode: 1, stderr: 'not found' },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks({ parentId: 'epic' });

      expect(mockSpawnArgs[1]?.args).toEqual(['dep', 'list', 'epic', '--direction', 'up', '--json']);
      // Empty because getChildIds returns empty Set on error
      expect(tasks.length).toBe(0);
    });

    test('filters out non-parent-child dependencies when getting children', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        // First: br list --json --all (returns all tasks)
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'child1', title: 'Child 1', status: 'open', priority: 0 },
            { id: 'blocker1', title: 'Blocker 1', status: 'open', priority: 0 },
          ]),
        },
        // Second: br dep list returns mix of parent-child and blocks
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { issue_id: 'child1', depends_on_id: 'epic', type: 'parent-child', title: 'Child 1', status: 'open', priority: 0 },
            { issue_id: 'blocker1', depends_on_id: 'epic', type: 'blocks', title: 'Blocker 1', status: 'open', priority: 0 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks({ parentId: 'epic' });

      // Should only return parent-child tasks, not blocks
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe('child1');
    });

    test('returns empty array when br dep list returns invalid JSON', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        // First: br list --json --all (returns all tasks)
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic.1', title: 'Child', status: 'open', priority: 0 },
          ]),
        },
        // Second: br dep list returns invalid JSON
        { exitCode: 0, stdout: 'not valid json' },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks({ parentId: 'epic' });

      // Empty because JSON parsing failed
      expect(tasks.length).toBe(0);
    });

    test('uses epicId from config when no parentId filter is provided', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        // First: br list --json --all
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'child1', title: 'Child 1', status: 'open', priority: 0 },
            { id: 'other1', title: 'Other 1', status: 'open', priority: 0 },
          ]),
        },
        // Second: br dep list for configured epicId
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { issue_id: 'child1', depends_on_id: 'config-epic', type: 'parent-child', title: 'Child 1', status: 'open', priority: 0 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test', epicId: 'config-epic' });
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks();

      expect(mockSpawnArgs[1]?.args).toEqual(['dep', 'list', 'config-epic', '--direction', 'up', '--json']);
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe('child1');
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
        '--limit',
        '0',
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
        '--limit',
        '0',
        '--status',
        'closed',
      ]);

      expect(tasks[0]?.status).toBe('completed');
      expect(tasks[0]?.priority).toBe(4);
    });
  });

  describe('getEpics', () => {
    test('executes br list --json --type epic with --limit 0', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic1',
              title: 'Epic 1',
              status: 'open',
              priority: 1,
              issue_type: 'epic',
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      await plugin.getEpics();

      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.cmd).toBe('br');
      expect(mockSpawnArgs[0]?.args).toEqual(['list', '--json', '--type', 'epic', '--limit', '0']);
    });

    test('filters to top-level open/in_progress epics only', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic-open',
              title: 'Epic Open',
              status: 'open',
              priority: 1,
              issue_type: 'epic',
            },
            {
              id: 'epic-wip',
              title: 'Epic WIP',
              status: 'in_progress',
              priority: 1,
              issue_type: 'epic',
            },
            {
              id: 'epic-closed',
              title: 'Epic Closed',
              status: 'closed',
              priority: 1,
              issue_type: 'epic',
            },
            {
              id: 'epic-open.1',
              title: 'Child Epic',
              status: 'open',
              priority: 1,
              issue_type: 'epic',
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      const epics = await plugin.getEpics();

      expect(epics.map((e) => e.id)).toEqual(['epic-open', 'epic-wip']);
    });

    test('supports label filtering via plugin configuration', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic1',
              title: 'Epic 1',
              status: 'open',
              priority: 1,
              issue_type: 'epic',
              labels: ['a', 'b'],
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test', labels: 'a,b' });
      mockSpawnArgs = [];

      await plugin.getEpics();

      expect(mockSpawnArgs[0]?.args).toEqual([
        'list',
        '--json',
        '--type',
        'epic',
        '--limit',
        '0',
        '--label',
        'a,b',
      ]);
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

    test('returns undefined when br show returns a tombstoned task', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Deleted task', status: 'tombstone', priority: 2 },
          ]),
        },
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
        // First: br ready with filters
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'open', priority: 2 },
            { id: 't2', title: 'Other Task', status: 'open', priority: 1 },
          ]),
        },
        // Second: br dep list epic --direction up --json (for filtering children)
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { issue_id: 't1', depends_on_id: 'epic', type: 'parent-child', title: 'Task 1', status: 'open', priority: 2 }
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getNextTask({
        limit: 25,
        parentId: 'epic',
        labels: ['a', 'b'],
        priority: [0, 2],
        assignee: 'alice',
      });

      // First call: ready with filters (no --parent since br doesn't support it)
      expect(mockSpawnArgs[0]?.args).toEqual([
        'ready',
        '--json',
        '--limit',
        '25',
        '--type',
        'task',
        '--label',
        'a,b',
        '--priority',
        '0',
        '--assignee',
        'alice',
      ]);
      // Second call: dep list to get children IDs (for in-memory filtering)
      expect(mockSpawnArgs[1]?.args).toEqual(['dep', 'list', 'epic', '--direction', 'up', '--json']);
      // Should only return child task
      expect(task?.id).toBe('t1');
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

  describe('getTemplate', () => {
    test('returns a br-specific template with br close and br sync --flush-only', () => {
      const plugin = new BeadsRustTrackerPlugin();
      const template = plugin.getTemplate();

      expect(template).toContain('br close');
      expect(template).toContain('br sync --flush-only');
      expect(template).not.toContain('bd close');
    });
  });

  describe('getPrdContext', () => {
    test('returns null when no epic ID is configured', async () => {
      mockSpawnResponses = [{ exitCode: 0, stdout: 'br version 0.4.1\n' }];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      mockSpawnArgs = [];
      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
      expect(mockSpawnArgs.length).toBe(0);
      expect(mockReadFilePaths.length).toBe(0);
    });

    test('reads PRD file content and returns completion stats', async () => {
      mockReadFileContent = '# PRD\n\nHello\n';
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic1',
              title: 'Epic 1',
              description: 'Epic desc',
              status: 'open',
              priority: 0,
              external_ref: 'prd:./tasks/prd.md',
              dependents: [
                { id: 'epic1.1', title: 'A', status: 'open', dependency_type: 'parent-child' },
                { id: 'epic1.2', title: 'B', status: 'closed', dependency_type: 'parent-child' },
                { id: 'epic1.3', title: 'C', status: 'cancelled', dependency_type: 'parent-child' },
              ],
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test', epicId: 'epic1' });
      mockSpawnArgs = [];

      const result = await plugin.getPrdContext();

      expect(result).toEqual({
        name: 'Epic 1',
        description: 'Epic desc',
        content: '# PRD\n\nHello\n',
        completedCount: 2,
        totalCount: 3,
      });
      expect(mockReadFilePaths).toEqual(['/test/tasks/prd.md']);
      expect(mockSpawnArgs.map((c) => c.args)).toEqual([
        ['show', 'epic1', '--json'],
      ]);
    });

    test('returns null when epic external_ref is missing or not a PRD link', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic1',
              title: 'Epic 1',
              status: 'open',
              priority: 0,
              external_ref: 'http://example.com',
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test', epicId: 'epic1' });
      mockSpawnArgs = [];

      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
      expect(mockReadFilePaths.length).toBe(0);
      expect(mockSpawnArgs.map((c) => c.args)).toEqual([['show', 'epic1', '--json']]);
    });

    test('returns null when PRD file cannot be read', async () => {
      mockReadFileShouldFail = true;
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic1',
              title: 'Epic 1',
              status: 'open',
              priority: 0,
              external_ref: 'prd:./tasks/prd.md',
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test', epicId: 'epic1' });
      mockSpawnArgs = [];

      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
      expect(mockReadFilePaths).toEqual(['/test/tasks/prd.md']);
      expect(mockSpawnArgs.map((c) => c.args)).toEqual([['show', 'epic1', '--json']]);
    });
  });

  describe('tombstone filtering', () => {
    test('getTasks filters out tombstoned issues', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Open task', status: 'open', priority: 2 },
            { id: 't2', title: 'Deleted task', status: 'tombstone', priority: 2 },
            { id: 't3', title: 'Closed task', status: 'closed', priority: 2 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const tasks = await plugin.getTasks();

      expect(tasks.length).toBe(2);
      expect(tasks.map((t) => t.id)).toEqual(['t1', 't3']);
    });

    test('getEpics filters out tombstoned epics', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic1', title: 'Active epic', status: 'open', priority: 1, issue_type: 'epic' },
            { id: 'epic2', title: 'Deleted epic', status: 'tombstone', priority: 1, issue_type: 'epic' },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      const epics = await plugin.getEpics();

      expect(epics.length).toBe(1);
      expect(epics[0]?.id).toBe('epic1');
    });

    test('getNextTask filters out tombstoned issues', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Deleted', status: 'tombstone', priority: 2 },
            { id: 't2', title: 'Ready', status: 'open', priority: 2 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getNextTask();

      expect(task?.id).toBe('t2');
    });

    test('getNextTask returns undefined when all tasks are tombstoned', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Deleted 1', status: 'tombstone', priority: 2 },
            { id: 't2', title: 'Deleted 2', status: 'tombstone', priority: 2 },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      mockSpawnArgs = [];

      const task = await plugin.getNextTask();

      expect(task).toBeUndefined();
    });

    test('getPrdContext excludes tombstoned dependents from child counts', async () => {
      mockReadFileContent = '# PRD\n\nHello\n';
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'br version 0.4.1\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic-tombstone-parents',
              title: 'Epic with deleted child',
              description: 'Epic desc',
              status: 'open',
              priority: 0,
              external_ref: 'prd:./tasks/prd.md',
              dependents: [
                { id: 'child-live-closed', title: 'Closed child', status: 'closed', dependency_type: 'parent-child' },
                { id: 'child-live-cancelled', title: 'Cancelled child', status: 'cancelled', dependency_type: 'parent-child' },
                { id: 'child-live-open', title: 'Open child', status: 'open', dependency_type: 'parent-child' },
                { id: 'child-deleted', title: 'Deleted child', status: 'tombstone', dependency_type: 'parent-child' },
              ],
            },
          ]),
        },
      ];

      const plugin = new BeadsRustTrackerPlugin();
      await plugin.initialize({ workingDir: '/test', epicId: 'epic-tombstone-parents' });
      mockSpawnArgs = [];
      const result = await plugin.getPrdContext();

      expect(result).toEqual({
        name: 'Epic with deleted child',
        description: 'Epic desc',
        content: '# PRD\n\nHello\n',
        completedCount: 2,
        totalCount: 3,
      });
      expect(mockReadFilePaths).toEqual(['/test/tasks/prd.md']);
      expect(mockSpawnArgs.map((c) => c.args)).toEqual([
        ['show', 'epic-tombstone-parents', '--json'],
      ]);
    });
  });
});
