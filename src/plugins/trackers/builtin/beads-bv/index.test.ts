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

      const originalGetNextTask = BeadsTrackerPlugin.prototype.getNextTask;
      BeadsTrackerPlugin.prototype.getNextTask = async () => fallbackTask;

      try {
        const result = await plugin.getNextTask();
        expect(result).toEqual(fallbackTask);
      } finally {
        BeadsTrackerPlugin.prototype.getNextTask = originalGetNextTask;
      }
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

      const originalGetNextTask = BeadsTrackerPlugin.prototype.getNextTask;
      BeadsTrackerPlugin.prototype.getNextTask = async () => fallbackTask;

      try {
        const result = await plugin.getNextTask({ parentId: 'epic-1' });
        expect(result).toEqual(fallbackTask);
      } finally {
        BeadsTrackerPlugin.prototype.getNextTask = originalGetNextTask;
      }
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
  });
});
