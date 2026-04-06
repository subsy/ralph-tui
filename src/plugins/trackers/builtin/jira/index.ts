/**
 * ABOUTME: Jira tracker plugin for ralph-tui run/execution loop.
 * Enables Ralph to work through Jira epics and stories autonomously,
 * with status/dependency awareness, priority ordering, and bidirectional
 * status updates via the Jira REST API v3.
 */

import { BaseTrackerPlugin } from '../../base.js';
import { createJiraClient, type RalphJiraClient } from './client.js';
import { adfToMarkdown, buildCompletionAdf } from './adf.js';
import { JIRA_TEMPLATE } from '../../../../templates/builtin.js';
import type {
  JiraIssue,
  JiraTrackerOptions,
  StatusMapping,
} from './types.js';
import { JiraApiError } from './types.js';
import type {
  TaskCompletionResult,
  TaskFilter,
  TaskPriority,
  TrackerPluginFactory,
  TrackerPluginMeta,
  TrackerTask,
  TrackerTaskStatus,
  SetupQuestion,
  SyncResult,
} from '../../types.js';

// ─── Status mapping ───────────────────────────────────────────────────────

/**
 * Map Jira status category key to TrackerTaskStatus.
 * Status categories are consistent across all Jira instances.
 */
function mapStatusCategoryToStatus(categoryKey: string): TrackerTaskStatus {
  switch (categoryKey) {
    case 'done':
      return 'completed';
    case 'indeterminate':
      return 'in_progress';
    case 'new':
    default:
      return 'open';
  }
}

/**
 * Resolve a Jira issue's status to TrackerTaskStatus.
 * Uses explicit status mapping if configured, otherwise falls back to status category.
 */
function resolveStatus(
  statusName: string,
  categoryKey: string,
  mapping?: StatusMapping,
): TrackerTaskStatus {
  if (mapping) {
    const mapped = mapping[statusName];
    if (mapped && isValidStatus(mapped)) {
      return mapped as TrackerTaskStatus;
    }
  }
  return mapStatusCategoryToStatus(categoryKey);
}

/**
 * Check if a string is a valid TrackerTaskStatus.
 */
function isValidStatus(status: string): boolean {
  return ['open', 'in_progress', 'blocked', 'completed', 'cancelled'].includes(status);
}

// ─── Priority mapping ─────────────────────────────────────────────────────

/**
 * Map Jira priority name to TaskPriority (0-4).
 */
function mapPriority(priorityName: string | undefined): TaskPriority {
  if (!priorityName) return 2; // Default to medium

  switch (priorityName.toLowerCase()) {
    // Standard Jira priorities
    case 'highest':
    case 'blocker':
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
    case 'lowest':
    case 'trivial':
      return 4;

    // P1-P5 numeric priorities (common in many Jira instances)
    case 'p1':
      return 0;
    case 'p2':
      return 1;
    case 'p3':
      return 2;
    case 'p4':
      return 3;
    case 'p5':
      return 4;

    default:
      return 2;
  }
}

// ─── Issue type mapping ───────────────────────────────────────────────────

/**
 * Map Jira issue type name to a normalized type string.
 */
function mapIssueType(typeName: string): string {
  switch (typeName.toLowerCase()) {
    case 'story':
    case 'user story':
      return 'story';
    case 'bug':
      return 'bug';
    case 'epic':
      return 'epic';
    case 'task':
    case 'sub-task':
    case 'subtask':
      return 'task';
    default:
      return 'task';
  }
}

// ─── Acceptance criteria extraction ───────────────────────────────────────

/**
 * Extract acceptance criteria from a markdown description.
 * Looks for common AC section headings and extracts bullet points.
 */
