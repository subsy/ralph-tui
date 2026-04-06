/**
 * ABOUTME: Jira REST API v3 client wrapper for ralph-tui.
 * Provides a typed, reusable client for all Jira API interactions used by
 * the tracker plugin. Handles authentication, issue CRUD, transitions,
 * comments, pagination, and error mapping.
 */

import type {
  JiraClientConfig,
  JiraIssue,
  JiraTransition,
  JiraSearchResponse,
  JiraProject,
} from './types.js';
import { JiraApiError } from './types.js';
import type { AdfDocument } from './types.js';
import { textToAdf } from './adf.js';

/**
 * Base fields requested when fetching issues for efficiency.
 * Only includes fields the tracker plugin actually uses.
 */
const BASE_ISSUE_FIELDS = [
  'summary',
  'description',
  'status',
  'priority',
  'issuetype',
  'labels',
  'assignee',
  'created',
  'updated',
  'issuelinks',
  'parent',
  'subtasks',
];

/**
 * Build the fields list for Jira API requests.
 * Dynamically includes custom field ID when AC source is 'custom_field'.
 */
function buildIssueFields(options?: { acceptanceCriteriaField?: string }): string {
  const fields = [...BASE_ISSUE_FIELDS];
  if (options?.acceptanceCriteriaField) {
    fields.push(options.acceptanceCriteriaField);
  }
  return fields.join(',');
}

/**
 * Maximum results per search page (Jira API limit is 100).
 */
const MAX_RESULTS_PER_PAGE = 100;

/**
 * Resolve Jira client config from explicit options or environment variables.
 * Config fields take precedence over env vars.
 */
export function resolveConfig(options?: Record<string, unknown>): JiraClientConfig {
  const baseUrl =
    (typeof options?.baseUrl === 'string' ? options.baseUrl : undefined) ??
    process.env.JIRA_BASE_URL;

  const email =
    (typeof options?.email === 'string' ? options.email : undefined) ??
    process.env.JIRA_EMAIL;

  const apiToken =
    (typeof options?.apiToken === 'string' ? options.apiToken : undefined) ??
    process.env.JIRA_API_TOKEN;

  if (!baseUrl) {
    throw new JiraApiError(
      'Jira base URL not found. Set JIRA_BASE_URL environment variable or provide baseUrl in tracker config.',
      'invalid_config',
    );
  }

  if (!email) {
    throw new JiraApiError(
      'Jira email not found. Set JIRA_EMAIL environment variable or provide email in tracker config.',
      'invalid_config',
    );
  }

  if (!apiToken) {
    throw new JiraApiError(
      'Jira API token not found. Set JIRA_API_TOKEN environment variable or provide apiToken in tracker config.',
      'invalid_config',
    );
  }

  // Normalize base URL: remove trailing slash
  const normalizedUrl = baseUrl.replace(/\/+$/, '');

  return { baseUrl: normalizedUrl, email, apiToken };
}

/**
 * Classify a raw error into a user-facing JiraApiError.
 */
