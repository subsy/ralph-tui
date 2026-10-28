/**
 * ABOUTME: Tests for BeadsBvTrackerPlugin focusing on unit-testable behavior.
 * Complex integration scenarios with spawn mocking are difficult due to ES module
 * caching, so we focus on synchronous behavior and exported utilities.
 *
 * The mock is configured in beforeAll (not at module scope) to avoid polluting
 * other test files. The module under test is dynamically imported only once
 * the mock is in place, ensuring isolation.
 */

import {
  describe,
  test,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
} from 'bun:test';
import { EventEmitter } from 'node:events';
import type { TrackerTask } from '../../types.js';

// Declare the types for the imports
let BeadsBvTrackerPlugin: typeof import('./index.js').BeadsBvTrackerPlugin;
let BeadsTrackerPlugin: typeof import('../beads/index.js').BeadsTrackerPlugin;
type TaskReasoning = import('./index.js').TaskReasoning;

interface MockSpawnResponse {
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

const spawnResponses: MockSpawnResponse[] = [];

function queueSpawnResponse(response: MockSpawnResponse): void {
  spawnResponses.push(response);
}

function queueRobotNextTask(id = 'task-42'): void {
  queueSpawnResponse({
    command: 'bv',
    stdout: JSON.stringify({
      generated_at: '2026-02-24T00:00:00.000Z',
      data_hash: 'hash',
      output_format: 'json',
      id,
      title: 'Robot next task',
      score: 0.9,
      reasons: ['Top rank'],
      unblocks: 5,
      claim_command: `bd update ${id} --status in_progress`,
      show_command: `bd show ${id}`,
    }),
  });
}

async function withTemporaryGetNextTaskStub(
  stubbedGetNextTask: typeof BeadsTrackerPlugin.prototype.getNextTask,
  callback: () => Promise<void>
): Promise<void> {
  const originalGetNextTask = BeadsTrackerPlugin.prototype.getNextTask;
  BeadsTrackerPlugin.prototype.getNextTask = stubbedGetNextTask;
  try {
    await callback();
  } finally {
    BeadsTrackerPlugin.prototype.getNextTask = originalGetNextTask;
  }
}

describe('BeadsBvTrackerPlugin', () => {
  beforeAll(async () => {
    // Minimal mocks to allow module to load
    mock.module('node:child_process', () => ({
      spawn: (command: string) => {
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();

        const matchIndex = spawnResponses.findIndex(
          (response) =>
            response.command === command || response.command === '*'
        );
        const response =
          matchIndex >= 0
            ? spawnResponses.splice(matchIndex, 1)[0]
            : { command, exitCode: 0 };

        setTimeout(() => {
          if (response?.stdout) {
            proc.stdout.emit('data', Buffer.from(response.stdout));
          }
          if (response?.stderr) {
            proc.stderr.emit('data', Buffer.from(response.stderr));
          }
          proc.emit('close', response?.exitCode ?? 0);
        }, 0);
        return proc;
      },
    }));

    mock.module('node:fs', () => ({
      access: (
        _path: string,
        _mode: number,
        callback: (err: Error | null) => void
      ) => {
        callback(null);
      },
      constants: { R_OK: 4, W_OK: 2, X_OK: 1, F_OK: 0 },
    }));

    mock.module('node:fs/promises', () => ({
      access: async () => {},
      readFile: async () => '',
    }));

    const module = await import('./index.js');
    BeadsBvTrackerPlugin = module.BeadsBvTrackerPlugin;
    const beadsModule = await import('../beads/index.js');
    BeadsTrackerPlugin = beadsModule.BeadsTrackerPlugin;
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    spawnResponses.length = 0;
  });

  describe('meta', () => {
    test('has correct plugin metadata', () => {
      const plugin = new BeadsBvTrackerPlugin();

      expect(plugin.meta.id).toBe('beads-bv');
      expect(plugin.meta.name).toContain('Beads');
      expect(plugin.meta.name).toContain('Smart');
      expect(plugin.meta.description).toContain('bv');
      expect(plugin.meta.supportsDependencies).toBe(true);
      expect(plugin.meta.supportsHierarchy).toBe(true);
      expect(plugin.meta.supportsBidirectionalSync).toBe(true);
    });

    test('meta version is semver format', () => {
      const plugin = new BeadsBvTrackerPlugin();
      expect(plugin.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('getTemplate', () => {
    test('returns template content with bd commands', () => {
      const plugin = new BeadsBvTrackerPlugin();
      const template = plugin.getTemplate();

      expect(template).toContain('bd close');
      // Note: beads-bv uses bd (Go version) which doesn't have a sync command
      // Only beads-rust (br) has sync functionality
    });

    test('template does not contain br commands (uses bd, not br)', () => {
      const plugin = new BeadsBvTrackerPlugin();
      const template = plugin.getTemplate();

      // beads-bv uses bd (Go version), not br (Rust version)
      expect(template).not.toContain('br close');
      expect(template).not.toContain('br sync');
    });
  });

  describe('reasoning methods before triage', () => {
    test('getTaskReasoning returns undefined before any triage', () => {
      const plugin = new BeadsBvTrackerPlugin();
      expect(plugin.getTaskReasoning('any-task-id')).toBeUndefined();
    });

    test('getAllTaskReasoning returns empty map before any triage', () => {
      const plugin = new BeadsBvTrackerPlugin();
      const allReasoning = plugin.getAllTaskReasoning();
      expect(allReasoning.size).toBe(0);
      expect(allReasoning instanceof Map).toBe(true);
    });

    test('getTriageStats returns undefined before any triage', () => {
      const plugin = new BeadsBvTrackerPlugin();
      expect(plugin.getTriageStats()).toBeUndefined();
    });
  });

  describe('initial state', () => {
    test('isBvAvailable returns false before initialization', () => {
      const plugin = new BeadsBvTrackerPlugin();
      // Before initialize(), bvAvailable should be false (default)
      expect(plugin.isBvAvailable()).toBe(false);
    });
  });

  describe('TaskReasoning interface', () => {
    test('TaskReasoning type is exported correctly', () => {
      // This tests that the interface is accessible
      const reasoning: TaskReasoning = {
        taskId: 't1',
        score: 0.8,
        reasons: ['High PageRank'],
        unblocks: 3,
      };

      expect(reasoning.taskId).toBe('t1');
      expect(reasoning.score).toBe(0.8);
      expect(reasoning.reasons).toContain('High PageRank');
      expect(reasoning.unblocks).toBe(3);
    });

    test('TaskReasoning breakdown is optional', () => {
      const withoutBreakdown: TaskReasoning = {
        taskId: 't1',
        score: 0.5,
        reasons: [],
        unblocks: 0,
      };

      const withBreakdown: TaskReasoning = {
        taskId: 't2',
        score: 0.9,
        reasons: ['Critical path'],
        unblocks: 5,
        breakdown: {
          pagerank: 0.7,
          betweenness: 0.4,
        },
      };

      expect(withoutBreakdown.breakdown).toBeUndefined();
      expect(withBreakdown.breakdown?.pagerank).toBe(0.7);
    });
  });

  describe('getNextTask with --robot-next', () => {
    test('falls back to base tracker when --robot-next returns message output', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const fallbackTask: TrackerTask = {
        id: 'fallback-task',
        title: 'Fallback task',
        status: 'open',
        priority: 2,
      };

      (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;
      (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => {};

      queueSpawnResponse({
        command: 'bv',
        stdout: JSON.stringify({
          generated_at: '2026-02-24T00:00:00.000Z',
          data_hash: 'hash',
          output_format: 'json',
          message: 'No actionable items available',
        }),
      });

      await withTemporaryGetNextTaskStub(async () => fallbackTask, async () => {
        const result = await plugin.getNextTask();
        expect(result).toEqual(fallbackTask);
      });
    });

    test('falls back to base tracker when --robot-next exits with non-zero code', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const fallbackTask: TrackerTask = {
        id: 'fallback-task',
        title: 'Fallback task',
        status: 'open',
        priority: 2,
      };

      (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;
      (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => {};

      queueSpawnResponse({
        command: 'bv',
        exitCode: 1,
        stderr: 'command failed',
      });

      await withTemporaryGetNextTaskStub(async () => fallbackTask, async () => {
        const result = await plugin.getNextTask();
        expect(result).toEqual(fallbackTask);
      });
    });

    test('falls back to base tracker when --robot-next output has no message and no id', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const fallbackTask: TrackerTask = {
        id: 'fallback-task',
        title: 'Fallback task',
        status: 'open',
        priority: 2,
      };

      (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;
      (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => {};

      queueSpawnResponse({
        command: 'bv',
        stdout: JSON.stringify({
          generated_at: '2026-02-24T00:00:00.000Z',
          data_hash: 'hash',
          output_format: 'json',
          note: 'invalid shape',
        }),
      });

      await withTemporaryGetNextTaskStub(async () => fallbackTask, async () => {
        const result = await plugin.getNextTask();
        expect(result).toEqual(fallbackTask);
      });
    });

    test('falls back to base tracker when robot-next task is outside selected epic', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const fallbackTask: TrackerTask = {
        id: 'fallback-task',
        title: 'Fallback task',
        status: 'open',
        priority: 2,
      };

      (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;
      (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => {};
      (plugin as unknown as { getEpicChildrenIds: (parentId: string) => Promise<string[]> }).getEpicChildrenIds =
        async (_parentId: string) => ['task-2'];

      queueSpawnResponse({
        command: 'bv',
        stdout: JSON.stringify({
          generated_at: '2026-02-24T00:00:00.000Z',
          data_hash: 'hash',
          output_format: 'json',
          id: 'task-1',
          title: 'Task from robot-next',
          score: 0.8,
          reasons: ['Highest impact'],
          unblocks: 3,
          claim_command: 'bd update task-1 --status in_progress',
          show_command: 'bd show task-1',
        }),
      });

      await withTemporaryGetNextTaskStub(async () => fallbackTask, async () => {
        const result = await plugin.getNextTask({ parentId: 'epic-1' });
        expect(result).toEqual(fallbackTask);
      });
    });

    test('constructs fallback task when getTask returns undefined', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const breakdown = {
        pagerank: 0.7,
        urgency: 0.3,
      };

      (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;
      (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => {};
      (plugin as unknown as { getTask: (id: string) => Promise<TrackerTask | undefined> }).getTask =
        async (_id: string) => undefined;
      (plugin as unknown as { lastTriageOutput: unknown }).lastTriageOutput = {
        generated_at: '2026-02-24T00:00:00.000Z',
        data_hash: 'hash',
        triage: {
          meta: {
            version: '1.0.0',
            generated_at: '2026-02-24T00:00:00.000Z',
            phase2_ready: true,
            issue_count: 1,
            compute_time_ms: 10,
          },
          quick_ref: {
            open_count: 1,
            actionable_count: 1,
            blocked_count: 0,
            in_progress_count: 0,
            top_picks: [],
          },
          recommendations: [
            {
              id: 'task-42',
              title: 'Robot next task',
              status: 'open',
              priority: 2,
              score: 0.9,
              reasons: ['Top rank'],
              unblocks: 5,
              breakdown,
            },
          ],
        },
      };

      queueSpawnResponse({
        command: 'bv',
        stdout: JSON.stringify({
          generated_at: '2026-02-24T00:00:00.000Z',
          data_hash: 'hash',
          output_format: 'json',
          id: 'task-42',
          title: 'Robot next task',
          score: 0.9,
          reasons: ['Top rank'],
          unblocks: 5,
          claim_command: 'bd update task-42 --status in_progress',
          show_command: 'bd show task-42',
        }),
      });

      const result = await plugin.getNextTask();

      expect(result).toBeDefined();
      expect(result?.id).toBe('task-42');
      expect(result?.title).toBe('Robot next task');
      expect(result?.status).toBe('open');
      expect(result?.priority).toBe(2);
      expect(result?.metadata?.bvScore).toBe(0.9);
      expect(result?.metadata?.bvReasons).toEqual(['Top rank']);
      expect(result?.metadata?.bvUnblocks).toBe(5);
      expect(result?.metadata?.bvBreakdown).toEqual(breakdown);
    });

    test('falls back when bv pick is missing a configured label', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const fallbackTask: TrackerTask = {
        id: 'fallback-task',
        title: 'Label-scoped fallback task',
        status: 'open',
        priority: 2,
        labels: ['repo:site-djbclark', 'kind:feature'],
      };

      const state = plugin as unknown as {
        bvAvailable: boolean;
        labels: string[];
        scheduleTriageRefresh: () => void;
        getTask: (id: string) => Promise<TrackerTask | undefined>;
      };
      state.bvAvailable = true;
      state.labels = ['repo:site-djbclark', 'kind:feature'];
      state.scheduleTriageRefresh = () => {};
      state.getTask = async () => ({
        id: 'task-42',
        title: 'Robot next task',
        status: 'open',
        priority: 2,
        labels: ['repo:site-djbclark'],
      });
      queueRobotNextTask();

      await withTemporaryGetNextTaskStub(async () => fallbackTask, async () => {
        const result = await plugin.getNextTask();
        expect(result).toEqual(fallbackTask);
      });
    });

    test('returns bv metadata when the pick carries every configured label', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const state = plugin as unknown as {
        bvAvailable: boolean;
        labels: string[];
        scheduleTriageRefresh: () => void;
        getTask: (id: string) => Promise<TrackerTask | undefined>;
      };
      state.bvAvailable = true;
      state.labels = ['repo:site-djbclark', 'kind:feature'];
      state.scheduleTriageRefresh = () => {};
      state.getTask = async () => ({
        id: 'task-42',
        title: 'Robot next task',
        status: 'open',
        priority: 2,
        labels: ['repo:site-djbclark', 'kind:feature'],
      });
      queueRobotNextTask();

      const result = await plugin.getNextTask();

      expect(result?.id).toBe('task-42');
      expect(result?.metadata?.bvScore).toBe(0.9);
      expect(result?.metadata?.bvReasons).toEqual(['Top rank']);
      expect(result?.metadata?.bvUnblocks).toBe(5);
    });

    test('uses filter labels instead of configured labels for verification', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const state = plugin as unknown as {
        bvAvailable: boolean;
        labels: string[];
        scheduleTriageRefresh: () => void;
        getTask: (id: string) => Promise<TrackerTask | undefined>;
      };
      state.bvAvailable = true;
      state.labels = ['repo:site-configured'];
      state.scheduleTriageRefresh = () => {};
      state.getTask = async () => ({
        id: 'task-42',
        title: 'Robot next task',
        status: 'open',
        priority: 2,
        labels: ['repo:site-filter'],
      });
      queueRobotNextTask();

      const result = await plugin.getNextTask({
        labels: ['repo:site-filter'],
      });

      expect(result?.id).toBe('task-42');
      expect(result?.metadata?.bvScore).toBe(0.9);
    });

    test('falls back when the task cannot be fetched under a label scope', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const fallbackTask: TrackerTask = {
        id: 'fallback-task',
        title: 'Label-scoped fallback task',
        status: 'open',
        priority: 2,
      };

      const state = plugin as unknown as {
        bvAvailable: boolean;
        labels: string[];
        scheduleTriageRefresh: () => void;
        getTask: (id: string) => Promise<TrackerTask | undefined>;
      };
      state.bvAvailable = true;
      state.labels = ['repo:site-djbclark'];
      state.scheduleTriageRefresh = () => {};
      state.getTask = async () => undefined;
      queueRobotNextTask();

      await withTemporaryGetNextTaskStub(async () => fallbackTask, async () => {
        const result = await plugin.getNextTask();
        expect(result).toEqual(fallbackTask);
      });
    });

    test('reuses cached epic children between getNextTask calls', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      let epicChildrenCalls = 0;

      (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;
      (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => {};
      (plugin as unknown as { getTask: (id: string) => Promise<TrackerTask | undefined> }).getTask =
        async (_id: string) => undefined;
      (plugin as unknown as { getEpicChildrenIds: (epicId: string) => Promise<string[]> }).getEpicChildrenIds =
        async (_epicId: string) => {
          epicChildrenCalls += 1;
          return ['task-1'];
        };

      queueSpawnResponse({
        command: 'bv',
        stdout: JSON.stringify({
          generated_at: '2026-02-24T00:00:00.000Z',
          data_hash: 'hash-1',
          output_format: 'json',
          id: 'task-1',
          title: 'Cached epic child',
          score: 0.7,
          reasons: ['Top rank'],
          unblocks: 2,
          claim_command: 'bd update task-1 --status in_progress',
          show_command: 'bd show task-1',
        }),
      });
      queueSpawnResponse({
        command: 'bv',
        stdout: JSON.stringify({
          generated_at: '2026-02-24T00:00:01.000Z',
          data_hash: 'hash-2',
          output_format: 'json',
          id: 'task-1',
          title: 'Cached epic child',
          score: 0.71,
          reasons: ['Top rank'],
          unblocks: 2,
          claim_command: 'bd update task-1 --status in_progress',
          show_command: 'bd show task-1',
        }),
      });

      const first = await plugin.getNextTask({ parentId: 'epic-1' });
      const second = await plugin.getNextTask({ parentId: 'epic-1' });

      expect(first?.id).toBe('task-1');
      expect(second?.id).toBe('task-1');
      expect(epicChildrenCalls).toBe(1);
    });
  });

  describe('getTasks ordering', () => {
    test('unwraps an envelope from bd epic children output', async () => {
      const plugin = new BeadsBvTrackerPlugin();

      queueSpawnResponse({
        command: 'bd',
        stdout: JSON.stringify({
          schema_version: 1,
          data: [{ id: 'task-1' }, { id: 'task-2' }],
        }),
      });

      const children = await (
        plugin as unknown as {
          getEpicChildrenIds: (epicId: string) => Promise<string[]>;
        }
      ).getEpicChildrenIds('epic-1');

      expect(children).toEqual(['task-1', 'task-2']);
    });

    test('applies shared dotted child numeric ordering through parent beads tracker', async () => {
      const plugin = new BeadsBvTrackerPlugin();

      queueSpawnResponse({
        command: 'bd',
        stdout: JSON.stringify([
          { id: 'epic-5.12', title: 'Child 12', status: 'open', priority: 2 },
          { id: 'task-alpha', title: 'Non-child A', status: 'open', priority: 2 },
          { id: 'epic-5.2', title: 'Child 2', status: 'open', priority: 2 },
          { id: 'thing.xyz', title: 'Dotted non-numeric', status: 'open', priority: 2 },
          { id: 'epic-5.1', title: 'Child 1', status: 'open', priority: 2 },
          { id: 'task-beta', title: 'Non-child B', status: 'open', priority: 2 },
          { id: 'epic-5.9', title: 'Child 9', status: 'open', priority: 2 },
        ]),
      });

      const tasks = await plugin.getTasks();

      expect(tasks.map((t) => t.id)).toEqual([
        'epic-5.1',
        'task-alpha',
        'epic-5.2',
        'thing.xyz',
        'epic-5.9',
        'task-beta',
        'epic-5.12',
      ]);
    });
  });

  describe('scheduleTriageRefresh', () => {
    test('queues a forced refresh while a refresh is already in-flight', async () => {
      const plugin = new BeadsBvTrackerPlugin();
      const state = plugin as unknown as {
        bvAvailable: boolean;
        scheduleTriageRefresh: (force?: boolean) => void;
        refreshTriage: () => Promise<void>;
        triageRefreshInFlight: Promise<void> | null;
      };

      state.bvAvailable = true;

      let refreshCalls = 0;
      let releaseFirstRefresh!: () => void;
      const firstRefreshGate = new Promise<void>((resolve) => {
        releaseFirstRefresh = resolve;
      });

      state.refreshTriage = async () => {
        refreshCalls += 1;
        if (refreshCalls === 1) {
          await firstRefreshGate;
        }
      };

      state.scheduleTriageRefresh();
      state.scheduleTriageRefresh(true);

      expect(refreshCalls).toBe(1);
      expect(state.triageRefreshInFlight).not.toBeNull();

      releaseFirstRefresh();

      for (let i = 0; i < 20; i += 1) {
        if (refreshCalls === 2 && state.triageRefreshInFlight === null) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(refreshCalls).toBe(2);
      expect(state.triageRefreshInFlight).toBeNull();
    });
  });
});