function extractAcceptanceCriteriaFromDescription(markdown: string): string[] {
  if (!markdown) return [];

  // Match sections headed with "Acceptance Criteria" (various markdown heading levels)
  const patterns = [
    /#{1,6}\s*Acceptance\s+Criteria\s*\n([\s\S]*?)(?=\n#{1,6}\s|\n$|$)/i,
    /\*\*Acceptance\s+Criteria:?\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n#{1,6}\s|\n$|$)/i,
  ];

  for (const pattern of patterns) {
    const match = markdown.match(pattern);
    if (match?.[1]) {
      const section = match[1].trim();
      // Extract bullet points or numbered items
      const items = section
        .split('\n')
        .map((line) => line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\d+\.\s*/, '').trim())
        .filter((line) => line.length > 0);

      if (items.length > 0) {
        return items;
      }
    }
  }

  return [];
}

/**
 * Extract acceptance criteria from subtasks.
 */
function extractAcceptanceCriteriaFromSubtasks(issue: JiraIssue): string[] {
  if (!issue.fields.subtasks || issue.fields.subtasks.length === 0) {
    return [];
  }

  return issue.fields.subtasks.map((subtask) => {
    const status = subtask.fields.status.statusCategory?.key === 'done' ? '✅' : '☐';
    return `${status} ${subtask.fields.summary} (${subtask.key})`;
  });
}

// ─── Dependency resolution ────────────────────────────────────────────────

/**
 * Extract blocking issue keys from issue links.
 * Returns keys of issues that block the given issue.
 */
function getBlockingIssueKeys(issue: JiraIssue): string[] {
  return issue.fields.issuelinks
    .filter((link) => {
      // "is blocked by" relationship: the inward issue blocks us
      return (
        (link.type.inward === 'is blocked by' && link.inwardIssue) ||
        (link.type.outward === 'is required by' && link.outwardIssue)
      );
    })
    .map((link) => {
      if (link.type.inward === 'is blocked by' && link.inwardIssue) {
        return link.inwardIssue.key;
      }
      if (link.type.outward === 'is required by' && link.outwardIssue) {
        return link.outwardIssue.key;
      }
      return '';
    })
    .filter((key) => key.length > 0);
}

// ─── Issue → TrackerTask conversion ───────────────────────────────────────

/**
 * Convert a Jira issue to a TrackerTask.
 */
function jiraIssueToTask(
  issue: JiraIssue,
  options: {
    statusMapping?: StatusMapping;
    acceptanceCriteriaSource?: string;
    acceptanceCriteriaField?: string;
    epicKey?: string;
  },
): TrackerTask {
  const status = resolveStatus(
    issue.fields.status.name,
    issue.fields.status.statusCategory.key,
    options.statusMapping,
  );

  const descriptionMarkdown = adfToMarkdown(issue.fields.description);

  // Extract acceptance criteria based on configured strategy
  let acceptanceCriteria: string[] = [];
  const acSource = options.acceptanceCriteriaSource ?? 'description';

  switch (acSource) {
    case 'description':
      acceptanceCriteria = extractAcceptanceCriteriaFromDescription(descriptionMarkdown);
      break;
    case 'custom_field': {
      const fieldId = options.acceptanceCriteriaField;
      if (fieldId) {
        const fieldValue = issue.fields[fieldId];
        if (typeof fieldValue === 'string') {
          acceptanceCriteria = fieldValue.split('\n').filter((line) => line.trim().length > 0);
        }
      }
      break;
    }
    case 'subtasks':
      acceptanceCriteria = extractAcceptanceCriteriaFromSubtasks(issue);
      break;
  }

  const blockingKeys = getBlockingIssueKeys(issue);
  const parentKey = issue.fields.parent?.key ?? options.epicKey;

  const metadata: Record<string, unknown> = {
    jiraKey: issue.key,
    jiraId: issue.id,
    statusName: issue.fields.status.name,
    statusCategory: issue.fields.status.statusCategory.key,
  };

  if (acceptanceCriteria.length > 0) {
    metadata.acceptanceCriteria = acceptanceCriteria;
  }

  return {
    id: issue.key,
    title: issue.fields.summary,
    status,
    priority: mapPriority(issue.fields.priority?.name),
    description: descriptionMarkdown || undefined,
    labels: issue.fields.labels.length > 0 ? issue.fields.labels : undefined,
    type: mapIssueType(issue.fields.issuetype.name),
    parentId: parentKey,
    dependsOn: blockingKeys.length > 0 ? blockingKeys : undefined,
    assignee: issue.fields.assignee?.displayName,
    createdAt: issue.fields.created,
    updatedAt: issue.fields.updated,
    metadata,
  };
}

