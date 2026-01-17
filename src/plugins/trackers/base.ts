/**
 * ABOUTME: Abstract base class for tracker plugins.
 * Provides common functionality and default implementations that plugins can override.
 * Plugins can extend this class to reduce boilerplate.
 */

import type {
  TrackerPlugin,
  TrackerPluginMeta,
  TrackerTask,
  TrackerTaskStatus,
  TaskFilter,
  TaskCompletionResult,
  SyncResult,
  SetupQuestion,
} from './types.js';

/**
 * Abstract base class for tracker plugins.
 * Provides sensible defaults and utility methods.
 */
export abstract class BaseTrackerPlugin implements TrackerPlugin {
  abstract readonly meta: TrackerPluginMeta;

  protected config: Record<string, unknown> = {};
  protected ready = false;

  /**
   * Initialize the plugin with configuration.
   * Subclasses should call super.initialize(config) and then perform their own setup.
   */
  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config;
    this.ready = true;
  }

  /**
   * Check if the plugin is ready.
   * Subclasses can override to add additional readiness checks.
   */
  async isReady(): Promise<boolean> {
    return this.ready;
  }

  /**
   * Get all tasks matching the filter.
   * Must be implemented by subclasses.
   */
  abstract getTasks(filter?: TaskFilter): Promise<TrackerTask[]>;

  /**
   * Get a single task by ID.
   * Default implementation fetches all tasks and finds by ID.
   * Subclasses should override for efficiency.
   */
  async getTask(id: string): Promise<TrackerTask | undefined> {
    const tasks = await this.getTasks();
    return tasks.find((t) => t.id === id);
  }

  /**
   * Get the next task to work on.
   * Default implementation:
   * 1. Gets all open/in_progress tasks
   * 2. Filters to ready tasks (no unresolved dependencies)
   * 3. Sorts by priority (lowest number = highest priority)
   * 4. Returns the first one
   */
  async getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined> {
    const mergedFilter: TaskFilter = {
      ...filter,
      status: ['open', 'in_progress'],
      ready: true,
    };

    const tasks = await this.getTasks(mergedFilter);

    if (tasks.length === 0) {
      return undefined;
    }

    // Sort by priority (0 = highest priority)
    tasks.sort((a, b) => a.priority - b.priority);

    // Prefer in_progress tasks over open tasks
    const inProgress = tasks.find((t) => t.status === 'in_progress');
    if (inProgress) {
      return inProgress;
    }

    return tasks[0];
  }

  /**
   * Mark a task as completed.
   * Must be implemented by subclasses.
   */
  abstract completeTask(
    id: string,
    reason?: string
  ): Promise<TaskCompletionResult>;

  /**
   * Update a task's status.
   * Must be implemented by subclasses.
   */
  abstract updateTaskStatus(
    id: string,
    status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined>;

  /**
   * Check if all tasks matching the filter are complete.
   */
  async isComplete(filter?: TaskFilter): Promise<boolean> {
    const tasks = await this.getTasks(filter);
    return tasks.every(
      (t) => t.status === 'completed' || t.status === 'cancelled'
    );
  }

  /**
   * Sync with the tracker backend.
   * Default implementation is a no-op (for read-only trackers).
   * Subclasses that support sync should override.
   */
  async sync(): Promise<SyncResult> {
    return {
      success: true,
      message: 'Sync not required for this tracker',
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Check if a specific task is ready to work on.
   * Default implementation fetches all tasks and checks dependencies.
   * Subclasses can override for efficiency.
   */
  async isTaskReady(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task) {
      return false;
    }

    const allTasks = await this.getTasks();
    return this.checkTaskReady(task, allTasks);
  }

  /**
   * Get all available epics (top-level task containers).
   * Default implementation fetches tasks with type='epic' and no parent.
   * Subclasses can override for more efficient implementation.
   */
  async getEpics(): Promise<TrackerTask[]> {
    const tasks = await this.getTasks({ type: 'epic' });
    // Filter to only top-level epics (no parent)
    return tasks.filter((t) => !t.parentId);
  }

  /**
   * Get setup questions for configuring this plugin.
   * Subclasses should override to provide their specific questions.
   */
  getSetupQuestions(): SetupQuestion[] {
    return [];
  }

  /**
   * Validate setup answers.
   * Default implementation accepts all answers.
   * Subclasses should override for validation.
   */
  async validateSetup(
    _answers: Record<string, unknown>
  ): Promise<string | null> {
    return null;
  }

  /**
   * Clean up resources.
   * Subclasses can override to clean up connections, file handles, etc.
   */
  async dispose(): Promise<void> {
    this.ready = false;
  }

  /**
   * Helper: Filter tasks by the given criteria.
   * Useful for subclasses implementing getTasks.
   */
  protected filterTasks(
    tasks: TrackerTask[],
    filter?: TaskFilter
  ): TrackerTask[] {
    if (!filter) {
      return tasks;
    }

    let result = tasks;

    // Filter by status
    if (filter.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      result = result.filter((t) => statuses.includes(t.status));
    }

    // Filter by labels (AND logic - must have all labels)
    if (filter.labels && filter.labels.length > 0) {
      result = result.filter((t) =>
        filter.labels!.every((label) => t.labels?.includes(label))
      );
    }

    // Filter by priority
    if (filter.priority !== undefined) {
      const priorities = Array.isArray(filter.priority)
        ? filter.priority
        : [filter.priority];
      result = result.filter((t) => priorities.includes(t.priority));
    }

    // Filter by parent ID
    if (filter.parentId) {
      result = result.filter((t) => t.parentId === filter.parentId);
    }

    // Filter by assignee
    if (filter.assignee) {
      result = result.filter((t) => t.assignee === filter.assignee);
    }

    // Filter by type
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      result = result.filter((t) => t.type && types.includes(t.type));
    }

    // Exclude specific task IDs (used for skipped/failed tasks)
    if (filter.excludeIds && filter.excludeIds.length > 0) {
      const excludeSet = new Set(filter.excludeIds);
      result = result.filter((t) => !excludeSet.has(t.id));
    }

    // Filter to ready tasks (no unresolved dependencies)
    if (filter.ready) {
      result = result.filter((t) => this.checkTaskReady(t, tasks));
    }

    // Apply offset
    if (filter.offset && filter.offset > 0) {
      result = result.slice(filter.offset);
    }

    // Apply limit
    if (filter.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * Helper: Check if a task is ready (all dependencies resolved).
   * Used internally for filtering and readiness checks.
   */
  protected checkTaskReady(task: TrackerTask, allTasks: TrackerTask[]): boolean {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return true;
    }

    // Task is ready if all dependencies are completed or cancelled
    return task.dependsOn.every((depId) => {
      const depTask = allTasks.find((t) => t.id === depId);
      return (
        !depTask ||
        depTask.status === 'completed' ||
        depTask.status === 'cancelled'
      );
    });
  }
}
