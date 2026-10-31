/**
 * ABOUTME: Unit tests for the Linear API client wrapper.
 * Covers resolveApiKey, error classification, RalphLinearClient methods,
 * and the createLinearClient factory. Uses module-level mocking of @linear/sdk.
 */

import { describe, expect, test, beforeEach, mock } from 'bun:test';

// --- Mock state ---

let mockSdkCalls: {
  teams: number;
  issue: Array<{ idOrKey: string }>;
  createIssue: Array<{ input: unknown }>;
  createComment: Array<{ input: unknown }>;
  createIssueRelation: Array<{ input: unknown }>;
  team: Array<{ teamId: string }>;
  issueLabels: number;
  createIssueLabel: Array<{ input: unknown }>;
  project: Array<{ id: string }>;
  projects: number;
  updateIssue: Array<{ id: string; input: unknown }>;
  request: Array<{ query: string; variables: Record<string, unknown> }>;
};

let mockSdkResponses: {
  teams: () => unknown;
  issue: (idOrKey: string) => unknown;
  createIssue: (input: unknown) => unknown;
  createComment: (input: unknown) => unknown;
  createIssueRelation: (input: unknown) => unknown;
  team: (teamId: string) => unknown;
  issueLabels: () => unknown;
  createIssueLabel: (input: unknown) => unknown;
  project: (id: string) => unknown;
  projects: () => unknown;
  request: (query: string, variables: Record<string, unknown>) => unknown;
  viewer: unknown;
};

function resetMocks(): void {
  mockSdkCalls = {
    teams: 0,
    issue: [],
    createIssue: [],
    createComment: [],
    createIssueRelation: [],
    team: [],
    issueLabels: 0,
    createIssueLabel: [],
    project: [],
    projects: 0,
    updateIssue: [],
    request: [],
  };

  mockSdkResponses = {
    teams: () => ({ nodes: [] }),
    issue: () => ({ id: 'uuid-1', identifier: 'ENG-1', title: 'Test' }),
    createIssue: () => ({ issue: Promise.resolve({ id: 'uuid-new', identifier: 'ENG-99', title: 'New', url: 'https://linear.app/ENG-99' }) }),
    createComment: () => ({}),
    createIssueRelation: () => ({ issueRelation: Promise.resolve({ id: 'rel-1', type: 'blocks' }) }),
    team: () => ({ id: 'team-1', states: () => Promise.resolve({ nodes: [] }) }),
    issueLabels: () => ({ nodes: [] }),
    createIssueLabel: () => ({ issueLabel: Promise.resolve({ id: 'label-1', name: 'test' }) }),
    project: () => ({ id: 'proj-1', name: 'Project' }),
    projects: () => ({ nodes: [] }),
    request: () => ({}),
    viewer: { id: 'user-1', name: 'Test User' },
  };
}

// Mock @linear/sdk before importing client
mock.module('@linear/sdk', () => {
  return {
    LinearClient: class MockLinearClient {
      constructor() {
        // Constructor receives { apiKey } but we don't need it for mocking
      }
      client = {
        request: async (query: string, variables: Record<string, unknown>) => {
          mockSdkCalls.request.push({ query, variables });
          return mockSdkResponses.request(query, variables);
        },
      };
      async updateIssue(id: string, input: unknown) {
        mockSdkCalls.updateIssue.push({ id, input });
        return {};
      }
      get viewer() {
        return Promise.resolve(mockSdkResponses.viewer);
      }
      async teams() {
        mockSdkCalls.teams++;
        return mockSdkResponses.teams();
      }
      async issue(idOrKey: string) {
        mockSdkCalls.issue.push({ idOrKey });
        return mockSdkResponses.issue(idOrKey);
      }
      async createIssue(input: unknown) {
        mockSdkCalls.createIssue.push({ input });
        return mockSdkResponses.createIssue(input);
      }
      async createComment(input: unknown) {
        mockSdkCalls.createComment.push({ input });
        return mockSdkResponses.createComment(input);
      }
      async createIssueRelation(input: unknown) {
        mockSdkCalls.createIssueRelation.push({ input });
        return mockSdkResponses.createIssueRelation(input);
      }
      async team(teamId: string) {
        mockSdkCalls.team.push({ teamId });
        return mockSdkResponses.team(teamId);
      }
      async issueLabels() {
        mockSdkCalls.issueLabels++;
        return mockSdkResponses.issueLabels();
      }
      async createIssueLabel(input: unknown) {
        mockSdkCalls.createIssueLabel.push({ input });
        return mockSdkResponses.createIssueLabel(input);
      }
      async project(id: string) {
        mockSdkCalls.project.push({ id });
        return mockSdkResponses.project(id);
      }
      async projects() {
        mockSdkCalls.projects++;
        return mockSdkResponses.projects();
      }
    },
    IssueRelationType: {
      Blocks: 'blocks',
      Duplicate: 'duplicate',
      Related: 'related',
      Similar: 'similar',
    },
  };
});