// ─── Plugin implementation ────────────────────────────────────────────────

/**
 * Jira tracker plugin implementation.
 * Tracks stories under a Jira epic via the REST API v3.
 */
export class JiraTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'jira',
    name: 'Jira Issue Tracker',
    description: 'Track stories using Jira REST API with epic/story hierarchy',
    version: '1.0.0',
    supportsBidirectionalSync: false,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  private client!: RalphJiraClient;
  private epicId: string = '';
  private options: JiraTrackerOptions = {};

  /** Task list cache */
  private tasksCache: TrackerTask[] | null = null;
  private tasksCacheParentId: string | null = null;
  private tasksCacheTime: number = 0;
  private readonly TASKS_CACHE_TTL_MS = 30_000;

  /** Transitions cache per issue key */
  private transitionsCache: Map<string, { data: { id: string; name: string; categoryKey: string }[]; time: number }> = new Map();
  private readonly TRANSITIONS_CACHE_TTL_MS = 300_000;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    this.options = config as unknown as JiraTrackerOptions;

    if (typeof config.epicId === 'string' && config.epicId) {
      this.epicId = config.epicId;
    }

    try {
      this.client = createJiraClient(config);
      // Configure custom field for AC extraction if needed
      if (this.options.acceptanceCriteriaSource === 'custom_field' && this.options.acceptanceCriteriaField) {
        this.client.setAcceptanceCriteriaField(this.options.acceptanceCriteriaField);
      }
    } catch (err) {
      this.ready = false;
      if (err instanceof JiraApiError) {
        console.error(`Jira tracker initialization failed: ${err.message}`);
      }
      return;
    }

    this.ready = true;
  }

  setEpicId(epicId: string): void {
    this.epicId = epicId;
    // Invalidate caches when epic changes
    this.tasksCache = null;
    this.transitionsCache.clear();
  }

  getEpicId(): string {
    return this.epicId;
  }

  override async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    const parentId = filter?.parentId ?? this.epicId;
    if (!parentId) {
      return [];
    }

    // Check cache
    const now = Date.now();
    if (
      this.tasksCache &&
      this.tasksCacheParentId === parentId &&
      now - this.tasksCacheTime < this.TASKS_CACHE_TTL_MS
    ) {
      return this.filterTasks(this.tasksCache, filter);
    }

    try {
      const hierarchyModel = this.options.hierarchyModel ?? 'auto';
      const children = await this.client.getEpicChildren(parentId, hierarchyModel);

      const tasks = children.map((issue) =>
        jiraIssueToTask(issue, {
          statusMapping: this.options.statusMapping,
          acceptanceCriteriaSource: this.options.acceptanceCriteriaSource,
          acceptanceCriteriaField: this.options.acceptanceCriteriaField,
          epicKey: parentId,
        }),
      );

      // Update cache
      this.tasksCache = tasks;
      this.tasksCacheParentId = parentId;
      this.tasksCacheTime = now;

      return this.filterTasks(tasks, filter);
    } catch (err) {
      if (err instanceof JiraApiError) {
        console.error(`Jira tracker: failed to fetch tasks: ${err.message}`);
      }
      return [];
    }
  }

  override async getTask(id: string): Promise<TrackerTask | undefined> {
    try {
      const issue = await this.client.getIssue(id);
      return jiraIssueToTask(issue, {
        statusMapping: this.options.statusMapping,
        acceptanceCriteriaSource: this.options.acceptanceCriteriaSource,
        acceptanceCriteriaField: this.options.acceptanceCriteriaField,
        epicKey: this.epicId,
      });
    } catch (err) {
      if (err instanceof JiraApiError && err.kind === 'not_found') {
        return undefined;
      }
      throw err;
    }
  }

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

    // Sort by priority (0 = highest), then prefer in_progress
    tasks.sort((a, b) => a.priority - b.priority);

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
    try {
      const targetCategoryKey = statusToJiraCategoryKey(status);
      const transitions = await this.getCachedTransitions(id);

      // Prefer exact status name match, fall back to category match
      const statusNameLower = status.replaceAll('_', ' ').toLowerCase();
      let target = transitions.find((t) => t.name.toLowerCase() === statusNameLower);

      if (!target) {
        target = transitions.find((t) => t.categoryKey === targetCategoryKey);
      }

      if (!target) {
        console.error(
          `Jira tracker: no transition to "${status}" status available for ${id}`,
        );
        return undefined;
      }

      await this.client.transitionIssue(id, target.id);

      // Invalidate caches
      this.tasksCache = null;
      this.transitionsCache.delete(id);

      return this.getTask(id);
    } catch (err) {
      if (err instanceof JiraApiError) {
        console.error(`Jira tracker: failed to update status for ${id}: ${err.message}`);
      }
      return undefined;
    }
  }

  override async completeTask(
    id: string,
    reason?: string,
  ): Promise<TaskCompletionResult> {
    try {
      // Find "Done" transition
      const transitions = await this.getCachedTransitions(id);
      const doneTransition = transitions.find((t) => t.categoryKey === 'done');

      if (!doneTransition) {
        return {
          success: false,
          message: `No transition to Done status available for ${id}`,
          error: 'Missing Done workflow transition',
        };
      }

      // Execute transition
      await this.client.transitionIssue(id, doneTransition.id);

      // Invalidate caches (do this before post-transition ops)
      this.tasksCache = null;
      this.transitionsCache.delete(id);

      // Post-transition operations: add completion comment
      // These are non-critical, so we wrap separately and return success with warning
      let commentWarning: string | undefined;
      try {
        const task = await this.getTask(id);
        const acceptanceCriteria = task?.metadata?.acceptanceCriteria as string[] | undefined;
        const completionComment = buildCompletionAdf({
          taskId: id,
          taskTitle: task?.title ?? id,
          acceptanceCriteria,
          reason,
        });
        await this.client.addComment(id, completionComment);
      } catch (commentErr) {
        commentWarning = commentErr instanceof JiraApiError
          ? commentErr.message
          : String(commentErr);
      }

      // Re-fetch for the return value (status should now be Done)
      const updatedTask = await this.getTask(id);

      return {
        success: true,
        message: commentWarning
          ? `Task ${id} completed (but comment failed: ${commentWarning})`
          : `Task ${id} completed`,
        task: updatedTask,
      };
    } catch (err) {
      const message = err instanceof JiraApiError ? err.message : String(err);
      return {
        success: false,
        message: `Failed to complete task ${id}`,
        error: message,
      };
    }
  }

  override async getEpics(): Promise<TrackerTask[]> {
    // If we have a specific epic configured, return it with child stats
    if (this.epicId) {
      try {
        const issue = await this.client.getIssue(this.epicId);
        const hierarchyModel = this.options.hierarchyModel ?? 'auto';
        const children = await this.client.getEpicChildren(this.epicId, hierarchyModel);
        const completedCount = children.filter(
          (child) => child.fields.status.statusCategory.key === 'done',
        ).length;

        const descriptionMarkdown = adfToMarkdown(issue.fields.description);
        const baseUrl = this.options.baseUrl ?? process.env.JIRA_BASE_URL ?? '';

        return [
          {
            id: issue.key,
            title: issue.fields.summary,
            status: resolveStatus(
              issue.fields.status.name,
              issue.fields.status.statusCategory.key,
              this.options.statusMapping,
            ),
            priority: 0 as TaskPriority,
            description: descriptionMarkdown || undefined,
            type: 'epic',
            metadata: {
              jiraKey: issue.key,
              jiraUrl: `${baseUrl}/browse/${issue.key}`,
              totalCount: children.length,
              completedCount,
            },
          },
        ];
      } catch {
        return [];
      }
    }

    // No specific epic — discover all epics in the project
    const projectKey = this.options.projectKey;
    if (!projectKey) {
      return [];
    }

    try {
      const epics = await this.client.listEpics(projectKey);
      const baseUrl = this.options.baseUrl ?? process.env.JIRA_BASE_URL ?? '';

      return epics.map((issue) => {
        const descriptionMarkdown = adfToMarkdown(issue.fields.description);
        return {
          id: issue.key,
          title: issue.fields.summary,
          status: resolveStatus(
            issue.fields.status.name,
            issue.fields.status.statusCategory.key,
            this.options.statusMapping,
          ),
          priority: mapPriority(issue.fields.priority?.name),
          description: descriptionMarkdown || undefined,
          type: 'epic',
          metadata: {
            jiraKey: issue.key,
            jiraUrl: `${baseUrl}/browse/${issue.key}`,
          },
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Sync is a no-op for Jira since all data is API-backed.
   * Clears local caches to force fresh reads.
   */
  override async sync(): Promise<SyncResult> {
    this.tasksCache = null;
    this.transitionsCache.clear();
    return {
      success: true,
      message: 'Jira tracker is API-backed; cache cleared',
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Get PRD context from the epic issue.
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
      const issue = await this.client.getIssue(this.epicId);
      const hierarchyModel = this.options.hierarchyModel ?? 'auto';
      const children = await this.client.getEpicChildren(this.epicId, hierarchyModel);
      const completedCount = children.filter(
        (child) => child.fields.status.statusCategory.key === 'done',
      ).length;
      const descriptionMarkdown = adfToMarkdown(issue.fields.description);

      return {
        name: issue.fields.summary,
        description: descriptionMarkdown || undefined,
        content: descriptionMarkdown,
        completedCount,
        totalCount: children.length,
      };
    } catch {
      return null;
    }
  }

  getSetupQuestions(): SetupQuestion[] {
    return [
      {
        id: 'baseUrl',
        prompt: 'Jira instance URL (e.g., https://company.atlassian.net)',
        type: 'text',
        required: true,
        help: 'Your Jira Cloud or Data Center instance URL',
      },
      {
        id: 'email',
        prompt: 'Atlassian account email',
        type: 'text',
        required: true,
        help: 'Email address associated with your Atlassian account',
      },
      {
        id: 'apiToken',
        prompt: 'Jira API token',
        type: 'password',
        required: true,
        help: 'Generate at: id.atlassian.com/manage-profile/security/api-tokens',
      },
      {
        id: 'projectKey',
        prompt: 'Jira project key (e.g., MYN, SNSP)',
        type: 'text',
        required: false,
        help: 'Project key for epic discovery. Can also be set per-run with --epic.',
      },
    ];
  }

  override async validateSetup(
    answers: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const client = createJiraClient(answers);
      await client.validateConnection();
      return null;
    } catch (err) {
      return err instanceof JiraApiError
        ? err.message
        : `Jira connection failed: ${String(err)}`;
    }
  }

  /**
   * Get the prompt template for the Jira tracker.
   * Returns the embedded template string.
   */
  override getTemplate(): string {
    return JIRA_TEMPLATE;
  }

  /**
   * Get transitions for an issue with caching.
   */
  private async getCachedTransitions(
    issueKey: string,
  ): Promise<{ id: string; name: string; categoryKey: string }[]> {
    const now = Date.now();
    const cached = this.transitionsCache.get(issueKey);

    if (cached && now - cached.time < this.TRANSITIONS_CACHE_TTL_MS) {
      return cached.data;
    }

    const transitions = await this.client.getTransitions(issueKey);
    const mapped = transitions.map((t) => ({
      id: t.id,
      name: t.name,
      categoryKey: t.to.statusCategory.key,
    }));

    this.transitionsCache.set(issueKey, { data: mapped, time: now });
    return mapped;
  }
}

/**
 * Map TrackerTaskStatus to the Jira status category key to search for.
 */
function statusToJiraCategoryKey(status: TrackerTaskStatus): string {
  switch (status) {
    case 'in_progress':
      return 'indeterminate';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'done';
    case 'open':
    case 'blocked':
    default:
      return 'new';
  }
}

/**
 * Factory function for the Jira tracker plugin.
 */
const createJiraTracker: TrackerPluginFactory = () => new JiraTrackerPlugin();

export default createJiraTracker;
