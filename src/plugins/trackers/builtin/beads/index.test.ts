/**
 * ABOUTME: Tests for BeadsTrackerPlugin bd CLI integration with mocked child_process.
 * Covers detection, sync, task listing, task retrieval, completion, status updates,
 * getNextTask, getEpics, isComplete, and getPrdContext.
 *
 * Uses the same mock pattern as beads-rust/index.test.ts: mocks are applied in
 * beforeAll before the module under test is dynamically imported.
 */

import { describe, test, expect, mock, beforeEach, beforeAll, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';

let mockAccessShouldFail = false;

let mockSpawnArgs: Array<{ cmd: string; args: string[] }> = [];

let mockReadFileShouldFail = false;
let mockReadFileContent = '';
let mockReadFilePaths: string[] = [];

type MockSpawnResponse = { exitCode: number; stdout?: string; stderr?: string };
let mockSpawnResponses: MockSpawnResponse[] = [];

function createMockChildProcess(response: MockSpawnResponse) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  const stdout = response.stdout ?? '';
  const stderr = response.stderr ?? '';
  const exitCode = response.exitCode;

  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  }, 0);

  return proc;
}

// Declare the class type for the import
let BeadsTrackerPlugin: typeof import('./index.js').BeadsTrackerPlugin;

/**
 * Helper: queue mock responses for initialize (access + bd --version).
 * Returns the responses array so callers can push additional responses.
 */
function queueInitResponses(extra: MockSpawnResponse[] = []): void {
  mockSpawnResponses = [
    { exitCode: 0, stdout: 'bd version 1.2.0 (abc123)\n' },
    ...extra,
  ];
}

/**
 * Helper: create plugin and initialize with mocked access + version.
 */
async function createInitializedPlugin(
  config: Record<string, unknown> = {},
): Promise<InstanceType<typeof BeadsTrackerPlugin>> {
  queueInitResponses();
  const plugin = new BeadsTrackerPlugin();
  await plugin.initialize({ workingDir: '/test', ...config });
  mockSpawnArgs = [];
  return plugin;
}