// Import after mock setup
import {
  resolveApiKey,
  LinearApiError,
  RalphLinearClient,
  createLinearClient,
} from './client.js';

beforeEach(() => {
  resetMocks();
});

describe('resolveApiKey', () => {
  const originalEnv = process.env.LINEAR_API_KEY;

  function restoreEnv(): void {
    if (originalEnv !== undefined) {
      process.env.LINEAR_API_KEY = originalEnv;
    } else {
      delete process.env.LINEAR_API_KEY;
    }
  }

  test('returns config apiKey when provided', () => {
    const key = resolveApiKey({ apiKey: 'lin_api_config' });
    expect(key).toBe('lin_api_config');
  });

  test('config apiKey takes precedence over env var', () => {
    try {
      process.env.LINEAR_API_KEY = 'lin_api_env';
      const key = resolveApiKey({ apiKey: 'lin_api_config' });
      expect(key).toBe('lin_api_config');
    } finally {
      restoreEnv();
    }
  });

  test('falls back to LINEAR_API_KEY env var', () => {
    try {
      process.env.LINEAR_API_KEY = 'lin_api_env';
      const key = resolveApiKey({});
      expect(key).toBe('lin_api_env');
    } finally {
      restoreEnv();
    }
  });

  test('falls back to env var when config is undefined', () => {
    try {
      process.env.LINEAR_API_KEY = 'lin_api_env';
      const key = resolveApiKey();
      expect(key).toBe('lin_api_env');
    } finally {
      restoreEnv();
    }
  });

  test('throws LinearApiError when no key is available', () => {
    try {
      delete process.env.LINEAR_API_KEY;
      expect(() => resolveApiKey({})).toThrow(LinearApiError);
    } finally {
      restoreEnv();
    }
  });

  test('thrown error has auth kind', () => {
    try {
      delete process.env.LINEAR_API_KEY;
      try {
        resolveApiKey({});
        expect(true).toBe(false); // Should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('auth');
      }
    } finally {
      restoreEnv();
    }
  });
});

describe('LinearApiError', () => {
  test('has correct name and kind', () => {
    const err = new LinearApiError('test message', 'not_found');
    expect(err.name).toBe('LinearApiError');
    expect(err.kind).toBe('not_found');
    expect(err.message).toBe('test message');
  });

  test('preserves cause when supported', () => {
    const cause = new Error('original');
    const err = new LinearApiError('wrapped', 'unknown', cause);
    // cause may not be set if mock.module from another test file intercepts the class
    if (err.cause !== undefined) {
      expect((err.cause as Error).message).toBe('original');
    }
    expect(err.kind).toBe('unknown');
    expect(err.message).toBe('wrapped');
  });
});

