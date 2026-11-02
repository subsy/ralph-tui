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
 * Flattened view of a Linear issue with every field the tracker needs.
 * Fetched in a single GraphQL request so the tracker doesn't have to resolve
 * SDK lazy relations (state, labels, assignee, parent, relations) one request at a time.
 */
export interface LinearIssueSnapshot {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  /** Workflow state type ("triage", "backlog", "unstarted", "started", "completed", "canceled") */
  stateType: string | null;
  teamId: string | null;
  parentIdentifier: string | null;
  assigneeName: string | null;
  labels: string[];
  /** UUIDs of issues that block this issue */
  blockedByIds: string[];
}

/**
 * Page size for child issue snapshot queries. Nested connection sizes are kept
 * small so each query stays well under Linear's per-query complexity limit.
 */
const SNAPSHOT_PAGE_SIZE = 50;

const ISSUE_SNAPSHOT_FIELDS = `
  id
  identifier
  title
  description
  url
  createdAt
  updatedAt
  state { type }
  team { id }
  parent { identifier }
  assignee { name displayName }
  labels(first: 20) { nodes { name } pageInfo { hasNextPage endCursor } }
  inverseRelations(first: 25) { nodes { type issue { id } } pageInfo { hasNextPage endCursor } }
`;

const ISSUE_SNAPSHOT_QUERY = `
  query RalphIssueSnapshot($id: String!) {
    issue(id: $id) { ${ISSUE_SNAPSHOT_FIELDS} }
  }
`;

