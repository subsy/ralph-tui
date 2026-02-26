/**
 * ABOUTME: Linear API client wrapper for ralph-tui.
 * Provides a typed, reusable client for all Linear API interactions used by
 * the converter and tracker plugin. Handles authentication, team resolution,
 * issue CRUD, relations, comments, and error mapping.
 */

import { LinearClient, IssueRelationType } from '@linear/sdk';
import type {
  Issue,
  Team,
  WorkflowState,
  IssueConnection,
} from '@linear/sdk';

/**
 * Extract the IssueCreateInput type from the LinearClient.createIssue method signature.
 * The Linear SDK declares this type internally but does not export it.
 */
export type IssueCreateInput = Parameters<LinearClient['createIssue']>[0];

/**
 * Configuration for the Linear client.
 * Auth precedence: explicit `apiKey` overrides `LINEAR_API_KEY` env var.
 */
export interface LinearClientConfig {
  /** Explicit API key (takes precedence over env var) */
  apiKey?: string;
}

/**
 * Categorized error types for user-facing messages.
 */
export type LinearErrorKind =
  | 'auth'
  | 'not_found'
  | 'invalid_team'
  | 'rate_limit'
  | 'network'
  | 'unknown';

/**
 * Structured error from Linear API operations.
 * Provides a user-facing message and categorized error kind for programmatic handling.
 */
export class LinearApiError extends Error {
  readonly kind: LinearErrorKind;

  constructor(message: string, kind: LinearErrorKind, cause?: unknown) {
    super(message);
    this.name = 'LinearApiError';
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * Result of creating an issue, containing the essential fields callers need.
 */
export interface CreatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

/**
 * Result of creating an issue relation.
 */
export interface CreatedRelation {
  id: string;
  type: string;
}

/**
 * Workflow state summary used for status mapping.
 */
export interface WorkflowStateSummary {
  id: string;
  name: string;
  type: string;
}

/**
 * Resolve the API key from config or environment.
 * Config `apiKey` takes deterministic precedence over `LINEAR_API_KEY` env var.
 */
export function resolveApiKey(config?: LinearClientConfig): string {
  const configKey = config?.apiKey;
  if (configKey) {
    return configKey;
  }

  const envKey = process.env.LINEAR_API_KEY;
  if (envKey) {
    return envKey;
  }

  throw new LinearApiError(
    'Linear API key not found. Set LINEAR_API_KEY environment variable or provide apiKey in tracker config.',
    'auth',
  );
}

/**
 * Classify a raw error from the Linear SDK into a user-facing LinearApiError.
 */
function classifyError(err: unknown): LinearApiError {
  if (err instanceof LinearApiError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();

  // Auth errors
  if (
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('invalid api key')
  ) {
    return new LinearApiError(
      'Linear authentication failed. Check your API key (LINEAR_API_KEY or config apiKey).',
      'auth',
      err,
    );
  }

  // Not found
  if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
    return new LinearApiError(
      `Linear resource not found: ${message}`,
      'not_found',
      err,
    );
  }

  // Rate limit
  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('429') ||
    lowerMessage.includes('too many requests')
  ) {
    return new LinearApiError(
      'Linear API rate limit exceeded. Please wait and try again.',
      'rate_limit',
      err,
    );
  }

  // Network errors
  if (
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('socket')
  ) {
    return new LinearApiError(
      `Network error connecting to Linear API: ${message}`,
      'network',
      err,
    );
  }

  return new LinearApiError(
    `Linear API error: ${message}`,
    'unknown',
    err,
  );
}

/**
 * Wrapped Linear API client with typed methods and error mapping.
 * All public methods throw `LinearApiError` on failure.
 */
export class RalphLinearClient {
  private client: LinearClient;

  constructor(config?: LinearClientConfig) {
    const apiKey = resolveApiKey(config);
    this.client = new LinearClient({ apiKey });
  }

  /**
   * Get the underlying LinearClient instance for advanced operations.
   */
  get sdk(): LinearClient {
    return this.client;
  }