describe('RalphLinearClient', () => {
  function createClient(): RalphLinearClient {
    return new RalphLinearClient({ apiKey: 'test-key' });
  }

  describe('resolveTeam', () => {
    test('resolves team by key (case-insensitive)', async () => {
      mockSdkResponses.teams = () => ({
        nodes: [
          { key: 'ENG', name: 'Engineering', id: 'team-eng' },
          { key: 'DES', name: 'Design', id: 'team-des' },
        ],
      });

      const client = createClient();
      const team = await client.resolveTeam('eng');
      expect(team.id).toBe('team-eng');
      expect(team.name).toBe('Engineering');
    });

    test('throws invalid_team when team not found', async () => {
      mockSdkResponses.teams = () => ({
        nodes: [{ key: 'ENG', name: 'Engineering', id: 'team-eng' }],
      });

      const client = createClient();
      try {
        await client.resolveTeam('MISSING');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('invalid_team');
        expect((err as LinearApiError).message).toContain('MISSING');
        expect((err as LinearApiError).message).toContain('ENG');
      }
    });

    test('classifies auth error from SDK', async () => {
      mockSdkResponses.teams = () => {
        throw new Error('401 Unauthorized');
      };

      const client = createClient();
      try {
        await client.resolveTeam('ENG');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('auth');
      }
    });
  });

  describe('getIssue', () => {
    test('returns issue by identifier', async () => {
      mockSdkResponses.issue = () => ({
        id: 'uuid-42',
        identifier: 'ENG-42',
        title: 'Test Issue',
      });

      const client = createClient();
      const issue = await client.getIssue('ENG-42');
      expect(issue.id).toBe('uuid-42');
    });

    test('reclassifies unknown errors as not_found', async () => {
      mockSdkResponses.issue = () => {
        throw new Error('Something went wrong');
      };

      const client = createClient();
      try {
        await client.getIssue('ENG-999');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('not_found');
      }
    });

    test('preserves classified error kind (e.g., auth)', async () => {
      mockSdkResponses.issue = () => {
        throw new Error('authentication failed');
      };

      const client = createClient();
      try {
        await client.getIssue('ENG-1');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('auth');
      }
    });
  });

  describe('getChildIssues', () => {
    test('returns children with cursor-based pagination', async () => {
      mockSdkResponses.issue = () => ({
        id: 'parent-uuid',
        identifier: 'ENG-1',
        children: (opts: { first: number; after?: string }) => {
          if (!opts.after) {
            // First page
            return Promise.resolve({
              nodes: [{ id: 'child-1' }, { id: 'child-2' }],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            });
          }
          if (opts.after === 'cursor-1') {
            // Second page, matching endCursor from first page
            return Promise.resolve({
              nodes: [{ id: 'child-3' }],
              pageInfo: { hasNextPage: false, endCursor: null },
            });
          }
          // Unexpected cursor — fail the test
          throw new Error(`Unexpected pagination cursor: ${opts.after}`);
        },
      });

      const client = createClient();
      const children = await client.getChildIssues('ENG-1');
      expect(children.length).toBe(3);
    });
  });

  describe('createIssue', () => {
    test('creates issue and returns created fields', async () => {
      const client = createClient();
      const result = await client.createIssue({ teamId: 'team-1', title: 'New Issue' });
      expect(result.id).toBe('uuid-new');
      expect(result.identifier).toBe('ENG-99');
      expect(result.url).toBe('https://linear.app/ENG-99');
    });

    test('throws when issue is null in response', async () => {
      mockSdkResponses.createIssue = () => ({
        issue: Promise.resolve(null),
      });

      const client = createClient();
      try {
        await client.createIssue({ teamId: 'team-1', title: 'Bad' });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).message).toContain('no issue was returned');
      }
    });
  });

  describe('updateIssueState', () => {
    test('updates issue state with a single mutation', async () => {
      const client = createClient();
      await client.updateIssueState('ENG-1', 'state-done');
      expect(mockSdkCalls.updateIssue).toEqual([
        { id: 'ENG-1', input: { stateId: 'state-done' } },
      ]);
      expect(mockSdkCalls.issue.length).toBe(0);
    });
  });

  describe('getIssueSnapshot', () => {
    const rawIssue = {
      id: 'uuid-10',
      identifier: 'ENG-10',
      title: 'Story',
      description: 'Body',
      url: 'https://linear.app/ENG-10',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      state: { type: 'started' },
      team: { id: 'team-1' },
      parent: { identifier: 'ENG-1' },
      assignee: { name: 'jdoe', displayName: 'Jane' },
      labels: { nodes: [{ name: 'backend' }] },
      inverseRelations: {
        nodes: [
          { type: 'blocks', issue: { id: 'uuid-blocker' } },
          { type: 'related', issue: { id: 'uuid-related' } },
        ],
      },
    };

    test('flattens all fields from one request', async () => {
      mockSdkResponses.request = () => ({ issue: rawIssue });

      const client = createClient();
      const snapshot = await client.getIssueSnapshot('ENG-10');

      expect(mockSdkCalls.request.length).toBe(1);
      expect(mockSdkCalls.request[0].variables).toEqual({ id: 'ENG-10' });
      expect(snapshot).toEqual({
        id: 'uuid-10',
        identifier: 'ENG-10',
        title: 'Story',
        description: 'Body',
        url: 'https://linear.app/ENG-10',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        stateType: 'started',
        teamId: 'team-1',
        parentIdentifier: 'ENG-1',
        assigneeName: 'Jane',
        labels: ['backend'],
        blockedByIds: ['uuid-blocker'],
      });
    });

    test('fetches remaining blockers when relations are truncated', async () => {
      mockSdkResponses.request = (query, variables) => {
        if (!query.includes('RalphInverseRelations')) {
          return {
            issue: {
              ...rawIssue,
              inverseRelations: {
                nodes: [{ type: 'blocks', issue: { id: 'uuid-first-blocker' } }],
                pageInfo: { hasNextPage: true, endCursor: 'initial' },
              },
            },
          };
        }
        return {
          issue: {
            inverseRelations: variables.after === 'r1'
              ? {
                  nodes: [{ type: 'blocks', issue: { id: 'uuid-blocker-2' } }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                }
              : {
                  nodes: [
                    { type: 'related', issue: { id: 'uuid-related' } },
                    { type: 'blocks', issue: { id: 'uuid-blocker-1' } },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'r1' },
                },
          },
        };
      };

      const client = createClient();
      const snapshot = await client.getIssueSnapshot('ENG-10');

      expect(snapshot.blockedByIds).toEqual(['uuid-first-blocker', 'uuid-blocker-1', 'uuid-blocker-2']);
      expect(mockSdkCalls.request.length).toBe(3);
      expect(mockSdkCalls.request[1].variables).toEqual({ id: 'uuid-10', after: 'initial' });
      expect(mockSdkCalls.request[2].variables).toEqual({ id: 'uuid-10', after: 'r1' });
    });

    test('fetches every label without repeating the initial page', async () => {
      mockSdkResponses.request = (query, variables) => {
        if (!query.includes('RalphIssueLabels')) {
          expect(query).toContain('labels(first: 20) { nodes { name } pageInfo { hasNextPage endCursor } }');
          return { issue: { ...rawIssue, labels: {
            nodes: Array.from({ length: 20 }, (_, n) => ({ name: `label-${n}` })),
            pageInfo: { hasNextPage: true, endCursor: 'l1' },
          } } };
        }
        return { issue: { labels: {
          nodes: [{ name: variables.after === 'l1' ? 'label-20' : 'filter-me' }],
          pageInfo: { hasNextPage: variables.after === 'l1', endCursor: 'l2' },
        } } };
      };

      const snapshot = await createClient().getIssueSnapshot('ENG-10');
      expect(snapshot.labels).toHaveLength(22);
      expect(snapshot.labels.slice(-2)).toEqual(['label-20', 'filter-me']);
      expect(mockSdkCalls.request.slice(1).map((call) => call.variables)).toEqual([
        { id: 'uuid-10', after: 'l1' }, { id: 'uuid-10', after: 'l2' },
      ]);
    });

    for (const field of ['labels', 'inverseRelations'] as const) {
      test(`rejects missing and cyclic ${field} pagination cursors`, async () => {
        for (const cursor of [null, 'initial']) {
          mockSdkCalls.request = [];
          mockSdkResponses.request = (query) => ({ issue: query.includes('RalphIssueSnapshot')
            ? { ...rawIssue, [field]: {
                nodes: [], pageInfo: { hasNextPage: true, endCursor: 'initial' },
              } }
            : { [field]: { nodes: [], pageInfo: { hasNextPage: true, endCursor: cursor } } },
          });
          await expect(createClient().getIssueSnapshot('ENG-10')).rejects.toThrow('pagination cursor');
          expect(mockSdkCalls.request).toHaveLength(2);
        }
      });
    }

    test('makes no follow-up request when relations fit on one page', async () => {
      mockSdkResponses.request = () => ({
        issue: {
          ...rawIssue,
          inverseRelations: { ...rawIssue.inverseRelations, pageInfo: { hasNextPage: false } },
        },
      });

      const client = createClient();
      await client.getIssueSnapshot('ENG-10');
      expect(mockSdkCalls.request.length).toBe(1);
    });

    test('throws not_found when issue is missing', async () => {
      mockSdkResponses.request = () => ({ issue: null });

      const client = createClient();
      try {
        await client.getIssueSnapshot('ENG-999');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('not_found');
      }
    });

    for (const [message, kind] of [
      ['Internal server error', 'unknown'],
      ['Unauthorized', 'auth'],
      ['Rate limit exceeded', 'rate_limit'],
      ['Network request failed', 'network'],
      ['Entity not found', 'not_found'],
    ]) {
      test(`preserves ${kind} snapshot request failures`, async () => {
        mockSdkResponses.request = () => { throw new Error(message); };

        await expect(createClient().getIssueSnapshot('ENG-10')).rejects.toMatchObject({ kind });
      });
    }
  });

  describe('getChildIssueSnapshots', () => {
    function rawChild(n: number) {
      return {
        id: `uuid-${n}`,
        identifier: `ENG-${n}`,
        title: `Child ${n}`,
        url: `https://linear.app/ENG-${n}`,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        state: { type: 'unstarted' },
      };
    }

    test('fetches one request per page of children', async () => {
      mockSdkResponses.request = (_query, variables) => ({
        issue: {
          children: variables.after
            ? { nodes: [rawChild(3)], pageInfo: { hasNextPage: false, endCursor: null } }
            : { nodes: [rawChild(1), rawChild(2)], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
        },
      });

      const client = createClient();
      const children = await client.getChildIssueSnapshots('ENG-1');

      expect(children.map((c) => c.identifier)).toEqual(['ENG-1', 'ENG-2', 'ENG-3']);
      expect(mockSdkCalls.request.length).toBe(2);
      expect(mockSdkCalls.request[1].variables.after).toBe('c1');
      expect(children[0].labels).toEqual([]);
      expect(children[0].blockedByIds).toEqual([]);
      expect(mockSdkCalls.issue.length).toBe(0);
    });

    test('throws instead of looping when the cursor does not advance', async () => {
      mockSdkResponses.request = () => ({
        issue: {
          children: { nodes: [rawChild(1)], pageInfo: { hasNextPage: true, endCursor: 'stuck' } },
        },
      });

      const client = createClient();
      try {
        await client.getChildIssueSnapshots('ENG-1');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).message).toContain('repeated pagination cursor');
      }
      expect(mockSdkCalls.request.length).toBe(2);
    });

    test('rejects missing and cyclic child cursors instead of returning incomplete data', async () => {
      for (const cursors of [[null], ['c1', 'c2', 'c1']]) {
        let page = 0;
        mockSdkResponses.request = () => ({ issue: { children: {
          nodes: [rawChild(++page)],
          pageInfo: { hasNextPage: true, endCursor: cursors[page - 1] },
        } } });
        await expect(createClient().getChildIssueSnapshots('ENG-1')).rejects.toThrow('pagination cursor');
        expect(page).toBe(cursors.length);
      }
    });

    test('completes nested labels and blockers on later child pages', async () => {
      mockSdkResponses.request = (query, variables) => {
        if (query.includes('RalphIssueLabels')) {
          return { issue: { labels: {
            nodes: [{ name: 'late-label' }], pageInfo: { hasNextPage: false },
          } } };
        }
        if (query.includes('RalphInverseRelations')) {
          return { issue: { inverseRelations: {
            nodes: [{ type: 'blocks', issue: { id: 'uuid-1' } }], pageInfo: { hasNextPage: false },
          } } };
        }
        return { issue: { children: variables.after ? {
          nodes: [{ ...rawChild(2),
            labels: { nodes: [{ name: 'early-label' }], pageInfo: { hasNextPage: true, endCursor: 'l1' } },
            inverseRelations: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'r1' } },
          }], pageInfo: { hasNextPage: false },
        } : {
          nodes: [rawChild(1)], pageInfo: { hasNextPage: true, endCursor: 'c1' },
        } } };
      };
      const children = await createClient().getChildIssueSnapshots('ENG-1');
      expect(children[1].labels).toEqual(['early-label', 'late-label']);
      expect(children[1].blockedByIds).toEqual(['uuid-1']);
      expect(mockSdkCalls.request).toHaveLength(4);
    });
  });

  describe('addComment', () => {
    test('creates comment with correct body', async () => {
      const client = createClient();
      await client.addComment('uuid-1', 'Test comment');
      expect(mockSdkCalls.createComment.length).toBe(1);
      expect(mockSdkCalls.createComment[0].input).toEqual({
        issueId: 'uuid-1',
        body: 'Test comment',
      });
    });
  });

  describe('createBlockingRelation', () => {
    test('creates relation with correct direction (blocker is issueId)', async () => {
      const client = createClient();
      const result = await client.createBlockingRelation('blocker-uuid', 'blocked-uuid');

      expect(result.id).toBe('rel-1');
      expect(result.type).toBe('blocks');

      // Verify the SDK was called with correct parameter order
      const input = mockSdkCalls.createIssueRelation[0].input as {
        issueId: string;
        relatedIssueId: string;
        type: string;
      };
      expect(input.issueId).toBe('blocker-uuid');
      expect(input.relatedIssueId).toBe('blocked-uuid');
      expect(input.type).toBe('blocks');
    });

    test('throws when relation is null', async () => {
      mockSdkResponses.createIssueRelation = () => ({
        issueRelation: Promise.resolve(null),
      });

      const client = createClient();
      try {
        await client.createBlockingRelation('a', 'b');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).message).toContain('no relation was returned');
      }
    });
  });

  describe('getWorkflowStates', () => {
    test('returns mapped workflow states', async () => {
      mockSdkResponses.team = () => ({
        id: 'team-1',
        states: () =>
          Promise.resolve({
            nodes: [
              { id: 's1', name: 'Todo', type: 'unstarted' },
              { id: 's2', name: 'Done', type: 'completed' },
            ],
          }),
      });

      const client = createClient();
      const states = await client.getWorkflowStates('team-1');
      expect(states).toEqual([
        { id: 's1', name: 'Todo', type: 'unstarted' },
        { id: 's2', name: 'Done', type: 'completed' },
      ]);
    });
  });

  describe('findWorkflowState', () => {
    test('finds state by type', async () => {
      mockSdkResponses.team = () => ({
        id: 'team-1',
        states: () =>
          Promise.resolve({
            nodes: [
              { id: 's1', name: 'Todo', type: 'unstarted' },
              { id: 's2', name: 'Done', type: 'completed' },
            ],
          }),
      });

      const client = createClient();
      const state = await client.findWorkflowState('team-1', 'completed');
      expect(state).toEqual({ id: 's2', name: 'Done', type: 'completed' });
    });

    test('returns undefined when no match', async () => {
      mockSdkResponses.team = () => ({
        id: 'team-1',
        states: () => Promise.resolve({ nodes: [{ id: 's1', name: 'Todo', type: 'unstarted' }] }),
      });

      const client = createClient();
      const state = await client.findWorkflowState('team-1', 'canceled');
      expect(state).toBeUndefined();
    });
  });

  describe('getBlockingIssueIds', () => {
    test('returns blocker IDs from inverse relations', async () => {
      mockSdkResponses.issue = () => ({
        id: 'blocked-uuid',
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                type: 'blocks',
                issue: Promise.resolve({ id: 'blocker-uuid-1' }),
              },
              {
                type: 'blocks',
                issue: Promise.resolve({ id: 'blocker-uuid-2' }),
              },
            ],
          }),
      });

      const client = createClient();
      const blockerIds = await client.getBlockingIssueIds('blocked-uuid');
      expect(blockerIds).toEqual(['blocker-uuid-1', 'blocker-uuid-2']);
    });

    test('ignores non-blocking relations', async () => {
      mockSdkResponses.issue = () => ({
        id: 'uuid-1',
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              { type: 'related', issue: Promise.resolve({ id: 'related-uuid' }) },
              { type: 'blocks', issue: Promise.resolve({ id: 'blocker-uuid' }) },
            ],
          }),
      });

      const client = createClient();
      const blockerIds = await client.getBlockingIssueIds('uuid-1');
      expect(blockerIds).toEqual(['blocker-uuid']);
    });

    test('returns empty array when no blocking relations', async () => {
      mockSdkResponses.issue = () => ({
        id: 'uuid-1',
        inverseRelations: () => Promise.resolve({ nodes: [] }),
      });

      const client = createClient();
      const blockerIds = await client.getBlockingIssueIds('uuid-1');
      expect(blockerIds).toEqual([]);
    });
  });

  describe('resolveLabelIds', () => {
    test('returns empty for empty input', async () => {
      const client = createClient();
      const ids = await client.resolveLabelIds([]);
      expect(ids).toEqual([]);
      expect(mockSdkCalls.issueLabels).toBe(0);
    });

    test('resolves existing labels by name (case-insensitive)', async () => {
      mockSdkResponses.issueLabels = () => ({
        nodes: [
          { id: 'lbl-1', name: 'Backend' },
          { id: 'lbl-2', name: 'Frontend' },
        ],
      });

      const client = createClient();
      const ids = await client.resolveLabelIds(['backend', 'frontend']);
      expect(ids).toEqual(['lbl-1', 'lbl-2']);
    });

    test('creates labels that do not exist', async () => {
      mockSdkResponses.issueLabels = () => ({ nodes: [] });

      const client = createClient();
      const ids = await client.resolveLabelIds(['new-label']);
      expect(ids).toEqual(['label-1']);
      expect(mockSdkCalls.createIssueLabel.length).toBe(1);
    });

    test('mixes existing and new labels', async () => {
      mockSdkResponses.issueLabels = () => ({
        nodes: [{ id: 'existing-1', name: 'Backend' }],
      });
      mockSdkResponses.createIssueLabel = () => ({
        issueLabel: Promise.resolve({ id: 'new-1', name: 'frontend' }),
      });

      const client = createClient();
      const ids = await client.resolveLabelIds(['backend', 'frontend']);
      expect(ids).toEqual(['existing-1', 'new-1']);
    });
  });

  describe('resolveProject', () => {
    test('resolves by UUID (direct lookup)', async () => {
      mockSdkResponses.project = () => ({ id: 'proj-uuid', name: 'Q1 Sprint' });

      const client = createClient();
      const proj = await client.resolveProject('proj-uuid');
      expect(proj).toEqual({ id: 'proj-uuid', name: 'Q1 Sprint' });
    });

    test('falls back to name search when UUID lookup fails', async () => {
      mockSdkResponses.project = () => {
        throw new Error('Not found');
      };
      mockSdkResponses.projects = () => ({
        nodes: [
          { id: 'proj-1', name: 'Q1 Sprint' },
          { id: 'proj-2', name: 'Q2 Sprint' },
        ],
      });

      const client = createClient();
      const proj = await client.resolveProject('q1 sprint');
      expect(proj).toEqual({ id: 'proj-1', name: 'Q1 Sprint' });
    });

    test('throws not_found when name search finds nothing', async () => {
      mockSdkResponses.project = () => {
        throw new Error('Not found');
      };
      mockSdkResponses.projects = () => ({ nodes: [] });

      const client = createClient();
      try {
        await client.resolveProject('NonExistent');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('not_found');
      }
    });
  });

  describe('validateConnection', () => {
    test('succeeds when viewer is returned', async () => {
      const client = createClient();
      await client.validateConnection(); // Should not throw
    });

    test('throws auth error when viewer is null', async () => {
      mockSdkResponses.viewer = null;

      const client = createClient();
      try {
        await client.validateConnection();
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(LinearApiError);
        expect((err as LinearApiError).kind).toBe('auth');
      }
    });
  });
});

