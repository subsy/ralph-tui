/**
 * ABOUTME: Linear tracker plugin for ralph-tui run/execution loop.
 * Enables Ralph to run work directly from Linear child issues under a parent
 * issue, with status/dependency awareness and priority ordering via Ralph
 * Metadata embedded in issue bodies.
 */

import { BaseTrackerPlugin } from '../../base.js';
import {
  createLinearClient,
  LinearApiError,
  type LinearIssueSnapshot,
  type RalphLinearClient,
  type WorkflowStateSummary,
} from './client.js';
import {
  parseStoryIssueBody,
  DEFAULT_RALPH_PRIORITY,
} from './body.js';
import type {
  TaskCompletionResult,
  TaskFilter,
  TaskPriority,
  TrackerPluginFactory,
  TrackerPluginMeta,
  TrackerTask,
  TrackerTaskStatus,
  SyncResult,
} from '../../types.js';

/**
 * How long fetched child issues are reused before refetching. The engine and TUI
 * call getTasks several times per iteration; this collapses those bursts into a
 * single API request while still picking up external edits within seconds.
 */
const CHILD_CACHE_TTL_MS = 5_000;

/**
 * Map a Linear workflow state type to TrackerTaskStatus.
 * Linear state types: "triage", "backlog", "unstarted", "started", "completed", "canceled".
 */
function mapLinearStateToStatus(stateType: string): TrackerTaskStatus {
  switch (stateType) {
    case 'started':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'cancelled';
    case 'triage':
    case 'backlog':
    case 'unstarted':
    default:
      return 'open';
  }
}

/**
 * Map a TrackerTaskStatus to the Linear workflow state type to search for.
 */
function mapStatusToLinearStateType(status: TrackerTaskStatus): string {
  switch (status) {
    case 'in_progress':
      return 'started';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'canceled';
    case 'open':
    case 'blocked':
    default:
      return 'unstarted';
  }
}

/**
 * Clamp an unbounded ralphPriority to coarse TrackerTask.priority (0–4).
 * Formula per PRD: Math.min(4, Math.max(0, ralphPriority - 1))
 */
function clampPriority(ralphPriority: number): TaskPriority {
  return Math.min(4, Math.max(0, ralphPriority - 1)) as TaskPriority;
}

/**
 * Convert a Linear issue snapshot into a TrackerTask.
 * Parses the issue body for Ralph metadata (priority, description, acceptance criteria).
 * `siblingIdentifiers` maps sibling UUIDs to identifiers; blockers outside the
 * sibling set are ignored.
 */
function linearIssueToTask(
  issue: LinearIssueSnapshot,
  siblingIdentifiers: Map<string, string>,
): TrackerTask {
  const status = mapLinearStateToStatus(issue.stateType ?? 'unstarted');

  const parsed = parseStoryIssueBody(issue.description ?? '');
  const ralphPriority = parsed.ralphPriority;

  const metadata: Record<string, unknown> = {
    ralphPriority,
    linearIdentifier: issue.identifier,
    linearUrl: issue.url,
  };

  if (parsed.storyId) {
    metadata.storyId = parsed.storyId;
  }

  if (parsed.acceptanceCriteria.length > 0) {
    metadata.acceptanceCriteria = parsed.acceptanceCriteria;
  }

  const blockingIdentifiers = issue.blockedByIds
    .map((uuid) => siblingIdentifiers.get(uuid))
    .filter((id): id is string => id !== undefined);

  return {
    id: issue.identifier,
    title: issue.title,
    status,
    priority: clampPriority(ralphPriority),
    description: parsed.description || issue.description || undefined,
    labels: issue.labels.length > 0 ? [...issue.labels] : undefined,
    type: 'task',
    parentId: issue.parentIdentifier ?? undefined,
    dependsOn: blockingIdentifiers.length > 0 ? blockingIdentifiers : undefined,
    assignee: issue.assigneeName ?? undefined,
    createdAt: new Date(issue.createdAt).toISOString(),
    updatedAt: new Date(issue.updatedAt).toISOString(),
    metadata,
  };
}

/**
 * Count children that are done (completed or canceled).
 */
function countCompletedChildren(children: LinearIssueSnapshot[]): number {
  return children.filter(
    (c) => c.stateType === 'completed' || c.stateType === 'canceled',
  ).length;
}

/**
 * Linear tracker plugin implementation.
 * Runs work from Linear child issues under a configured parent issue.
 */