function classifyError(err: unknown, statusCode?: number): JiraApiError {
  if (err instanceof JiraApiError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();

  // HTTP status code classification
  if (statusCode === 401 || statusCode === 403) {
    return new JiraApiError(
      'Jira authentication failed. Check your email and API token.',
      'auth',
      err,
    );
  }

  if (statusCode === 404) {
    return new JiraApiError(
      `Jira resource not found: ${message}`,
      'not_found',
      err,
    );
  }

  if (statusCode === 429) {
    return new JiraApiError(
      'Jira API rate limit exceeded. Please wait and try again.',
      'rate_limit',
      err,
    );
  }

  // String-based classification for network errors
  if (
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('socket')
  ) {
    return new JiraApiError(
      `Network error connecting to Jira: ${message}`,
      'network',
      err,
    );
  }

  return new JiraApiError(
    `Jira API error: ${message}`,
    'unknown',
    err,
  );
}

/**
 * Jira REST API v3 client.
 * All public methods throw JiraApiError on failure.
 */
export class RalphJiraClient {
  readonly baseUrl: string;
  private authHeader: string;

  constructor(config: JiraClientConfig) {
    this.baseUrl = config.baseUrl;
    // Basic auth: base64(email:apiToken)
    const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  /**
   * Make an authenticated request to the Jira REST API.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle 204 No Content (e.g., successful transition)
      if (response.status === 204) {
        return undefined as T;
      }

      if (!response.ok) {
        let errorMessage: string;
        try {
          const errorBody = await response.json() as Record<string, unknown>;
          const messages = errorBody.errorMessages as string[] | undefined;
          const errors = errorBody.errors as Record<string, string> | undefined;
          errorMessage = messages?.join(', ')
            ?? (errors ? Object.values(errors).join(', ') : '')
            ?? response.statusText;
        } catch {
          errorMessage = response.statusText;
        }

        throw classifyError(new Error(errorMessage), response.status);
      }

      return await response.json() as T;
    } catch (err) {
      if (err instanceof JiraApiError) {
        throw err;
      }
      throw classifyError(err);
    }
  }

  private acceptanceCriteriaField?: string;

  /**
   * Set the custom field ID for acceptance criteria extraction.
   * Should be called before getIssue/searchIssues when using custom_field AC source.
   */
  setAcceptanceCriteriaField(fieldId: string | undefined): void {
    this.acceptanceCriteriaField = fieldId;
  }

  /**
   * Get a single issue by key (e.g., "MYN-1234").
   */
  async getIssue(issueKey: string): Promise<JiraIssue> {
    const fields = buildIssueFields({ acceptanceCriteriaField: this.acceptanceCriteriaField });
    return this.request<JiraIssue>(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${fields}`,
    );
  }

  /**
   * Search for issues using JQL with pagination.
   * Uses the /rest/api/3/search/jql endpoint (the POST /search endpoint was deprecated).
   * Returns all matching issues across multiple pages.
   */
  async searchIssues(jql: string, maxTotal?: number): Promise<JiraIssue[]> {
    const allIssues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    const limit = maxTotal ?? Infinity;
    const fields = buildIssueFields({ acceptanceCriteriaField: this.acceptanceCriteriaField });

    while (allIssues.length < limit) {
      const maxResults = Math.min(MAX_RESULTS_PER_PAGE, limit - allIssues.length);
      const params = new URLSearchParams({
        jql,
        fields,
        maxResults: String(maxResults),
      });
      if (nextPageToken) {
        params.set('nextPageToken', nextPageToken);
      }

      const response = await this.request<JiraSearchResponse>(
        'GET',
        `/rest/api/3/search/jql?${params.toString()}`,
      );

      allIssues.push(...response.issues);

      // Check if there are more pages
      if (!response.nextPageToken || response.issues.length === 0) {
        break;
      }

      nextPageToken = response.nextPageToken;
    }

    return allIssues;
  }

  /**
   * Get child issues of an epic.
   * Tries next-gen parent hierarchy first, falls back to classic Epic Link.
   *
   * @param epicKey - The epic issue key (e.g., "MYN-5000")
   * @param model - Hierarchy model: "auto", "parent", or "epic-link"
   */
  async getEpicChildren(epicKey: string, model: string = 'auto'): Promise<JiraIssue[]> {
    if (model === 'parent' || model === 'auto') {
      // Try next-gen parent hierarchy
      const parentJql = `parent = ${epicKey} ORDER BY priority ASC, key ASC`;
      const children = await this.searchIssues(parentJql);

      if (children.length > 0 || model === 'parent') {
        return children;
      }
    }

    // Fall back to classic Epic Link
    // "Epic Link" is typically customfield_10014 but JQL uses the field name
    const epicLinkJql = `"Epic Link" = ${epicKey} ORDER BY priority ASC, key ASC`;
    return this.searchIssues(epicLinkJql);
  }

  /**
   * Get available transitions for an issue.
   */
  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const response = await this.request<{ transitions: JiraTransition[] }>(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    );
    return response.transitions;
  }

  /**
   * Execute a workflow transition on an issue.
   */
  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request<void>(
      'POST',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      { transition: { id: transitionId } },
    );
  }

  /**
   * Add a comment to an issue.
   * Accepts either plain text (auto-wrapped in ADF) or a pre-built ADF document.
   */
  async addComment(issueKey: string, bodyOrText: string | AdfDocument): Promise<void> {
    const adfBody = typeof bodyOrText === 'string' ? textToAdf(bodyOrText) : bodyOrText;
    await this.request<unknown>(
      'POST',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      { body: adfBody },
    );
  }

  /**
   * List accessible projects.
   * Returns projects the authenticated user can see, optionally filtered by query.
   */
  async listProjects(query?: string): Promise<JiraProject[]> {
    const params = new URLSearchParams({ maxResults: '50', orderBy: 'name' });
    if (query) {
      params.set('query', query);
    }

    const response = await this.request<{ values: JiraProject[] }>(
      'GET',
      `/rest/api/3/project/search?${params.toString()}`,
    );
    return response.values;
  }

  /**
   * List epics in a project.
   * Returns all issues with type "Epic" in the given project.
   */
  async listEpics(projectKey: string): Promise<JiraIssue[]> {
    const jql = `project = ${projectKey} AND issuetype = Epic ORDER BY created DESC`;
    return this.searchIssues(jql);
  }

  /**
   * Validate that the client can authenticate and reach the Jira API.
   */
  async validateConnection(): Promise<void> {
    try {
      await this.request<unknown>('GET', '/rest/api/3/myself');
    } catch (err) {
      if (err instanceof JiraApiError) {
        throw err;
      }
      throw classifyError(err);
    }
  }
}

/**
 * Create a RalphJiraClient from tracker config options.
 * Resolves auth from config options or environment variables.
 */
export function createJiraClient(options?: Record<string, unknown>): RalphJiraClient {
  const config = resolveConfig(options);
  return new RalphJiraClient(config);
}