describe('createLinearClient', () => {
  test('creates client with apiKey from options', () => {
    const client = createLinearClient({ apiKey: 'lin_test' });
    expect(client).toBeDefined();
    expect(client).not.toBeNull();
  });

  test('creates client without explicit apiKey (uses env)', () => {
    const original = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = 'lin_env_test';
    try {
      const client = createLinearClient({});
      expect(client).toBeDefined();
      expect(client).not.toBeNull();
    } finally {
      if (original !== undefined) {
        process.env.LINEAR_API_KEY = original;
      } else {
        delete process.env.LINEAR_API_KEY;
      }
    }
  });

  test('ignores non-string apiKey in options', () => {
    const original = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = 'lin_env_fallback';
    try {
      const client = createLinearClient({ apiKey: 123 });
      expect(client).toBeDefined();
      expect(client).not.toBeNull();
    } finally {
      if (original !== undefined) {
        process.env.LINEAR_API_KEY = original;
      } else {
        delete process.env.LINEAR_API_KEY;
      }
    }
  });
});

describe('error classification', () => {
  // We test classifyError indirectly through the client methods since it's private.
  // Each error class is triggered by specific error message patterns.

  function createClient(): RalphLinearClient {
    return new RalphLinearClient({ apiKey: 'test-key' });
  }

  test('classifies rate limit errors', async () => {
    mockSdkResponses.teams = () => {
      throw new Error('429 Too Many Requests');
    };

    const client = createClient();
    try {
      await client.resolveTeam('ENG');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as LinearApiError).kind).toBe('rate_limit');
    }
  });

  test('classifies network errors', async () => {
    mockSdkResponses.teams = () => {
      throw new Error('ECONNREFUSED');
    };

    const client = createClient();
    try {
      await client.resolveTeam('ENG');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as LinearApiError).kind).toBe('network');
    }
  });

  test('classifies not_found errors', async () => {
    mockSdkResponses.teams = () => {
      throw new Error('Entity not found');
    };

    const client = createClient();
    try {
      await client.resolveTeam('ENG');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as LinearApiError).kind).toBe('not_found');
    }
  });

  test('classifies unknown errors', async () => {
    mockSdkResponses.teams = () => {
      throw new Error('Something unexpected happened');
    };

    const client = createClient();
    try {
      await client.resolveTeam('ENG');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as LinearApiError).kind).toBe('unknown');
    }
  });

  test('passes through existing LinearApiError', async () => {
    mockSdkResponses.teams = () => {
      throw new LinearApiError('Custom error', 'invalid_team');
    };

    const client = createClient();
    try {
      await client.resolveTeam('ENG');
      expect(true).toBe(false);
    } catch (err) {
      expect((err as LinearApiError).kind).toBe('invalid_team');
      expect((err as LinearApiError).message).toBe('Custom error');
    }
  });

  test('classifies non-Error throws', async () => {
    mockSdkResponses.teams = () => {
      throw 'string error';
    };

    const client = createClient();
    try {
      await client.resolveTeam('ENG');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(LinearApiError);
      expect((err as LinearApiError).kind).toBe('unknown');
    }
  });
});