export class LinearTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'linear',
    name: 'Linear Issue Tracker',
    description: 'Track issues using Linear API with parent/child hierarchy',
    version: '1.0.0',
    supportsBidirectionalSync: false,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  private client!: RalphLinearClient;
  private epicId: string = '';
  private teamId: string = '';

  /** Cache of workflow states per team to avoid repeated API calls. */
  private workflowStatesCache: WorkflowStateSummary[] | null = null;

  /** Short-lived cache of child issue snapshots, keyed by parent ID. */
  private childCache = new Map<
    string,
    { expiresAt: number; snapshots: Promise<LinearIssueSnapshot[]> }
  >();

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);
    this.invalidateChildCache();
    this.workflowStatesCache = null;
    this.teamId = '';

    if (typeof config.epicId === 'string' && config.epicId) {
      this.epicId = config.epicId;
    }

    try {
      this.client = createLinearClient(config);
    } catch (err) {
      this.ready = false;
      if (err instanceof LinearApiError) {
        console.error(`Linear tracker initialization failed: ${err.message}`);
      }
      return;
    }

    // Resolve the team from the epic issue so we can look up workflow states
    if (this.epicId) {
      try {
        const epicIssue = await this.client.getIssueSnapshot(this.epicId);
        if (epicIssue.teamId) {
          this.teamId = epicIssue.teamId;
        }
      } catch (err) {
        this.ready = false;
        const message = err instanceof LinearApiError ? err.message : String(err);
        console.error(`Linear tracker: failed to resolve epic "${this.epicId}": ${message}`);
        return;
      }
    }

    this.ready = true;
  }

  setEpicId(epicId: string): void {
    this.epicId = epicId;
    // Reset caches when epic changes since team may differ
    this.workflowStatesCache = null;
    this.invalidateChildCache();
  }

  getEpicId(): string {
    return this.epicId;
  }

  /**
   * Get child issue snapshots for a parent, reusing a recent fetch when possible.
   * Concurrent callers share the same in-flight request.
   */
  private getChildSnapshots(parentId: string): Promise<LinearIssueSnapshot[]> {
    const now = Date.now();
    const cached = this.childCache.get(parentId);
    if (cached && cached.expiresAt > now) {
      return cached.snapshots;
    }

    const entry: { expiresAt: number; snapshots: Promise<LinearIssueSnapshot[]> } = {
      expiresAt: Infinity,
      snapshots: this.client.getChildIssueSnapshots(parentId).then((children) => {
        if (this.childCache.get(parentId) !== entry) {
          return this.getChildSnapshots(parentId);
        }
        entry.expiresAt = Date.now() + CHILD_CACHE_TTL_MS;
        return children;
      }).catch((err: unknown) => {
        if (this.childCache.get(parentId) === entry) {
          this.childCache.delete(parentId);
        }
        throw err;
      }),
    };
    this.childCache.set(parentId, entry);
    return entry.snapshots;
  }

  /**
   * Drop cached child snapshots so the next read reflects our own writes.
   */
  private invalidateChildCache(): void {
    this.childCache.clear();
  }

  override async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    const parentId = filter?.parentId ?? this.epicId;
    if (!parentId) {
      return [];
    }

    const children = await this.getChildSnapshots(parentId);
    const siblingIdentifiers = new Map(children.map((c) => [c.id, c.identifier]));
    const tasks = children.map((child) => linearIssueToTask(child, siblingIdentifiers));

    return this.filterTasks(tasks, filter ? { ...filter, parentId: undefined } : undefined);
  }

  override async getTask(id: string): Promise<TrackerTask | undefined> {
    try {
      const issue = await this.client.getIssueSnapshot(id);

      // Resolve blockers against the epic's children (served from cache when fresh)
      const siblings = this.epicId ? await this.getChildSnapshots(this.epicId) : [];
      const siblingIdentifiers = new Map(siblings.map((c) => [c.id, c.identifier]));

      return linearIssueToTask(issue, siblingIdentifiers);
    } catch (err) {
      if (err instanceof LinearApiError && err.kind === 'not_found') {
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Get the next task to work on.
   * Overrides base to sort by full `ralphPriority` (ascending) rather than
   * coarse 0–4 priority, ensuring fine-grained ordering from PRD metadata.
   */
  override async getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined> {
    const mergedFilter: TaskFilter = {
      ...filter,
      status: ['open', 'in_progress'],
      ready: true,
    };

    const tasks = await this.getTasks(mergedFilter);

    if (tasks.length === 0) {
      return undefined;
    }

    // Sort by full ralphPriority (ascending — lower = higher priority) first,
    // then prefer in_progress so multiple in-progress tasks are deterministic.
    tasks.sort((a, b) => {
      const aPriority = (a.metadata?.ralphPriority as number) ?? DEFAULT_RALPH_PRIORITY;
      const bPriority = (b.metadata?.ralphPriority as number) ?? DEFAULT_RALPH_PRIORITY;
      return aPriority - bPriority;
    });

    const inProgress = tasks.find((t) => t.status === 'in_progress');
    if (inProgress) {
      return inProgress;
    }

    return tasks[0];
  }

  override async updateTaskStatus(
    id: string,
    status: TrackerTaskStatus,
  ): Promise<TrackerTask | undefined> {
    const issue = await this.client.getIssueSnapshot(id);

    if (!issue.teamId) {
      console.error(`Linear tracker: issue "${id}" has no team`);
      return undefined;
    }

    const targetStateType = mapStatusToLinearStateType(status);
    const states = await this.getWorkflowStates(issue.teamId);
    const targetState = states.find((s) => s.type === targetStateType);

    if (!targetState) {
      console.error(
        `Linear tracker: no "${targetStateType}" workflow state found for team`,
      );
      return undefined;
    }

    await this.client.updateIssueState(issue.id, targetState.id);
    this.invalidateChildCache();

    return this.getTask(id);
  }

  override async completeTask(
    id: string,
    reason?: string,
  ): Promise<TaskCompletionResult> {
    try {
      const issue = await this.client.getIssueSnapshot(id);

      if (!issue.teamId) {
        return {
          success: false,
          message: `Issue "${id}" has no team`,
          error: 'No team found on issue',
        };
      }

      // Move to completed state
      const states = await this.getWorkflowStates(issue.teamId);
      const completedState = states.find((s) => s.type === 'completed');

      if (!completedState) {
        return {
          success: false,
          message: `No completed workflow state found for team`,
          error: 'Missing completed workflow state',
        };
      }

      await this.client.updateIssueState(issue.id, completedState.id);
      this.invalidateChildCache();

      // Post completion comment
      const commentBody = reason
        ? `Completed by Ralph: ${reason}`
        : 'Completed by Ralph';
      await this.client.addComment(issue.id, commentBody);

      const task = await this.getTask(id);

      return {
        success: true,
        message: `Task ${id} completed`,
        task,
      };
    } catch (err) {
      const message = err instanceof LinearApiError ? err.message : String(err);
      return {
        success: false,
        message: `Failed to complete task ${id}`,
        error: message,
      };
    }
  }

  override async getEpics(): Promise<TrackerTask[]> {
    if (!this.epicId) {
      return [];
    }

    try {
      const issue = await this.client.getIssueSnapshot(this.epicId);
      const stateType = issue.stateType ?? 'unstarted';

      const childIssues = await this.getChildSnapshots(this.epicId);
      const totalCount = childIssues.length;
      const completedCount = countCompletedChildren(childIssues);

      return [
        {
          id: issue.identifier,
          title: issue.title,
          status: mapLinearStateToStatus(stateType),
          priority: 0 as TaskPriority,
          description: issue.description ?? undefined,
          type: 'epic',
          metadata: {
            linearUrl: issue.url,
            totalCount,
            completedCount,
          },
        },
      ];
    } catch {
      return [];
    }
  }

  /**
   * Sync is a safe no-op for Linear since all data is API-backed.
   */
  override async sync(): Promise<SyncResult> {
    return {
      success: true,
      message: 'Linear tracker is API-backed; no sync required',
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Get PRD context from the epic issue's description.
   */
  async getPrdContext(): Promise<{
    name: string;
    description?: string;
    content: string;
    completedCount: number;
    totalCount: number;
  } | null> {
    if (!this.epicId) {
      return null;
    }

    try {
      const issue = await this.client.getIssueSnapshot(this.epicId);
      const childIssues = await this.getChildSnapshots(this.epicId);
      const totalCount = childIssues.length;
      const completedCount = countCompletedChildren(childIssues);

      return {
        name: issue.title,
        description: issue.description ?? undefined,
        content: issue.description ?? '',
        completedCount,
        totalCount,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get workflow states for a team, with caching.
   */
  private async getWorkflowStates(teamId: string): Promise<WorkflowStateSummary[]> {
    if (this.workflowStatesCache && this.teamId === teamId) {
      return this.workflowStatesCache;
    }

    const states = await this.client.getWorkflowStates(teamId);
    this.teamId = teamId;
    this.workflowStatesCache = states;
    return states;
  }
}

/**
 * Factory function for the Linear tracker plugin.
 */
const createLinearTracker: TrackerPluginFactory = () => new LinearTrackerPlugin();

export default createLinearTracker;