  /**
   * Resolve a team by its key (e.g., "ENG").
   * Fetches all accessible teams and matches by key (case-insensitive).
   */
  async resolveTeam(teamKey: string): Promise<Team> {
    try {
      const teams = await this.client.teams();
      const team = teams.nodes.find(
        (t) => t.key.toLowerCase() === teamKey.toLowerCase(),
      );

      if (!team) {
        const availableKeys = teams.nodes.map((t) => t.key).join(', ');
        throw new LinearApiError(
          `Team "${teamKey}" not found. Available teams: ${availableKeys || '(none)'}`,
          'invalid_team',
        );
      }

      return team;
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Get a single issue by identifier (issue key like "ENG-123") or UUID.
   */
  async getIssue(idOrKey: string): Promise<Issue> {
    try {
      const issue = await this.client.issue(idOrKey);
      return issue;
    } catch (err) {
      const classified = classifyError(err);
      if (classified.kind === 'unknown') {
        throw new LinearApiError(
          `Issue "${idOrKey}" not found or inaccessible.`,
          'not_found',
          err,
        );
      }
      throw classified;
    }
  }

  /**
   * Get child issues of a parent issue.
   * Returns all children (paginated up to 250).
   */
  async getChildIssues(parentId: string): Promise<Issue[]> {
    try {
      const parent = await this.getIssue(parentId);
      const children: Issue[] = [];

      let connection: IssueConnection = await parent.children({ first: 100 });
      children.push(...connection.nodes);

      while (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor) {
        connection = await parent.children({
          first: 100,
          after: connection.pageInfo.endCursor,
        });
        children.push(...connection.nodes);
      }

      return children;
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Create an issue in Linear.
   */
  async createIssue(input: IssueCreateInput): Promise<CreatedIssue> {
    try {
      const payload = await this.client.createIssue(input);
      const issue = await payload.issue;

      if (!issue) {
        throw new LinearApiError(
          'Issue creation succeeded but no issue was returned.',
          'unknown',
        );
      }

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Update an issue's workflow state by issue ID.
   */
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    try {
      const issue = await this.client.issue(issueId);
      await issue.update({ stateId });
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Add a comment to an issue.
   */
  async addComment(issueId: string, body: string): Promise<void> {
    try {
      await this.client.createComment({ issueId, body });
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Create a blocking relation between two issues.
   * `blockingIssueId` blocks `blockedIssueId`.
   */
  async createBlockingRelation(
    blockingIssueId: string,
    blockedIssueId: string,
  ): Promise<CreatedRelation> {
    try {
      const payload = await this.client.createIssueRelation({
        issueId: blockedIssueId,
        relatedIssueId: blockingIssueId,
        type: IssueRelationType.Blocks,
      });

      const relation = await payload.issueRelation;

      if (!relation) {
        throw new LinearApiError(
          'Relation creation succeeded but no relation was returned.',
          'unknown',
        );
      }

      return {
        id: relation.id,
        type: 'blocks',
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Get workflow states for a team.
   * Returns all states sorted by position.
   */
  async getWorkflowStates(teamId: string): Promise<WorkflowStateSummary[]> {
    try {
      const team = await this.client.team(teamId);
      const states = await team.states();

      return states.nodes.map((s: WorkflowState) => ({
        id: s.id,
        name: s.name,
        type: s.type,
      }));
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Find the first workflow state matching a given type for a team.
   * State types: "triage", "backlog", "unstarted", "started", "completed", "canceled".
   */
  async findWorkflowState(
    teamId: string,
    stateType: string,
  ): Promise<WorkflowStateSummary | undefined> {
    const states = await this.getWorkflowStates(teamId);
    return states.find((s) => s.type === stateType);
  }

  /**
   * Get blocking relations for an issue.
   * Returns IDs of issues that block the given issue.
   */
  async getBlockingIssueIds(issueId: string): Promise<string[]> {
    try {
      const issue = await this.client.issue(issueId);
      const relations = await issue.relations();

      const blockingIds: string[] = [];
      for (const rel of relations.nodes) {
        if (rel.type === 'blocks') {
          const relatedIssue = await rel.relatedIssue;
          if (relatedIssue) {
            blockingIds.push(relatedIssue.id);
          }
        }
      }

      return blockingIds;
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Resolve label names to their Linear IDs, creating any that don't exist.
   * Label matching is case-insensitive.
   */
  async resolveLabelIds(labelNames: string[]): Promise<string[]> {
    if (labelNames.length === 0) return [];

    try {
      // Fetch existing workspace labels
      const existingLabels = await this.client.issueLabels({ first: 250 });
      const labelMap = new Map<string, string>();

      for (const label of existingLabels.nodes) {
        labelMap.set(label.name.toLowerCase(), label.id);
      }

      const resolvedIds: string[] = [];

      for (const name of labelNames) {
        const existingId = labelMap.get(name.toLowerCase());

        if (existingId) {
          resolvedIds.push(existingId);
        } else {
          // Create the label (workspace-level)
          const payload = await this.client.createIssueLabel({ name });
          const label = await payload.issueLabel;

          if (label) {
            resolvedIds.push(label.id);
          }
        }
      }

      return resolvedIds;
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Resolve a project by name or UUID.
   * Tries UUID lookup first, then falls back to case-insensitive name search.
   */
  async resolveProject(nameOrId: string): Promise<{ id: string; name: string }> {
    try {
      // Try direct ID lookup first (UUID)
      try {
        const project = await this.client.project(nameOrId);
        if (project) {
          return { id: project.id, name: project.name };
        }
      } catch {
        // Not a valid UUID, fall through to name search
      }

      // Search by name
      const projects = await this.client.projects({ first: 250 });
      const match = projects.nodes.find(
        (p) => p.name.toLowerCase() === nameOrId.toLowerCase(),
      );

      if (!match) {
        throw new LinearApiError(
          `Project "${nameOrId}" not found.`,
          'not_found',
        );
      }

      return { id: match.id, name: match.name };
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Validate that the client can authenticate and reach the API.
   * Useful during setup to verify credentials before saving config.
   */
  async validateConnection(): Promise<void> {
    try {
      const viewer = await this.client.viewer;
      if (!viewer) {
        throw new LinearApiError(
          'Authentication succeeded but no user profile was returned.',
          'auth',
        );
      }
    } catch (err) {
      throw classifyError(err);
    }
  }
}

/**
 * Create a RalphLinearClient from tracker/converter config options.
 * Reads `apiKey` from the options object or falls back to `LINEAR_API_KEY` env var.
 */
export function createLinearClient(options?: Record<string, unknown>): RalphLinearClient {
  const apiKey = typeof options?.apiKey === 'string' ? options.apiKey : undefined;
  return new RalphLinearClient({ apiKey });
}