const CHILD_ISSUE_SNAPSHOTS_QUERY = `
  query RalphChildIssueSnapshots($id: String!, $first: Int!, $after: String) {
    issue(id: $id) {
      children(first: $first, after: $after) {
        nodes { ${ISSUE_SNAPSHOT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/**
 * Fetches all inverse relations of one issue. Used only when the snapshot's
 * first page of relations was incomplete, so no blocker is silently dropped.
 */
const INVERSE_RELATIONS_QUERY = `
  query RalphInverseRelations($id: String!, $after: String) {
    issue(id: $id) {
      inverseRelations(first: 100, after: $after) {
        nodes { type issue { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const LABELS_QUERY = `
  query RalphIssueLabels($id: String!, $after: String) {
    issue(id: $id) {
      labels(first: 100, after: $after) {
        nodes { name }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

type RawRelation = { type: string; issue?: { id: string } | null };

interface SnapshotConnection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

/** Raw GraphQL shape of an issue returned by the snapshot queries. */
interface RawIssueSnapshot {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  state?: { type: string } | null;
  team?: { id: string } | null;
  parent?: { identifier: string } | null;
  assignee?: { name: string; displayName?: string | null } | null;
  labels?: SnapshotConnection<{ name: string }> | null;
  inverseRelations?: SnapshotConnection<RawRelation> | null;
}

/** IDs of the issues that block an issue, given its inverse relations. */
function blockerIds(relations: RawRelation[]): string[] {
  return relations
    .filter((rel) => rel.type === 'blocks' && rel.issue)
    .map((rel) => rel.issue!.id);
}

/**
 * Return the cursor for the next page, or undefined when there are no more pages.
 * Throws when the server reports more pages but the cursor didn't advance,
 * which would otherwise loop forever.
 */
function nextPageCursor(
  pageInfo: { hasNextPage: boolean; endCursor?: string | null },
  seen: Set<string>,
  description: string,
): string | undefined {
  if (!pageInfo.hasNextPage) {
    return undefined;
  }
  const next = pageInfo.endCursor;
  if (!next || seen.has(next)) {
    throw new LinearApiError(
      `Linear returned a missing or repeated pagination cursor for ${description}.`,
      'unknown',
    );
  }
  seen.add(next);
  return next;
}

function toIssueSnapshot(raw: RawIssueSnapshot): LinearIssueSnapshot {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description ?? null,
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    stateType: raw.state?.type ?? null,
    teamId: raw.team?.id ?? null,
    parentIdentifier: raw.parent?.identifier ?? null,
    assigneeName: raw.assignee?.displayName || raw.assignee?.name || null,
    labels: (raw.labels?.nodes ?? []).map((l) => l.name),
    blockedByIds: blockerIds(raw.inverseRelations?.nodes ?? []),
  };
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
   * Get a snapshot of a single issue (identifier like "ENG-123" or UUID)
   * including state, team, parent, assignee, labels, and blockers in one request.
   */
  async getIssueSnapshot(idOrKey: string): Promise<LinearIssueSnapshot> {
    let data: { issue?: RawIssueSnapshot | null };
    try {
      data = await this.client.client.request<
        { issue?: RawIssueSnapshot | null },
        { id: string }
      >(ISSUE_SNAPSHOT_QUERY, { id: idOrKey });
    } catch (err) {
      throw classifyError(err);
    }

    if (!data.issue) {
      throw new LinearApiError(
        `Issue "${idOrKey}" not found or inaccessible.`,
        'not_found',
      );
    }

    return this.completeSnapshot(data.issue);
  }

  /**
   * Get snapshots of all child issues of a parent issue.
   * Costs one request per page of children instead of several requests per child.
   */
  async getChildIssueSnapshots(parentId: string): Promise<LinearIssueSnapshot[]> {
    type ChildrenData = {
      issue?: {
        children: {
          nodes: RawIssueSnapshot[];
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      } | null;
    };

    try {
      const snapshots: LinearIssueSnapshot[] = [];
      let after: string | undefined;
      const seen = new Set<string>();

      do {
        const data: ChildrenData = await this.client.client.request<
          ChildrenData,
          { id: string; first: number; after?: string }
        >(CHILD_ISSUE_SNAPSHOTS_QUERY, { id: parentId, first: SNAPSHOT_PAGE_SIZE, after });

        if (!data.issue) {
          throw new LinearApiError(
            `Issue "${parentId}" not found or inaccessible.`,
            'not_found',
          );
        }

        const { nodes, pageInfo } = data.issue.children;
        snapshots.push(...(await Promise.all(nodes.map((node) => this.completeSnapshot(node)))));
        after = nextPageCursor(pageInfo, seen, `children of "${parentId}"`);
      } while (after);

      return snapshots;
    } catch (err) {
      throw classifyError(err);
    }
  }

  /**
   * Convert a raw issue to a snapshot, completing truncated nested connections.
   */
  private async completeSnapshot(raw: RawIssueSnapshot): Promise<LinearIssueSnapshot> {
    const snapshot = toIssueSnapshot(raw);
    if (raw.labels?.pageInfo?.hasNextPage) {
      const labels = await this.completeConnection(raw.id, 'labels', LABELS_QUERY, raw.labels);
      snapshot.labels = labels.map((label) => label.name);
    }
    if (raw.inverseRelations?.pageInfo?.hasNextPage) {
      const relations = await this.completeConnection(
        raw.id, 'inverseRelations', INVERSE_RELATIONS_QUERY, raw.inverseRelations,
      );
      snapshot.blockedByIds = blockerIds(relations);
    }
    return snapshot;
  }

  /**
   * Continue a nested connection from the cursor returned by the snapshot.
   */
  private async completeConnection<T>(
    issueId: string,
    field: 'labels' | 'inverseRelations',
    query: string,
    initial: SnapshotConnection<T>,
  ): Promise<T[]> {
    type ConnectionData = {
      issue?: {
        [key in typeof field]: SnapshotConnection<T>;
      } | null;
    };

    try {
      const nodes = [...initial.nodes];
      const seen = new Set<string>();
      let pageInfo = initial.pageInfo;
      let after = nextPageCursor(pageInfo, seen, `${field} of "${issueId}"`);

      while (after) {
        const data: ConnectionData = await this.client.client.request<
          ConnectionData,
          { id: string; after?: string }
        >(query, { id: issueId, after });

        if (!data.issue) {
          throw new LinearApiError(
            `Issue "${issueId}" not found or inaccessible.`,
            'not_found',
          );
        }

        const connection = data.issue[field];
        nodes.push(...connection.nodes);
        pageInfo = connection.pageInfo;
        after = nextPageCursor(pageInfo, seen, `${field} of "${issueId}"`);
      }

      return nodes;
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
      await this.client.updateIssue(issueId, { stateId });
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
   *
   * Linear SDK semantics: createIssueRelation({ issueId: A, relatedIssueId: B, type: Blocks })
   * means "A blocks B". So issueId must be the blocker.
   */
  async createBlockingRelation(
    blockingIssueId: string,
    blockedIssueId: string,
  ): Promise<CreatedRelation> {
    try {
      const payload = await this.client.createIssueRelation({
        issueId: blockingIssueId,
        relatedIssueId: blockedIssueId,
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
   *
   * Uses `inverseRelations()` because we need relations where the given issue is
   * the `relatedIssueId` (blocked), not the `issueId` (blocker).
   * In inverse relations with type "blocks", `rel.issue` is the blocker.
   */
  async getBlockingIssueIds(issueId: string): Promise<string[]> {
    try {
      const issue = await this.client.issue(issueId);
      const inverseRels = await issue.inverseRelations();

      const blockingIds: string[] = [];
      for (const rel of inverseRels.nodes) {
        if (rel.type === 'blocks') {
          const blockerIssue = await rel.issue;
          if (blockerIssue) {
            blockingIds.push(blockerIssue.id);
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
   * Note: fetches up to 250 labels without pagination — sufficient for most workspaces.
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
