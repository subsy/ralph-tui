/**
 * ABOUTME: Tests for combining multiple tracker scopes into one Ralph execution view.
 * Covers task annotation, dedupe, scheduling order, external dependency blocking, and writes.
 */

import { describe, expect, test } from 'bun:test';
import { analyzeTaskGraph } from '../../parallel/task-graph.js';
import { BaseTrackerPlugin } from './base.js';
import {
  MultiScopeTrackerPlugin,
  createExecutionScopeFromTask,
} from './multi-scope.js';
import type {
  ExecutionScope,
  SetupQuestion,
  SyncResult,
  TaskCompletionResult,
  TaskFilter,
  TrackerPluginMeta,
  TrackerTask,
  TrackerTaskStatus,
} from './types.js';

const scopes: ExecutionScope[] = [
  { id: 'ui-epic', title: 'UI', type: 'epic' },
  { id: 'backend-epic', title: 'Backend', type: 'epic' },
];

function task(
  id: string,
  parentId: string,
  overrides: Partial<TrackerTask> = {}
): TrackerTask {
  return {
    id,
    parentId,
    title: id,
    status: 'open',
    priority: 2,
    ...overrides,
  };
}

class MockTracker extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'mock',
    name: 'Mock',
    description: 'Mock tracker',
    version: '1.0.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  completedTaskIds: string[] = [];
  statusUpdates: Array<{ id: string; status: TrackerTaskStatus }> = [];
  initializeConfigs: Record<string, unknown>[] = [];
  syncCount = 0;
  disposeCount = 0;

  constructor(
    private readonly tasks: TrackerTask[],
    private readonly epics: TrackerTask[] = scopes.map((scope) =>
      task(scope.id, '', { title: scope.title, type: 'epic' })
    )
  ) {
    super();
  }

  override async initialize(config: Record<string, unknown>): Promise<void> {
    this.initializeConfigs.push(config);
    await super.initialize(config);
  }

  override async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    return this.filterTasks(this.tasks, filter);
  }

  override async getTask(id: string): Promise<TrackerTask | undefined> {
    return [...this.tasks, ...this.epics].find((candidate) => candidate.id === id);
  }

  override async completeTask(id: string): Promise<TaskCompletionResult> {
    this.completedTaskIds.push(id);
    return { success: true, message: 'completed' };
  }

  override async updateTaskStatus(
    id: string,
    status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined> {
    this.statusUpdates.push({ id, status });
    const existing = this.tasks.find((candidate) => candidate.id === id);
    return existing ? { ...existing, status } : undefined;
  }

  override async sync(): Promise<SyncResult> {
    this.syncCount += 1;
    return { success: true, message: 'synced', syncedAt: '2026-05-13T00:00:00.000Z' };
  }

  override async isTaskReady(id: string): Promise<boolean> {
    const candidate = await this.getTask(id);
    return Boolean(candidate);
  }

  override async getEpics(): Promise<TrackerTask[]> {
    return this.epics;
  }

  override getSetupQuestions(): SetupQuestion[] {
    return [];
  }

  override async validateSetup(): Promise<string | null> {
    return null;
  }

  override async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}