describe('BeadsTrackerPlugin (mocked CLI)', () => {
  beforeAll(async () => {
    // Apply mocks BEFORE importing the module under test
    mock.module('node:child_process', () => ({
      spawn: (cmd: string, args: string[]) => {
        mockSpawnArgs.push({ cmd, args });
        const response = mockSpawnResponses.shift() ?? { exitCode: 1, stderr: 'no mock response' };
        return createMockChildProcess(response);
      },
    }));

    mock.module('node:fs', () => ({
      constants: { R_OK: 4 },
      access: (_path: string, _mode: number, cb: (err: Error | null) => void) => {
        if (mockAccessShouldFail) {
          cb(new Error('ENOENT'));
        } else {
          cb(null);
        }
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
      constants: { R_OK: 4 },
    }));

    const module = await import('./index.js');
    BeadsTrackerPlugin = module.BeadsTrackerPlugin;
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mockAccessShouldFail = false;
    mockSpawnArgs = [];
    mockSpawnResponses = [];
    mockReadFileShouldFail = false;
    mockReadFileContent = '';
    mockReadFilePaths = [];
  });

  // ── Detection ──────────────────────────────────────────────────────

  describe('detect', () => {
    test('reports unavailable when .beads directory is missing', async () => {
      mockAccessShouldFail = true;

      const plugin = new BeadsTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      const result = await plugin.detect();

      expect(result.available).toBe(false);
      expect(result.error).toContain('Beads directory not found');
      // Should not attempt bd --version since dir check failed first
      expect(mockSpawnArgs.length).toBe(0);
    });

    test('reports unavailable when bd --version fails', async () => {
      mockSpawnResponses = [
        { exitCode: 1, stderr: 'bd: command not found' },
        { exitCode: 1, stderr: 'bd: command not found' },
      ];

      const plugin = new BeadsTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      const result = await plugin.detect();

      expect(result.available).toBe(false);
      expect(result.error).toContain('bd binary not available');
    });

    test('extracts version from bd --version output', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'bd version 1.2.0 (abc123)\n' },
        { exitCode: 0, stdout: 'bd version 1.2.0 (abc123)\n' },
      ];

      const plugin = new BeadsTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      const result = await plugin.detect();

      expect(result.available).toBe(true);
      expect(result.bdVersion).toBe('1.2.0');
      expect(result.bdPath).toBe('bd');
    });

    test('sets version to unknown when format is unexpected', async () => {
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'some other output\n' },
        { exitCode: 0, stdout: 'some other output\n' },
      ];

      const plugin = new BeadsTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });
      const result = await plugin.detect();

      expect(result.available).toBe(true);
      expect(result.bdVersion).toBe('unknown');
    });
  });

  // ── isReady ────────────────────────────────────────────────────────

  describe('isReady', () => {
    test('returns true when detect succeeds', async () => {
      const plugin = await createInitializedPlugin();
      expect(await plugin.isReady()).toBe(true);
    });

    test('re-detects when not ready', async () => {
      mockAccessShouldFail = true;
      const plugin = new BeadsTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      expect(await plugin.isReady()).toBe(false);

      // Now make detection succeed
      mockAccessShouldFail = false;
      mockSpawnResponses = [{ exitCode: 0, stdout: 'bd version 1.0.0\n' }];
      expect(await plugin.isReady()).toBe(true);
    });
  });

  // ── Sync (issue #314 fix) ──────────────────────────────────────────

  describe('sync', () => {
    test('executes bd sync --flush-only and returns success', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: 'flushed\n' }];

      const result = await plugin.sync();

      expect(result.success).toBe(true);
      expect(result.message).toContain('flushed to JSONL');
      expect(result.syncedAt).toBeTruthy();
      expect(mockSpawnArgs.length).toBe(1);
      expect(mockSpawnArgs[0]?.cmd).toBe('bd');
      expect(mockSpawnArgs[0]?.args).toEqual(['sync', '--flush-only']);
    });

    test('does NOT call bd sync without --flush-only (issue #314)', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: 'ok\n' }];

      await plugin.sync();

      // Verify the args include --flush-only to prevent data loss
      expect(mockSpawnArgs[0]?.args).toContain('--flush-only');
      expect(mockSpawnArgs[0]?.args).not.toEqual(['sync']);
    });

    test('returns failure result when bd sync --flush-only fails', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stderr: 'write failed' }];

      const result = await plugin.sync();

      expect(result.success).toBe(false);
      expect(result.error).toContain('write failed');
      expect(result.syncedAt).toBeTruthy();
      expect(mockSpawnArgs[0]?.args).toEqual(['sync', '--flush-only']);
    });

    test('uses stdout as error when stderr is empty', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stdout: 'stdout error message' }];

      const result = await plugin.sync();

      expect(result.success).toBe(false);
      expect(result.error).toBe('stdout error message');
    });
  });

  // ── getTasks ───────────────────────────────────────────────────────

  describe('getTasks', () => {
    test('executes bd list --json --all --limit 0', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Task 1', status: 'open', priority: 2 },
          ]),
        },
      ];

      await plugin.getTasks();

      expect(mockSpawnArgs[0]?.cmd).toBe('bd');
      expect(mockSpawnArgs[0]?.args).toEqual(['list', '--json', '--all', '--limit', '0']);
    });

    test('adds --parent flag when epicId is set', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-42' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getTasks();

      expect(mockSpawnArgs[0]?.args).toContain('--parent');
      expect(mockSpawnArgs[0]?.args).toContain('epic-42');
    });

    test('filter parentId overrides epicId', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-42' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getTasks({ parentId: 'epic-99' });

      expect(mockSpawnArgs[0]?.args).toContain('epic-99');
      expect(mockSpawnArgs[0]?.args).not.toContain('epic-42');
    });

    test('adds --status flag for single status filter', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getTasks({ status: 'open' });

      expect(mockSpawnArgs[0]?.args).toContain('--status');
      expect(mockSpawnArgs[0]?.args).toContain('open');
    });

    test('maps completed status to closed for bd', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getTasks({ status: 'completed' });

      expect(mockSpawnArgs[0]?.args).toContain('closed');
    });

    test('adds --label flag when labels are configured', async () => {
      const plugin = await createInitializedPlugin({ labels: 'frontend,backend' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getTasks();

      expect(mockSpawnArgs[0]?.args).toContain('--label');
      expect(mockSpawnArgs[0]?.args).toContain('frontend,backend');
    });

    test('converts BeadJson to TrackerTask correctly', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 't1',
              title: 'Task One',
              description: 'A task',
              status: 'open',
              priority: 1,
              issue_type: 'task',
              owner: 'alice@test.com',
              labels: ['frontend'],
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-02T00:00:00Z',
            },
          ]),
        },
      ];

      const tasks = await plugin.getTasks();

      expect(tasks.length).toBe(1);
      expect(tasks[0]?.id).toBe('t1');
      expect(tasks[0]?.title).toBe('Task One');
      expect(tasks[0]?.status).toBe('open');
      expect(tasks[0]?.priority).toBe(1);
      expect(tasks[0]?.description).toBe('A task');
      expect(tasks[0]?.type).toBe('task');
      expect(tasks[0]?.assignee).toBe('alice@test.com');
      expect(tasks[0]?.labels).toEqual(['frontend']);
    });

    test('maps bd statuses to TrackerTaskStatus correctly', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Open', status: 'open', priority: 2 },
            { id: 't2', title: 'In Progress', status: 'in_progress', priority: 2 },
            { id: 't3', title: 'Closed', status: 'closed', priority: 2 },
            { id: 't4', title: 'Cancelled', status: 'cancelled', priority: 2 },
          ]),
        },
      ];

      const tasks = await plugin.getTasks();

      expect(tasks[0]?.status).toBe('open');
      expect(tasks[1]?.status).toBe('in_progress');
      expect(tasks[2]?.status).toBe('completed');
      expect(tasks[3]?.status).toBe('cancelled');
    });

    test('infers parentId from dotted bead ID', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic-123.45', title: 'Child', status: 'open', priority: 2 },
          ]),
        },
      ];

      const tasks = await plugin.getTasks();

      expect(tasks[0]?.parentId).toBe('epic-123');
    });

    test('uses explicit parent field over dotted ID inference', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic-123.45', title: 'Child', status: 'open', priority: 2, parent: 'explicit-parent' },
          ]),
        },
      ];

      const tasks = await plugin.getTasks();

      expect(tasks[0]?.parentId).toBe('explicit-parent');
    });

    test('extracts blocking dependencies', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 't1',
              title: 'Task',
              status: 'open',
              priority: 2,
              dependencies: [
                { id: 'dep1', title: 'Dep', status: 'open', dependency_type: 'blocks' },
                { id: 'parent1', title: 'Parent', status: 'open', dependency_type: 'parent-child' },
              ],
              dependents: [
                { id: 'child1', title: 'Child', status: 'open', dependency_type: 'blocks' },
              ],
            },
          ]),
        },
      ];

      const tasks = await plugin.getTasks();

      expect(tasks[0]?.dependsOn).toEqual(['dep1']);
      expect(tasks[0]?.blocks).toEqual(['child1']);
    });

    test('returns empty array when bd list fails', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stderr: 'list error' }];

      const tasks = await plugin.getTasks();

      expect(tasks).toEqual([]);
    });

    test('returns empty array when bd list returns invalid JSON', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: 'not json' }];

      const tasks = await plugin.getTasks();

      expect(tasks).toEqual([]);
    });

    test('clamps priority to 0-4 range', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'High', status: 'open', priority: -5 },
            { id: 't2', title: 'Low', status: 'open', priority: 99 },
          ]),
        },
      ];

      const tasks = await plugin.getTasks();

      expect(tasks[0]?.priority).toBe(0);
      expect(tasks[1]?.priority).toBe(4);
    });
  });

  // ── getTask ────────────────────────────────────────────────────────

  describe('getTask', () => {
    test('calls bd show <id> --json', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'task-1', title: 'My Task', status: 'open', priority: 2 },
          ]),
        },
      ];

      const task = await plugin.getTask('task-1');

      expect(mockSpawnArgs[0]?.cmd).toBe('bd');
      expect(mockSpawnArgs[0]?.args).toEqual(['show', 'task-1', '--json']);
      expect(task?.id).toBe('task-1');
      expect(task?.title).toBe('My Task');
    });

    test('returns undefined when bd show fails', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stderr: 'not found' }];

      const task = await plugin.getTask('nonexistent');

      expect(task).toBeUndefined();
    });

    test('returns undefined when bd show returns empty array', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      const task = await plugin.getTask('task-1');

      expect(task).toBeUndefined();
    });

    test('returns undefined when bd show returns invalid JSON', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: 'not json' }];

      const task = await plugin.getTask('task-1');

      expect(task).toBeUndefined();
    });
  });

  // ── completeTask ───────────────────────────────────────────────────

  describe('completeTask', () => {
    test('calls bd close <id> --force', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        // close call
        { exitCode: 0, stdout: 'closed\n' },
        // getTask re-fetch
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'task-1', title: 'Done', status: 'closed', priority: 2 },
          ]),
        },
      ];

      const result = await plugin.completeTask('task-1');

      expect(mockSpawnArgs[0]?.args).toEqual(['close', 'task-1', '--force']);
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('completed');
    });

    test('passes reason when provided', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'closed\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'task-1', title: 'Done', status: 'closed', priority: 2 },
          ]),
        },
      ];

      await plugin.completeTask('task-1', 'All tests pass');

      expect(mockSpawnArgs[0]?.args).toEqual([
        'close', 'task-1', '--force', '--reason', 'All tests pass',
      ]);
    });

    test('returns failure when bd close fails', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stderr: 'close error' }];

      const result = await plugin.completeTask('task-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('close error');
    });
  });

  // ── updateTaskStatus ───────────────────────────────────────────────

  describe('updateTaskStatus', () => {
    test('calls bd update <id> --status <bdStatus>', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        // update call
        { exitCode: 0, stdout: 'updated\n' },
        // getTask re-fetch
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'task-1', title: 'Task', status: 'in_progress', priority: 2 },
          ]),
        },
      ];

      const task = await plugin.updateTaskStatus('task-1', 'in_progress');

      expect(mockSpawnArgs[0]?.args).toEqual(['update', 'task-1', '--status', 'in_progress']);
      expect(task?.status).toBe('in_progress');
    });

    test('maps completed to closed for bd', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'updated\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'task-1', title: 'Task', status: 'closed', priority: 2 },
          ]),
        },
      ];

      await plugin.updateTaskStatus('task-1', 'completed');

      expect(mockSpawnArgs[0]?.args).toContain('closed');
    });

    test('maps blocked to open for bd', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        { exitCode: 0, stdout: 'updated\n' },
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'task-1', title: 'Task', status: 'open', priority: 2 },
          ]),
        },
      ];

      await plugin.updateTaskStatus('task-1', 'blocked');

      expect(mockSpawnArgs[0]?.args).toContain('open');
    });

    test('returns undefined when bd update fails', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stderr: 'update error' }];

      const task = await plugin.updateTaskStatus('task-1', 'in_progress');

      expect(task).toBeUndefined();
    });
  });

  // ── getNextTask ────────────────────────────────────────────────────

  describe('getNextTask', () => {
    test('calls bd ready --json --limit 10', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Ready', status: 'open', priority: 1 },
          ]),
        },
      ];

      const task = await plugin.getNextTask();

      expect(mockSpawnArgs[0]?.cmd).toBe('bd');
      expect(mockSpawnArgs[0]?.args).toContain('ready');
      expect(mockSpawnArgs[0]?.args).toContain('--json');
      expect(mockSpawnArgs[0]?.args).toContain('--limit');
      expect(mockSpawnArgs[0]?.args).toContain('10');
      expect(task?.id).toBe('t1');
    });

    test('passes --parent flag from epicId', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'my-epic' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getNextTask();

      expect(mockSpawnArgs[0]?.args).toContain('--parent');
      expect(mockSpawnArgs[0]?.args).toContain('my-epic');
    });

    test('filter parentId overrides epicId in getNextTask', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'my-epic' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getNextTask({ parentId: 'filter-epic' });

      expect(mockSpawnArgs[0]?.args).toContain('filter-epic');
      expect(mockSpawnArgs[0]?.args).not.toContain('my-epic');
    });

    test('passes --label flag from configured labels', async () => {
      const plugin = await createInitializedPlugin({ labels: 'frontend,backend' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getNextTask();

      expect(mockSpawnArgs[0]?.args).toContain('--label');
      expect(mockSpawnArgs[0]?.args).toContain('frontend,backend');
    });

    test('passes --priority flag', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getNextTask({ priority: 1 });

      expect(mockSpawnArgs[0]?.args).toContain('--priority');
      expect(mockSpawnArgs[0]?.args).toContain('1');
    });

    test('uses highest priority (lowest number) for multiple priorities', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getNextTask({ priority: [3, 1, 2] });

      expect(mockSpawnArgs[0]?.args).toContain('--priority');
      expect(mockSpawnArgs[0]?.args).toContain('1');
    });

    test('passes --assignee flag', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getNextTask({ assignee: 'alice@test.com' });

      expect(mockSpawnArgs[0]?.args).toContain('--assignee');
      expect(mockSpawnArgs[0]?.args).toContain('alice@test.com');
    });

    test('prefers in_progress tasks over open tasks', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Open', status: 'open', priority: 0 },
            { id: 't2', title: 'In Progress', status: 'in_progress', priority: 2 },
          ]),
        },
      ];

      const task = await plugin.getNextTask();

      expect(task?.id).toBe('t2');
    });

    test('excludes task IDs from excludeIds filter', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Skip', status: 'open', priority: 1 },
            { id: 't2', title: 'Take', status: 'open', priority: 2 },
          ]),
        },
      ];

      const task = await plugin.getNextTask({ excludeIds: ['t1'] });

      expect(task?.id).toBe('t2');
    });

    test('returns undefined when all tasks excluded', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Skip', status: 'open', priority: 1 },
          ]),
        },
      ];

      const task = await plugin.getNextTask({ excludeIds: ['t1'] });

      expect(task).toBeUndefined();
    });

    test('returns undefined when not ready', async () => {
      mockAccessShouldFail = true;
      const plugin = new BeadsTrackerPlugin();
      await plugin.initialize({ workingDir: '/test' });

      // isReady will fail since .beads is missing
      const task = await plugin.getNextTask();

      expect(task).toBeUndefined();
    });

    test('returns undefined when bd ready fails', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stderr: 'ready error' }];

      const task = await plugin.getNextTask();

      expect(task).toBeUndefined();
    });

    test('returns undefined when bd ready returns invalid JSON', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: 'not json' }];

      const task = await plugin.getNextTask();

      expect(task).toBeUndefined();
    });

    test('returns undefined when bd ready returns empty array', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      const task = await plugin.getNextTask();

      expect(task).toBeUndefined();
    });
  });

  // ── getEpics ───────────────────────────────────────────────────────

  describe('getEpics', () => {
    test('calls bd list --json --type epic --limit 0', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getEpics();

      expect(mockSpawnArgs[0]?.args).toEqual(['list', '--json', '--type', 'epic', '--limit', '0']);
    });

    test('adds --label flag when labels configured', async () => {
      const plugin = await createInitializedPlugin({ labels: 'ralph' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      await plugin.getEpics();

      expect(mockSpawnArgs[0]?.args).toContain('--label');
      expect(mockSpawnArgs[0]?.args).toContain('ralph');
    });

    test('filters to open/in_progress top-level epics only', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'e1', title: 'Open Epic', status: 'open', priority: 1, issue_type: 'epic' },
            { id: 'e2', title: 'Closed Epic', status: 'closed', priority: 1, issue_type: 'epic' },
            { id: 'e3', title: 'In Progress', status: 'in_progress', priority: 1, issue_type: 'epic' },
            { id: 'e1.sub', title: 'Sub Epic', status: 'open', priority: 1, issue_type: 'epic' },
          ]),
        },
      ];

      const epics = await plugin.getEpics();

      // e2 excluded (closed), e1.sub excluded (has parentId inferred from dot)
      expect(epics.length).toBe(2);
      expect(epics.map((e) => e.id)).toEqual(['e1', 'e3']);
    });

    test('returns empty array when bd list fails', async () => {
      const plugin = await createInitializedPlugin();
      mockSpawnResponses = [{ exitCode: 1, stderr: 'error' }];

      const epics = await plugin.getEpics();

      expect(epics).toEqual([]);
    });
  });

  // ── isComplete ─────────────────────────────────────────────────────

  describe('isComplete', () => {
    test('returns true when all tasks are completed or cancelled', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Done', status: 'closed', priority: 2 },
            { id: 't2', title: 'Skipped', status: 'cancelled', priority: 2 },
          ]),
        },
      ];

      const complete = await plugin.isComplete();

      expect(complete).toBe(true);
    });

    test('returns false when any task is still open', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'Done', status: 'closed', priority: 2 },
            { id: 't2', title: 'Still open', status: 'open', priority: 2 },
          ]),
        },
      ];

      const complete = await plugin.isComplete();

      expect(complete).toBe(false);
    });

    test('returns true when no tasks exist', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockSpawnResponses = [{ exitCode: 0, stdout: '[]' }];

      const complete = await plugin.isComplete();

      expect(complete).toBe(true);
    });
  });

  // ── getPrdContext ──────────────────────────────────────────────────

  describe('getPrdContext', () => {
    test('returns null when no epicId is set', async () => {
      const plugin = await createInitializedPlugin();

      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
    });

    test('returns null when epic has no external_ref', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic-1', title: 'Epic', status: 'open', priority: 1 },
          ]),
        },
      ];

      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
    });

    test('returns null when external_ref does not start with prd:', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'epic-1', title: 'Epic', status: 'open', priority: 1, external_ref: 'other:ref' },
          ]),
        },
      ];

      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
    });

    test('reads PRD file and returns context with completion stats', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockReadFileContent = '# My PRD\n\nRequirements here';
      mockSpawnResponses = [
        // bd show epic-1 --json
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic-1',
              title: 'My Epic',
              description: 'Epic desc',
              status: 'open',
              priority: 1,
              external_ref: 'prd:./docs/prd.md',
            },
          ]),
        },
        // bd list --json --parent epic-1 (children for stats)
        {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 't1', title: 'T1', status: 'closed', priority: 2 },
            { id: 't2', title: 'T2', status: 'open', priority: 2 },
            { id: 't3', title: 'T3', status: 'cancelled', priority: 2 },
          ]),
        },
      ];

      const result = await plugin.getPrdContext();

      expect(result).not.toBeNull();
      expect(result!.name).toBe('My Epic');
      expect(result!.description).toBe('Epic desc');
      expect(result!.content).toBe('# My PRD\n\nRequirements here');
      expect(result!.totalCount).toBe(3);
      expect(result!.completedCount).toBe(2); // closed + cancelled
    });

    test('returns null when epic show fails', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockSpawnResponses = [{ exitCode: 1, stderr: 'not found' }];

      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
    });

    test('returns null when PRD file cannot be read', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockReadFileShouldFail = true;
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic-1',
              title: 'Epic',
              status: 'open',
              priority: 1,
              external_ref: 'prd:./docs/prd.md',
            },
          ]),
        },
      ];

      const result = await plugin.getPrdContext();

      expect(result).toBeNull();
    });

    test('handles zero completion stats when children list fails', async () => {
      const plugin = await createInitializedPlugin({ epicId: 'epic-1' });
      mockReadFileContent = 'PRD content';
      mockSpawnResponses = [
        {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 'epic-1',
              title: 'Epic',
              status: 'open',
              priority: 1,
              external_ref: 'prd:./docs/prd.md',
            },
          ]),
        },
        // children list fails
        { exitCode: 1, stderr: 'error' },
      ];

      const result = await plugin.getPrdContext();

      expect(result).not.toBeNull();
      expect(result!.completedCount).toBe(0);
      expect(result!.totalCount).toBe(0);
    });
  });

  // ── getTemplate ────────────────────────────────────────────────────

  describe('getTemplate', () => {
    test('returns a non-empty template string', async () => {
      const plugin = await createInitializedPlugin();
      const template = plugin.getTemplate();

      expect(template.length).toBeGreaterThan(0);
      expect(typeof template).toBe('string');
    });
  });

  // ── getConfiguredLabels ────────────────────────────────────────────

  describe('getConfiguredLabels', () => {
    test('returns configured labels', async () => {
      const plugin = await createInitializedPlugin({ labels: 'a,b,c' });

      expect(plugin.getConfiguredLabels()).toEqual(['a', 'b', 'c']);
    });

    test('returns empty array when no labels configured', async () => {
      const plugin = await createInitializedPlugin();

      expect(plugin.getConfiguredLabels()).toEqual([]);
    });
  });

  // ── Factory ────────────────────────────────────────────────────────

  describe('factory', () => {
    test('default export creates a BeadsTrackerPlugin instance', async () => {
      const { default: createBeadsTracker } = await import('./index.js');
      const tracker = createBeadsTracker();

      expect(tracker).toBeInstanceOf(BeadsTrackerPlugin);
      expect(tracker.meta.id).toBe('beads');
    });
  });
});
