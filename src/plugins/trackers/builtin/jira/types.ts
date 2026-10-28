/**
 * ABOUTME: Type definitions for the Jira tracker plugin.
 * Defines Jira REST API v3 response shapes, configuration, and error types
 * used by the client and tracker plugin.
 */

/**
 * Configuration for the Jira API client.
 * Auth precedence: explicit config fields override environment variables.
 */
export interface JiraClientConfig {
  /** Jira instance base URL (e.g., "https://company.atlassian.net") */
  baseUrl: string;
  /** Atlassian account email */
  email: string;
  /** Jira API token (from id.atlassian.com/manage-profile/security/api-tokens) */
  apiToken: string;
}

/**
 * Categorized error types for user-facing messages.
 */
export type JiraErrorKind =
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'network'
  | 'invalid_config'
  | 'unknown';

/**
 * Structured error from Jira API operations.
 * Provides a user-facing message and categorized error kind for programmatic handling.
 */
export class JiraApiError extends Error {
  readonly kind: JiraErrorKind;

  constructor(message: string, kind: JiraErrorKind, cause?: unknown) {
    super(message);
    this.name = 'JiraApiError';
    this.kind = kind;
    this.cause = cause;
  }
}

// ─── Jira REST API v3 response types ──────────────────────────────────────

/**
 * Jira issue status category.
 * Categories are fixed across all Jira instances and provide reliable status mapping.
 */
export interface JiraStatusCategory {
  /** Status category key: "new", "indeterminate", "done", or "undefined" */
  key: string;
  /** Display name (e.g., "To Do", "In Progress", "Done") */
  name: string;
}

/**
 * Jira issue status.
 */
export interface JiraStatus {
  name: string;
  statusCategory: JiraStatusCategory;
}

/**
 * Jira issue priority.
 */
export interface JiraPriority {
  name: string;
  id: string;
}

/**
 * Jira issue type.
 */
export interface JiraIssueType {
  name: string;
  subtask: boolean;
}

/**
 * Jira user reference (assignee, reporter, etc.)
 */
export interface JiraUser {
  displayName: string;
  emailAddress: string;
  accountId: string;
}

/**
 * Jira issue link type descriptor.
 */
export interface JiraIssueLinkType {
  /** Link type name (e.g., "Blocks") */
  name: string;
  /** Inward description (e.g., "is blocked by") */
  inward: string;
  /** Outward description (e.g., "blocks") */
  outward: string;
}

/**
 * Linked issue reference (minimal fields).
 */
export interface JiraLinkedIssue {
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
  };
}

/**
 * Jira issue link between two issues.
 */
export interface JiraIssueLink {
  type: JiraIssueLinkType;
  /** Present when this issue is the outward side (e.g., "blocks" the other) */
  inwardIssue?: JiraLinkedIssue;
  /** Present when this issue is the inward side (e.g., "is blocked by" the other) */
  outwardIssue?: JiraLinkedIssue;
}

/**
 * Jira subtask reference.
 */
export interface JiraSubtask {
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
  };
}

/**
 * Jira issue fields relevant to Ralph.
 * Uses an index signature for custom field access.
 */
export interface JiraIssueFields {
  summary: string;
  description: AdfDocument | null;
  status: JiraStatus;
  priority: JiraPriority | null;
  issuetype: JiraIssueType;
  labels: string[];
  assignee: JiraUser | null;
  created: string;
  updated: string;
  issuelinks: JiraIssueLink[];
  parent?: { key: string; fields: { summary: string } };
  subtasks?: JiraSubtask[];
  /** Custom fields accessed by ID (e.g., customfield_10037) */
  [key: string]: unknown;
}

/**
 * Jira issue response from the REST API.
 */
export interface JiraIssue {
  key: string;
  id: string;
  fields: JiraIssueFields;
}

/**
 * Jira workflow transition.
 */
export interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
    statusCategory: JiraStatusCategory;
  };
}

/**
 * Jira search response (paginated via /rest/api/3/search/jql).
 */
export interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  /** Token for fetching the next page of results. Absent on the last page. */
  nextPageToken?: string;
}

/**
 * Jira project summary from /rest/api/3/project/search.
 */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

// ─── Atlassian Document Format (ADF) types ────────────────────────────────

/**
 * ADF text mark (bold, italic, code, link, etc.)
 */
export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * ADF content node.
 */
export interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
}

/**
 * ADF root document.
 */
export interface AdfDocument {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

// ─── Plugin configuration types ───────────────────────────────────────────

/**
 * Custom status mapping from Jira status names to TrackerTaskStatus.
 */
export type StatusMapping = Record<string, string>;

/**
 * Jira tracker plugin options (from config file).
 */
export interface JiraTrackerOptions {
  /** Jira instance base URL */
  baseUrl?: string;
  /** Atlassian account email */
  email?: string;
  /** Jira API token */
  apiToken?: string;
  /** Jira project key for epic discovery (e.g., "SNSP") */
  projectKey?: string;
  /** Custom status name → TrackerTaskStatus mapping */
  statusMapping?: StatusMapping;
  /** How to extract acceptance criteria: "description" | "custom_field" | "subtasks" */
  acceptanceCriteriaSource?: string;
  /** Custom field ID for acceptance criteria (when using custom_field strategy) */
  acceptanceCriteriaField?: string;
  /** Hierarchy model: "auto" | "epic-link" | "parent" */
  hierarchyModel?: string;
  /** Epic ID to track (set via --epic CLI flag) */
  epicId?: string;
}
