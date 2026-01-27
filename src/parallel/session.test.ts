/**
 * ABOUTME: Tests for parallel session state persistence.
 * Verifies creation, save/load round-trip (including Map serialization),
 * deletion, state update functions, and orphaned worktree detection.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createParallelSession,
  saveParallelSession,
  loadParallelSession,
  deleteParallelSession,
  hasParallelSession,
  updateSessionAfterGroup,
  markTaskRequeued,
  findOrphanedWorktrees,
} from './session.js';
import type { TaskGraphAnalysis } from './types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';

/** Create a temp directory for each test */
function createTempDir(): string {
  const dir = path.join(
    '/tmp',
    `ralph-test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a minimal TaskGraphAnalysis for testing */
function createMockGraph(taskIds: string[]): TaskGraphAnalysis {
  const tasks: TrackerTask[] = taskIds.map((id) => ({
    id,
    title: `Task ${id}`,
    status: 'open' as const,
    priority: 2 as const,
  }));

  const nodes = new Map(
    tasks.map((t) => [
      t.id,
      {
        task: t,
        dependencies: [],
        dependents: [],
        depth: 0,
        inCycle: false,
      },
    ])
  );

  return {
    nodes,
    groups: [
      {
        index: 0,
        tasks,
        depth: 0,
        maxPriority: 2,
      },
    ],
    cyclicTaskIds: [],
    actionableTaskCount: tasks.length,
    maxParallelism: tasks.length,
    recommendParallel: tasks.length >= 3,
  };
}

describe('session persistence', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createParallelSession', () => {
    test('creates a session with correct initial values', () => {
      const graph = createMockGraph(['A', 'B', 'C']);
      const session = createParallelSession('test-session', graph, 'ralph/session-start/test');

      expect(session.sessionId).toBe('test-session');
      expect(session.taskGraph).toBe(graph);
      expect(session.lastCompletedGroupIndex).toBe(-1);
      expect(session.mergedTaskIds).toHaveLength(0);
      expect(session.failedTaskIds).toHaveLength(0);
      expect(session.requeuedTaskIds).toHaveLength(0);
      expect(session.sessionStartTag).toBe('ralph/session-start/test');
      expect(session.startedAt).toBeTruthy();
      expect(session.lastUpdatedAt).toBeTruthy();
    });
  });

  describe('save/load round-trip', () => {
    test('preserves session state through save and load', async () => {
      const graph = createMockGraph(['A', 'B', 'C']);
      const session = createParallelSession('roundtrip-test', graph, 'ralph/session-start/rt');

      // Save to disk
      await saveParallelSession(tempDir, session);

      // Load from disk
      const loaded = await loadParallelSession(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe('roundtrip-test');
      expect(loaded!.lastCompletedGroupIndex).toBe(-1);
      expect(loaded!.sessionStartTag).toBe('ralph/session-start/rt');
    });

    test('correctly serializes and deserializes the Map in TaskGraphAnalysis', async () => {
      const graph = createMockGraph(['X', 'Y']);
      const session = createParallelSession('map-test', graph, 'tag');

      await saveParallelSession(tempDir, session);
      const loaded = await loadParallelSession(tempDir);

      // The nodes Map should be restored correctly
      expect(loaded!.taskGraph.nodes).toBeInstanceOf(Map);
      expect(loaded!.taskGraph.nodes.size).toBe(2);
      expect(loaded!.taskGraph.nodes.get('X')).toBeTruthy();
      expect(loaded!.taskGraph.nodes.get('Y')).toBeTruthy();
      expect(loaded!.taskGraph.nodes.get('X')!.task.id).toBe('X');
    });

    test('preserves graph metadata through round-trip', async () => {
      const graph = createMockGraph(['A', 'B', 'C']);
      const session = createParallelSession('meta-test', graph, 'tag');

      await saveParallelSession(tempDir, session);
      const loaded = await loadParallelSession(tempDir);

      expect(loaded!.taskGraph.groups).toHaveLength(1);
      expect(loaded!.taskGraph.actionableTaskCount).toBe(3);
      expect(loaded!.taskGraph.maxParallelism).toBe(3);
      expect(loaded!.taskGraph.cyclicTaskIds).toHaveLength(0);
    });
  });

  describe('hasParallelSession', () => {
    test('returns false when no session exists', async () => {
      const exists = await hasParallelSession(tempDir);
      expect(exists).toBe(false);
    });

    test('returns true after saving a session', async () => {
      const graph = createMockGraph(['A']);
      const session = createParallelSession('has-test', graph, 'tag');
      await saveParallelSession(tempDir, session);

      const exists = await hasParallelSession(tempDir);
      expect(exists).toBe(true);
    });
  });

  describe('deleteParallelSession', () => {
    test('removes the session file', async () => {
      const graph = createMockGraph(['A']);
      const session = createParallelSession('del-test', graph, 'tag');
      await saveParallelSession(tempDir, session);

      expect(await hasParallelSession(tempDir)).toBe(true);

      await deleteParallelSession(tempDir);

      expect(await hasParallelSession(tempDir)).toBe(false);
    });

    test('does not throw if no session exists', async () => {
      // Should not throw
      await deleteParallelSession(tempDir);
    });
  });

  describe('loadParallelSession', () => {
    test('returns null when no session file exists', async () => {
      const loaded = await loadParallelSession(tempDir);
      expect(loaded).toBeNull();
    });
  });
});

describe('session state updates', () => {
  test('updateSessionAfterGroup appends merged and failed task IDs', () => {
    const graph = createMockGraph(['A', 'B', 'C']);
    const session = createParallelSession('update-test', graph, 'tag');

    const updated = updateSessionAfterGroup(session, 0, ['A', 'B'], ['C']);

    expect(updated.lastCompletedGroupIndex).toBe(0);
    expect(updated.mergedTaskIds).toEqual(['A', 'B']);
    expect(updated.failedTaskIds).toEqual(['C']);
    expect(typeof updated.lastUpdatedAt).toBe('string');
  });

  test('updateSessionAfterGroup accumulates across multiple calls', () => {
    const graph = createMockGraph(['A', 'B', 'C', 'D']);
    let session = createParallelSession('accum-test', graph, 'tag');

    session = updateSessionAfterGroup(session, 0, ['A'], []);
    session = updateSessionAfterGroup(session, 1, ['B', 'C'], ['D']);

    expect(session.lastCompletedGroupIndex).toBe(1);
    expect(session.mergedTaskIds).toEqual(['A', 'B', 'C']);
    expect(session.failedTaskIds).toEqual(['D']);
  });

  test('markTaskRequeued appends the task ID', () => {
    const graph = createMockGraph(['A', 'B']);
    const session = createParallelSession('requeue-test', graph, 'tag');

    const updated = markTaskRequeued(session, 'A');

    expect(updated.requeuedTaskIds).toEqual(['A']);
    expect(typeof updated.lastUpdatedAt).toBe('string');
  });

  test('markTaskRequeued accumulates across multiple calls', () => {
    const graph = createMockGraph(['A', 'B']);
    let session = createParallelSession('multi-requeue', graph, 'tag');

    session = markTaskRequeued(session, 'A');
    session = markTaskRequeued(session, 'B');

    expect(session.requeuedTaskIds).toEqual(['A', 'B']);
  });
});

describe('findOrphanedWorktrees', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns empty array when worktree directory does not exist', () => {
    const orphans = findOrphanedWorktrees(tempDir, 'nonexistent');
    expect(orphans).toHaveLength(0);
  });

  test('returns empty array when worktree directory is empty', () => {
    const worktreeDir = '.ralph-tui/worktrees';
    fs.mkdirSync(path.join(tempDir, worktreeDir), { recursive: true });

    const orphans = findOrphanedWorktrees(tempDir, worktreeDir);
    expect(orphans).toHaveLength(0);
  });

  test('detects orphaned worktree directories', () => {
    const worktreeDir = '.ralph-tui/worktrees';
    const basePath = path.join(tempDir, worktreeDir);
    fs.mkdirSync(path.join(basePath, 'worker-1'), { recursive: true });
    fs.mkdirSync(path.join(basePath, 'worker-2'), { recursive: true });

    const orphans = findOrphanedWorktrees(tempDir, worktreeDir);
    expect(orphans).toHaveLength(2);
    expect(orphans.map((p) => path.basename(p)).sort()).toEqual([
      'worker-1',
      'worker-2',
    ]);
  });

  test('ignores files (only returns directories)', () => {
    const worktreeDir = '.ralph-tui/worktrees';
    const basePath = path.join(tempDir, worktreeDir);
    fs.mkdirSync(basePath, { recursive: true });
    fs.writeFileSync(path.join(basePath, 'stale-file.txt'), 'content');
    fs.mkdirSync(path.join(basePath, 'worker-1'));

    const orphans = findOrphanedWorktrees(tempDir, worktreeDir);
    expect(orphans).toHaveLength(1);
    expect(path.basename(orphans[0])).toBe('worker-1');
  });
});
