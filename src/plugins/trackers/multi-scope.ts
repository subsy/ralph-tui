/**
 * ABOUTME: Tracker wrapper for running one Ralph session across multiple execution scopes.
 * Combines tasks from selected epics while keeping all writes delegated to the underlying tracker.
 */

import { BaseTrackerPlugin } from './base.js';
import type {
  ExecutionScope,
  ScopedTrackerTask,
  SetupQuestion,
  SyncResult,
  TaskCompletionResult,
  TaskFilter,
  TrackerPlugin,
  TrackerPluginMeta,
  TrackerTask,
  TrackerTaskStatus,
} from './types.js';

/**
 * Convert a tracker task representing an epic/parent into an execution scope.
 */
export function createExecutionScopeFromTask(task: TrackerTask): ExecutionScope {
  return {
    id: task.id,
    title: task.title,
    type: task.type === 'prd' ? 'prd' : 'epic',
    description: task.description,
    metadata: task.metadata,
  };
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'cancelled';
}

function mergeFilterForScope(filter: TaskFilter | undefined, scope: ExecutionScope): TaskFilter {
  return {
    ...filter,
    parentId: scope.id,
  };
}

/**
 * Wraps a tracker so multiple parent epics behave like one tracker scope.
 */
export class MultiScopeTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta;

  private readonly delegate: TrackerPlugin;
  private readonly scopes: ExecutionScope[];
  private readonly scopeIndexById: Map<string, number>;
  private warnedDuplicateIds = new Set<string>();
  private externalBlockedIds = new Set<string>();

  constructor(delegate: TrackerPlugin, scopes: ExecutionScope[]) {
    super();
    this.delegate = delegate;
    this.scopes = scopes;
    this.scopeIndexById = new Map(scopes.map((scope, index) => [scope.id, index]));
    this.meta = {
      ...delegate.meta,
      id: `${delegate.meta.id}-multi-scope`,
      name: `${delegate.meta.name} (Multi-Epic)`,
      description: `Multi-epic wrapper for ${delegate.meta.name}`,
    };
    this.ready = true;
  }

  /**
   * Return the selected execution scopes.
   */
  getScopes(): ExecutionScope[] {
    return this.scopes.map((scope) => ({ ...scope }));
  }

  /**
   * Return task IDs blocked by unresolved dependencies outside selected scopes.
   */
  getExternalBlockedTaskIds(): string[] {
    return [...this.externalBlockedIds];
  }

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await this.delegate.initialize(config);
    this.ready = await this.delegate.isReady();
  }

  override async isReady(): Promise<boolean> {
    return this.delegate.isReady();
  }

  override async getTasks(filter?: TaskFilter): Promise<ScopedTrackerTask[]> {
    const combined: ScopedTrackerTask[] = [];
    const seenTaskIds = new Set<string>();
    const scopedTaskLists = await Promise.all(
      this.scopes.map((scope) => this.delegate.getTasks(mergeFilterForScope(filter, scope)))
    );

    for (let index = 0; index < this.scopes.length; index++) {
      const scope = this.scopes[index]!;
      const scopedTasks = scopedTaskLists[index]!;
      for (const task of scopedTasks) {
        if (seenTaskIds.has(task.id)) {
          if (!this.warnedDuplicateIds.has(task.id)) {
            this.warnedDuplicateIds.add(task.id);
            console.warn(
              `Warning: task ${task.id} appears in multiple selected epics; using first occurrence.`
            );
          }
          continue;
        }
        seenTaskIds.add(task.id);
        combined.push({
          ...task,
          executionScope: scope,
          metadata: {
            ...task.metadata,
            executionScope: scope,
          },
        });
      }
    }

    const resolved = await this.applyExternalDependencyStatus(combined);
    const filtered = this.filterTasks(resolved, filter) as ScopedTrackerTask[];

    if (!filter?.status) {
      return filtered;
    }

    const requestedStatuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!requestedStatuses.includes('completed')) {
      return filtered;
    }

    const filteredIds = new Set(filtered.map((task) => task.id));
    return [
      ...filtered,
      ...resolved.filter((task) =>
        task.metadata?.externalDependencyBlocked === true && !filteredIds.has(task.id)
      ),
    ];
  }

  override async getTask(id: string): Promise<ScopedTrackerTask | undefined> {
    for (const scope of this.scopes) {
      const tasks = await this.delegate.getTasks({ parentId: scope.id });
      const match = tasks.find((task) => task.id === id);
      if (match) {
        return {
          ...match,
          executionScope: scope,
          metadata: {
            ...match.metadata,
            executionScope: scope,
          },
        };
      }
    }

    const task = await this.delegate.getTask(id);
    return task ? { ...task } : undefined;
  }

  override async getNextTask(filter?: TaskFilter): Promise<ScopedTrackerTask | undefined> {
    const tasks = await this.getTasks({
      ...filter,
      status: ['open', 'in_progress'],
      ready: true,
    });

    if (tasks.length === 0) {
      return undefined;
    }

    return [...tasks].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const aScope = this.scopeIndexById.get(a.executionScope?.id ?? '') ?? Number.MAX_SAFE_INTEGER;
      const bScope = this.scopeIndexById.get(b.executionScope?.id ?? '') ?? Number.MAX_SAFE_INTEGER;
      if (aScope !== bScope) {
        return aScope - bScope;
      }
      return a.id.localeCompare(b.id);
    })[0];
  }

  override async completeTask(
    id: string,
    reason?: string
  ): Promise<TaskCompletionResult> {
    return this.delegate.completeTask(id, reason);
  }

  override async updateTaskStatus(
    id: string,
    status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined> {
    return this.delegate.updateTaskStatus(id, status);
  }

  override async isComplete(filter?: TaskFilter): Promise<boolean> {
    const tasks = await this.getTasks(filter);
    return tasks.length > 0 && tasks.every((task) => isTerminalStatus(task.status));
  }

  override async sync(): Promise<SyncResult> {
    return this.delegate.sync();
  }

  override async isTaskReady(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task) {
      return false;
    }
    const tasks = await this.getTasks();
    return !this.externalBlockedIds.has(id) && this.checkTaskReady(task, tasks);
  }

  override async getEpics(): Promise<TrackerTask[]> {
    return this.delegate.getEpics();
  }

  override getSetupQuestions(): SetupQuestion[] {
    return this.delegate.getSetupQuestions();
  }

  override async validateSetup(answers: Record<string, unknown>): Promise<string | null> {
    return this.delegate.validateSetup(answers);
  }

  override async dispose(): Promise<void> {
    await this.delegate.dispose();
    this.ready = false;
  }

  override getTemplate(): string {
    return this.delegate.getTemplate();
  }

  async getPrdContext(): Promise<{
    name: string;
    description?: string;
    content: string;
    completedCount: number;
    totalCount: number;
  } | null> {
    return this.delegate.getPrdContext?.() ?? null;
  }

  getStateFiles(): string[] {
    return this.delegate.getStateFiles?.() ?? [];
  }

  getConfiguredLabels(): string[] {
    const delegateWithLabels = this.delegate as { getConfiguredLabels?: () => string[] };
    return delegateWithLabels.getConfiguredLabels?.() ?? [];
  }

  private async applyExternalDependencyStatus(
    tasks: ScopedTrackerTask[]
  ): Promise<ScopedTrackerTask[]> {
    const selectedTaskIds = new Set(tasks.map((task) => task.id));
    const externalStatusCache = new Map<string, string | undefined>();
    const externalBlockedIds = new Set<string>();

    for (const task of tasks) {
      for (const depId of task.dependsOn ?? []) {
        if (selectedTaskIds.has(depId)) {
          continue;
        }

        if (!externalStatusCache.has(depId)) {
          const depTask = await this.delegate.getTask(depId);
          externalStatusCache.set(depId, depTask?.status);
        }

        if (!isTerminalStatus(externalStatusCache.get(depId))) {
          externalBlockedIds.add(task.id);
          break;
        }
      }
    }

    this.externalBlockedIds = externalBlockedIds;
    return tasks.map((task) => {
      if (!externalBlockedIds.has(task.id)) {
        return task;
      }
      return {
        ...task,
        status: 'blocked',
        metadata: {
          ...task.metadata,
          externalDependencyBlocked: true,
          originalStatus: task.status,
        },
      };
    });
  }
}
