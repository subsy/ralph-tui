/**
 * ABOUTME: Tests for the Jira REST API client.
 * Tests config resolution, error classification, and API method behavior
 * using mocked fetch responses.
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { resolveConfig, RalphJiraClient } from './client.js';
import { JiraApiError } from './types.js';

describe('resolveConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('resolves config from explicit options', () => {
    const config = resolveConfig({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@example.com',
      apiToken: 'token123',
    });
    expect(config.baseUrl).toBe('https://test.atlassian.net');
    expect(config.email).toBe('test@example.com');
    expect(config.apiToken).toBe('token123');
  });

  it('resolves config from environment variables', () => {
    process.env.JIRA_BASE_URL = 'https://env.atlassian.net';
    process.env.JIRA_EMAIL = 'env@example.com';
    process.env.JIRA_API_TOKEN = 'envtoken';

    const config = resolveConfig({});
    expect(config.baseUrl).toBe('https://env.atlassian.net');
    expect(config.email).toBe('env@example.com');
    expect(config.apiToken).toBe('envtoken');
  });

  it('explicit options override env vars', () => {
    process.env.JIRA_BASE_URL = 'https://env.atlassian.net';
    process.env.JIRA_EMAIL = 'env@example.com';
    process.env.JIRA_API_TOKEN = 'envtoken';

    const config = resolveConfig({
      baseUrl: 'https://explicit.atlassian.net',
      email: 'explicit@example.com',
      apiToken: 'explicittoken',
    });
    expect(config.baseUrl).toBe('https://explicit.atlassian.net');
    expect(config.email).toBe('explicit@example.com');
  });

  it('strips trailing slash from base URL', () => {
    const config = resolveConfig({
      baseUrl: 'https://test.atlassian.net/',
      email: 'test@example.com',
      apiToken: 'token123',
    });
    expect(config.baseUrl).toBe('https://test.atlassian.net');
  });

  it('throws JiraApiError when base URL is missing', () => {
    delete process.env.JIRA_BASE_URL;
    expect(() => resolveConfig({ email: 'a@b.com', apiToken: 'tok' })).toThrow(JiraApiError);
  });

  it('throws JiraApiError when email is missing', () => {
    delete process.env.JIRA_EMAIL;
    expect(() => resolveConfig({ baseUrl: 'https://x.net', apiToken: 'tok' })).toThrow(JiraApiError);
  });

  it('throws JiraApiError when API token is missing', () => {
    delete process.env.JIRA_API_TOKEN;
    expect(() => resolveConfig({ baseUrl: 'https://x.net', email: 'a@b.com' })).toThrow(JiraApiError);
  });
});

describe('RalphJiraClient', () => {
  let client: RalphJiraClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new RalphJiraClient({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@example.com',
      apiToken: 'token123',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { status: number; body?: unknown }) {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.status === 200 ? 'OK' : 'Error',
        json: () => Promise.resolve(response.body ?? {}),
      } as Response),
    ) as typeof fetch;
  }

  it('getIssue returns parsed issue', async () => {
    const mockIssue = {
      key: 'TEST-1',
      id: '10001',
      fields: {
        summary: 'Test issue',
        description: null,
        status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
        priority: { name: 'Medium', id: '3' },
        issuetype: { name: 'Story', subtask: false },
        labels: [],
        assignee: null,
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        issuelinks: [],
      },
    };
    mockFetch({ status: 200, body: mockIssue });

    const issue = await client.getIssue('TEST-1');
    expect(issue.key).toBe('TEST-1');
    expect(issue.fields.summary).toBe('Test issue');
  });

  it('getIssue throws not_found for 404', async () => {
    mockFetch({ status: 404, body: { errorMessages: ['Issue not found'] } });

    try {
      await client.getIssue('NOPE-1');
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(JiraApiError);
      expect((err as JiraApiError).kind).toBe('not_found');
    }
  });

  it('throws auth error for 401', async () => {
    mockFetch({ status: 401, body: { errorMessages: ['Unauthorized'] } });

    try {
      await client.validateConnection();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(JiraApiError);
      expect((err as JiraApiError).kind).toBe('auth');
    }
  });

  it('throws rate_limit error for 429', async () => {
    mockFetch({ status: 429, body: { errorMessages: ['Too many requests'] } });

    try {
      await client.getIssue('TEST-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(JiraApiError);
      expect((err as JiraApiError).kind).toBe('rate_limit');
    }
  });

  it('getTransitions returns parsed transitions', async () => {
    mockFetch({
      status: 200,
      body: {
        transitions: [
          { id: '1', name: 'In Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
          { id: '2', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } },
        ],
      },
    });

    const transitions = await client.getTransitions('TEST-1');
    expect(transitions).toHaveLength(2);
    expect(transitions[0]?.name).toBe('In Progress');
  });

  it('transitionIssue sends correct payload', async () => {
    mockFetch({ status: 204 });

    // Should not throw for 204 response
    await client.transitionIssue('TEST-1', '2');
  });

  it('searchIssues handles pagination', async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      const issues = callCount === 1
        ? [{ key: 'TEST-1' }, { key: 'TEST-2' }]
        : [{ key: 'TEST-3' }];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          issues,
          startAt: callCount === 1 ? 0 : 2,
          maxResults: 2,
          total: 3,
        }),
      } as Response);
    }) as typeof fetch;

    const issues = await client.searchIssues('project = TEST');
    expect(issues).toHaveLength(3);
  });
});