describe('MultiScopeTrackerPlugin', () => {
  test('initializes the wrapped tracker with the provided config', async () => {
    const delegate = new MockTracker([]);
    const tracker = new MultiScopeTrackerPlugin(delegate, scopes);
    const config = { labels: ['frontend'] };

    await tracker.initialize(config);

    expect(delegate.initializeConfigs).toEqual([config]);
    expect(await tracker.isReady()).toBe(true);
  });

  test('creates execution scopes from tracker parent tasks and returns defensive scope copies', () => {
    const epicTask = task('epic-1', '', {
      title: 'Feature Epic',
      type: 'epic',
      description: 'Build the feature',
      metadata: { owner: 'team-a' },
    });

    expect(createExecutionScopeFromTask(epicTask)).toEqual({
      id: 'epic-1',
      title: 'Feature Epic',
      type: 'epic',
      description: 'Build the feature',
      metadata: { owner: 'team-a' },
    });

    const tracker = new MultiScopeTrackerPlugin(new MockTracker([]), scopes);
    const returnedScopes = tracker.getScopes();
    returnedScopes[0].title = 'Changed';

    expect(tracker.getScopes()[0].title).toBe('UI');
  });

  test('combines scoped tasks, annotates them, and deduplicates duplicate IDs', async () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => warnings.push(String(message));
    try {
      const delegate = new MockTracker([
        task('shared-task', 'ui-epic'),
        task('ui-task', 'ui-epic'),
        task('shared-task', 'backend-epic'),
        task('backend-task', 'backend-epic'),
      ]);
      const tracker = new MultiScopeTrackerPlugin(delegate, scopes);

      const tasks = await tracker.getTasks({ status: ['open', 'in_progress'] });

      expect(tasks.map((candidate) => candidate.id)).toEqual([
        'shared-task',
        'ui-task',
        'backend-task',
      ]);
      expect(tasks[0].executionScope?.id).toBe('ui-epic');
      expect(tasks[2].executionScope?.id).toBe('backend-epic');
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('fetches scoped task lists concurrently while preserving scope order', async () => {
    const startedScopes: string[] = [];
    const releaseFetches: Array<() => void> = [];
    const scopedTasks = [
      task('ui-task', 'ui-epic'),
      task('backend-task', 'backend-epic'),
    ];
    const delegate = new MockTracker(scopedTasks);
    delegate.getTasks = async (filter?: TaskFilter) => {
      startedScopes.push(String(filter?.parentId));
      await new Promise<void>((resolve) => releaseFetches.push(resolve));
      return scopedTasks.filter((candidate) => candidate.parentId === filter?.parentId);
    };
    const tracker = new MultiScopeTrackerPlugin(delegate, scopes);

    const taskPromise = tracker.getTasks();
    await Promise.resolve();

    expect(startedScopes).toEqual(['ui-epic', 'backend-epic']);

    for (const release of releaseFetches) release();
    const tasks = await taskPromise;

    expect(tasks.map((candidate) => candidate.id)).toEqual(['ui-task', 'backend-task']);
  });

  test('getNextTask picks lowest priority, then stable scope order, then task id', async () => {
    const delegate = new MockTracker([
      task('z-ui', 'ui-epic', { priority: 1 }),
      task('a-backend', 'backend-epic', { priority: 1 }),
      task('critical-backend', 'backend-epic', { priority: 0 }),
    ]);
    const tracker = new MultiScopeTrackerPlugin(delegate, scopes);

    expect((await tracker.getNextTask())?.id).toBe('critical-backend');

    const equalPriorityDelegate = new MockTracker([
      task('z-ui', 'ui-epic', { priority: 1 }),
      task('a-backend', 'backend-epic', { priority: 1 }),
    ]);
    const equalPriorityTracker = new MultiScopeTrackerPlugin(equalPriorityDelegate, scopes);

    expect((await equalPriorityTracker.getNextTask())?.id).toBe('z-ui');
  });

  test('preserves cross-epic dependencies for one global task graph', async () => {
    const delegate = new MockTracker([
      task('ui-foundation', 'ui-epic'),
      task('backend-after-ui', 'backend-epic', { dependsOn: ['ui-foundation'] }),
    ]);
    const tracker = new MultiScopeTrackerPlugin(delegate, scopes);

    const analysis = analyzeTaskGraph(await tracker.getTasks({ status: ['open', 'in_progress'] }));

    expect(analysis.groups).toHaveLength(2);
    expect(analysis.groups[0].tasks.map((candidate) => candidate.id)).toEqual(['ui-foundation']);
    expect(analysis.groups[1].tasks.map((candidate) => candidate.id)).toEqual(['backend-after-ui']);
  });

  test('excludes tasks with unresolved external dependencies from scheduling', async () => {
    const delegate = new MockTracker([
      task('blocked-by-external', 'ui-epic', { dependsOn: ['external-task'] }),
      task('ready-backend', 'backend-epic'),
    ]);
    const tracker = new MultiScopeTrackerPlugin(delegate, scopes);

    const schedulable = await tracker.getTasks({ status: ['open', 'in_progress'] });
    expect(schedulable.map((candidate) => candidate.id)).toEqual(['ready-backend']);
    expect(await tracker.getNextTask()).toMatchObject({ id: 'ready-backend' });

    const displayTasks = await tracker.getTasks({ status: ['open', 'in_progress', 'completed'] });
    const blocked = displayTasks.find((candidate) => candidate.id === 'blocked-by-external');
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.metadata?.externalDependencyBlocked).toBe(true);
    expect(tracker.getExternalBlockedTaskIds()).toEqual(['blocked-by-external']);
  });

  test('delegates writes, sync, dispose, and completion checks', async () => {
    const delegate = new MockTracker([
      task('done-ui', 'ui-epic', { status: 'completed' }),
      task('done-backend', 'backend-epic', { status: 'completed' }),
    ]);
    const tracker = new MultiScopeTrackerPlugin(delegate, scopes);

    await tracker.completeTask('done-ui', 'done');
    await tracker.updateTaskStatus('done-backend', 'open');
    await tracker.sync();
    expect(await tracker.isComplete()).toBe(true);
    await tracker.dispose();

    expect(delegate.completedTaskIds).toEqual(['done-ui']);
    expect(delegate.statusUpdates).toEqual([{ id: 'done-backend', status: 'open' }]);
    expect(delegate.syncCount).toBe(1);
    expect(delegate.disposeCount).toBe(1);
  });
});
