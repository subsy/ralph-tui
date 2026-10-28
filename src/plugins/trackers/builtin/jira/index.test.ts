/**
 * ABOUTME: Tests for the Jira tracker plugin.
 * Tests status mapping, priority mapping, task conversion, dependency resolution,
 * acceptance criteria extraction, completion flow, and epic discovery.
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { JiraTrackerPlugin } from './index.js';
import type { JiraIssue } from './types.js';

/**
 * Build a minimal mock JiraIssue for testing.
 */
function mockIssue(overrides: Partial<{
  key: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  priorityName: string;
  typeName: string;
  labels: string[];
  description: unknown;
  issuelinks: unknown[];
  parentKey: string;
  subtasks: unknown[];
  assignee: string;
}>): JiraIssue {
  return {
    key: overrides.key ?? 'TEST-1',
    id: '10001',
    fields: {
      summary: overrides.summary ?? 'Test issue',
      description: overrides.description as JiraIssue['fields']['description'] ?? null,
      status: {
        name: overrides.statusName ?? 'To Do',
        statusCategory: {
          key: overrides.statusCategory ?? 'new',
          name: overrides.statusName ?? 'To Do',
        },
      },
      priority: overrides.priorityName
        ? { name: overrides.priorityName, id: '1' }
        : null,
      issuetype: { name: overrides.typeName ?? 'Story', subtask: false },
      labels: overrides.labels ?? [],
      assignee: overrides.assignee
        ? { displayName: overrides.assignee, emailAddress: 'test@test.com', accountId: '123' }
        : null,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      issuelinks: (overrides.issuelinks ?? []) as JiraIssue['fields']['issuelinks'],
      parent: overrides.parentKey
        ? { key: overrides.parentKey, fields: { summary: 'Parent' } }
        : undefined,
      subtasks: (overrides.subtasks ?? []) as JiraIssue['fields']['subtasks'],
    },
  };
}

describe('JiraTrackerPlugin', () => {
  it('has correct plugin metadata', () => {
    const plugin = new JiraTrackerPlugin();
    expect(plugin.meta.id).toBe('jira');
    expect(plugin.meta.supportsHierarchy).toBe(true);
    expect(plugin.meta.supportsDependencies).toBe(true);
  });

  it('provides setup questions including projectKey', () => {
    const plugin = new JiraTrackerPlugin();
    const questions = plugin.getSetupQuestions();
    expect(questions.length).toBe(4);
    expect(questions.find((q) => q.id === 'baseUrl')).toBeTruthy();
    expect(questions.find((q) => q.id === 'email')).toBeTruthy();
    expect(questions.find((q) => q.id === 'apiToken')).toBeTruthy();
    expect(questions.find((q) => q.id === 'projectKey')).toBeTruthy();
  });

  it('epicId getter/setter works', () => {
    const plugin = new JiraTrackerPlugin();
    expect(plugin.getEpicId()).toBe('');
    plugin.setEpicId('MYN-5000');
    expect(plugin.getEpicId()).toBe('MYN-5000');
  });

  it('returns template string with required placeholders', () => {
    const plugin = new JiraTrackerPlugin();
    const template = plugin.getTemplate();
    expect(template).toContain('{{taskId}}');
    expect(template).toContain('{{taskTitle}}');
    expect(template).toContain('COMPLETE');
    expect(template).toContain('{{#if prd}}');
    expect(template).toContain('{{#if acceptanceCriteria}}');
  });

  it('getTasks returns empty array when no epicId set', async () => {
    const plugin = new JiraTrackerPlugin();
    const tasks = await plugin.getTasks();
    expect(tasks).toEqual([]);
  });

  it('getEpics returns empty when no epicId and no projectKey', async () => {
    const plugin = new JiraTrackerPlugin();
    const epics = await plugin.getEpics();
    expect(epics).toEqual([]);
  });

  it('sync clears caches and returns success', async () => {
    const plugin = new JiraTrackerPlugin();
    const result = await plugin.sync();
    expect(result.success).toBe(true);
    expect(result.syncedAt).toBeTruthy();
  });

  it('getPrdContext returns null when no epicId set', async () => {
    const plugin = new JiraTrackerPlugin();
    const ctx = await plugin.getPrdContext();
    expect(ctx).toBeNull();
  });
});

// Test the mapping functions via the module's internal behavior.
// We use a pattern where we initialize the plugin with a mock client
// by intercepting fetch at the global level.

describe('Jira status mapping', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function setupPlugin(issues: JiraIssue[], options?: Record<string, unknown>) {
    const config = {
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
      ...options,
    };

    globalThis.fetch = mock((url: string) => {
      const urlStr = String(url);
      // Epic children search
      if (urlStr.includes('/search/jql')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issues, total: issues.length }),
        } as Response);
      }
      // Single issue fetch
      if (urlStr.includes('/rest/api/3/issue/')) {
        const key = urlStr.split('/issue/')[1]?.split('?')[0];
        const issue = issues.find((i) => i.key === key) ?? issues[0];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(issue),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    }) as unknown as typeof fetch;

    return plugin.initialize(config);
  }

  it('maps "new" status category to open', async () => {
    await setupPlugin([mockIssue({ statusCategory: 'new', statusName: 'To Do' })]);
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.status).toBe('open');
  });

  it('maps "indeterminate" status category to in_progress', async () => {
    await setupPlugin([mockIssue({ statusCategory: 'indeterminate', statusName: 'In Progress' })]);
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.status).toBe('in_progress');
  });

  it('maps "done" status category to completed', async () => {
    await setupPlugin([mockIssue({ statusCategory: 'done', statusName: 'Done' })]);
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.status).toBe('completed');
  });

  it('uses custom statusMapping when configured', async () => {
    await setupPlugin(
      [mockIssue({ statusCategory: 'indeterminate', statusName: 'Code Review' })],
      { statusMapping: { 'Code Review': 'blocked' } },
    );
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.status).toBe('blocked');
  });

  it('falls back to category when custom mapping has no match', async () => {
    await setupPlugin(
      [mockIssue({ statusCategory: 'indeterminate', statusName: 'In Progress' })],
      { statusMapping: { 'Code Review': 'blocked' } },
    );
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.status).toBe('in_progress');
  });
});

describe('Jira priority mapping', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function getPriorityForName(name: string): Promise<number> {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          issues: [mockIssue({ priorityName: name })],
          total: 1,
        }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });

    const tasks = await plugin.getTasks();
    return tasks[0]?.priority ?? -1;
  }

  it('maps Highest to P0', async () => { expect(await getPriorityForName('Highest')).toBe(0); });
  it('maps Blocker to P0', async () => { expect(await getPriorityForName('Blocker')).toBe(0); });
  it('maps Critical to P0', async () => { expect(await getPriorityForName('Critical')).toBe(0); });
  it('maps High to P1', async () => { expect(await getPriorityForName('High')).toBe(1); });
  it('maps Medium to P2', async () => { expect(await getPriorityForName('Medium')).toBe(2); });
  it('maps Low to P3', async () => { expect(await getPriorityForName('Low')).toBe(3); });
  it('maps Lowest to P4', async () => { expect(await getPriorityForName('Lowest')).toBe(4); });
  it('maps P1 to P0', async () => { expect(await getPriorityForName('P1')).toBe(0); });
  it('maps P2 to P1', async () => { expect(await getPriorityForName('P2')).toBe(1); });
  it('maps P3 to P2', async () => { expect(await getPriorityForName('P3')).toBe(2); });
  it('maps P4 to P3', async () => { expect(await getPriorityForName('P4')).toBe(3); });
  it('maps P5 to P4', async () => { expect(await getPriorityForName('P5')).toBe(4); });
  it('maps null priority to P2 (medium default)', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          issues: [mockIssue({})],
          total: 1,
        }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.priority).toBe(2);
  });
});

describe('Jira issue type mapping', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function getTypeForName(name: string): Promise<string | undefined> {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          issues: [mockIssue({ typeName: name })],
          total: 1,
        }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });
    const tasks = await plugin.getTasks();
    return tasks[0]?.type;
  }

  it('maps Story to story', async () => { expect(await getTypeForName('Story')).toBe('story'); });
  it('maps Bug to bug', async () => { expect(await getTypeForName('Bug')).toBe('bug'); });
  it('maps Task to task', async () => { expect(await getTypeForName('Task')).toBe('task'); });
  it('maps Epic to epic', async () => { expect(await getTypeForName('Epic')).toBe('epic'); });
  it('maps Sub-task to task', async () => { expect(await getTypeForName('Sub-task')).toBe('task'); });
  it('maps unknown type to task', async () => { expect(await getTypeForName('Custom Type')).toBe('task'); });
});

describe('Jira dependency resolution', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('extracts blocking dependencies from issue links', async () => {
    const issue = mockIssue({
      key: 'TEST-2',
      issuelinks: [
        {
          type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: { key: 'TEST-1', fields: { summary: 'Blocker', status: { name: 'To Do' } } },
        },
      ],
    });

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues: [issue], total: 1 }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.dependsOn).toEqual(['TEST-1']);
  });

  it('returns undefined dependsOn when no blocking links', async () => {
    const issue = mockIssue({
      issuelinks: [
        {
          type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
          outwardIssue: { key: 'TEST-3', fields: { summary: 'Related', status: { name: 'To Do' } } },
        },
      ],
    });

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues: [issue], total: 1 }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });
    const tasks = await plugin.getTasks();
    expect(tasks[0]?.dependsOn).toBeUndefined();
  });
});

describe('Acceptance criteria extraction', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function getACFromDescription(adfContent: unknown[], options?: Record<string, unknown>): Promise<string[]> {
    const issue = mockIssue({
      description: { version: 1, type: 'doc', content: adfContent },
    });

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues: [issue], total: 1 }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
      ...options,
    });
    const tasks = await plugin.getTasks();
    return (tasks[0]?.metadata?.acceptanceCriteria as string[]) ?? [];
  }

  it('extracts AC from markdown heading in description', async () => {
    const ac = await getACFromDescription([
      { type: 'paragraph', content: [{ type: 'text', text: 'Some description text.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance Criteria' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First criterion' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second criterion' }] }] },
      ]},
    ]);
    expect(ac).toHaveLength(2);
    expect(ac[0]).toBe('First criterion');
    expect(ac[1]).toBe('Second criterion');
  });

  it('returns empty array when no AC section in description', async () => {
    const ac = await getACFromDescription([
      { type: 'paragraph', content: [{ type: 'text', text: 'Just a description, no AC.' }] },
    ]);
    expect(ac).toHaveLength(0);
  });

  it('extracts AC from subtasks when configured', async () => {
    const issue = mockIssue({
      subtasks: [
        { key: 'TEST-1-1', fields: { summary: 'Setup database', status: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } } } },
        { key: 'TEST-1-2', fields: { summary: 'Create API endpoint', status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } } } },
      ],
    });

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues: [issue], total: 1 }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
      acceptanceCriteriaSource: 'subtasks',
    });
    const tasks = await plugin.getTasks();
    const ac = tasks[0]?.metadata?.acceptanceCriteria as string[];
    expect(ac).toHaveLength(2);
    expect(ac[0]).toContain('Setup database');
    expect(ac[1]).toContain('Create API endpoint');
  });
});

describe('Task field mapping', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps all fields correctly', async () => {
    const issue = mockIssue({
      key: 'SNSP-55',
      summary: 'Create README',
      statusName: 'In Progress',
      statusCategory: 'indeterminate',
      priorityName: 'High',
      typeName: 'Story',
      labels: ['frontend', 'docs'],
      assignee: 'Jeremy Couser',
      parentKey: 'SNSP-54',
    });

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues: [issue], total: 1 }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'SNSP-54',
    });
    const tasks = await plugin.getTasks();
    const task = tasks[0]!;

    expect(task.id).toBe('SNSP-55');
    expect(task.title).toBe('Create README');
    expect(task.status).toBe('in_progress');
    expect(task.priority).toBe(1);
    expect(task.type).toBe('story');
    expect(task.labels).toEqual(['frontend', 'docs']);
    expect(task.assignee).toBe('Jeremy Couser');
    expect(task.parentId).toBe('SNSP-54');
    expect(task.createdAt).toBeTruthy();
    expect(task.metadata?.jiraKey).toBe('SNSP-55');
  });
});

describe('Jira transition selection', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses custom status mapping target names when updating status', async () => {
    let currentStatusName = 'To Do';
    let currentStatusCategory = 'new';
    const transitionRequests: Array<{ transition: { id: string } }> = [];

    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? 'GET';

      if (urlStr.includes('/transitions') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            transitions: [
              {
                id: '31',
                name: 'Close issue',
                to: { name: "Won't Do", statusCategory: { key: 'done', name: 'Done' } },
              },
              {
                id: '41',
                name: 'Complete issue',
                to: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
              },
            ],
          }),
        } as Response);
      }

      if (urlStr.includes('/transitions') && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { transition: { id: string } };
        transitionRequests.push(body);

        if (body.transition.id === '31') {
          currentStatusName = "Won't Do";
          currentStatusCategory = 'done';
        }

        return Promise.resolve({
          ok: true,
          status: 204,
        } as Response);
      }

      if (urlStr.includes('/rest/api/3/issue/SNSP-55')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockIssue({
            key: 'SNSP-55',
            statusName: currentStatusName,
            statusCategory: currentStatusCategory,
          })),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    }) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
      statusMapping: {
        'Done': 'completed',
        "Won't Do": 'cancelled',
      },
    });

    const task = await plugin.updateTaskStatus('SNSP-55', 'cancelled');

    expect(transitionRequests).toHaveLength(1);
    expect(transitionRequests[0]?.transition.id).toBe('31');
    expect(task?.status).toBe('cancelled');
  });

  it('uses mapped completed status when completing a task', async () => {
    let currentStatusName = 'In Progress';
    let currentStatusCategory = 'indeterminate';
    const transitionRequests: Array<{ transition: { id: string } }> = [];
    const comments: string[] = [];

    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? 'GET';

      if (urlStr.includes('/transitions') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            transitions: [
              {
                id: '31',
                name: 'Close issue',
                to: { name: "Won't Do", statusCategory: { key: 'done', name: 'Done' } },
              },
              {
                id: '41',
                name: 'Ship it',
                to: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
              },
            ],
          }),
        } as Response);
      }

      if (urlStr.includes('/transitions') && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { transition: { id: string } };
        transitionRequests.push(body);

        if (body.transition.id === '41') {
          currentStatusName = 'Done';
          currentStatusCategory = 'done';
        }

        return Promise.resolve({
          ok: true,
          status: 204,
        } as Response);
      }

      if (urlStr.includes('/comment') && method === 'POST') {
        comments.push(String(init?.body));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({}),
        } as Response);
      }

      if (urlStr.includes('/rest/api/3/issue/SNSP-55')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockIssue({
            key: 'SNSP-55',
            summary: 'Ship release',
            statusName: currentStatusName,
            statusCategory: currentStatusCategory,
          })),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    }) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
      statusMapping: {
        'Done': 'completed',
        "Won't Do": 'cancelled',
      },
    });

    const result = await plugin.completeTask('SNSP-55');

    expect(result.success).toBe(true);
    expect(transitionRequests).toHaveLength(1);
    expect(transitionRequests[0]?.transition.id).toBe('41');
    expect(result.task?.status).toBe('completed');
    expect(comments).toHaveLength(1);
  });
});

describe('getNextTask ordering', () => {
  let plugin: JiraTrackerPlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    plugin = new JiraTrackerPlugin();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('selects highest priority open task', async () => {
    const issues = [
      mockIssue({ key: 'T-1', priorityName: 'Low', statusCategory: 'new' }),
      mockIssue({ key: 'T-2', priorityName: 'High', statusCategory: 'new' }),
      mockIssue({ key: 'T-3', priorityName: 'Medium', statusCategory: 'new' }),
    ];

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues, total: issues.length }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });
    const next = await plugin.getNextTask();
    expect(next?.id).toBe('T-2');
  });

  it('prefers in_progress over open', async () => {
    const issues = [
      mockIssue({ key: 'T-1', priorityName: 'High', statusCategory: 'new' }),
      mockIssue({ key: 'T-2', priorityName: 'Low', statusCategory: 'indeterminate' }),
    ];

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues, total: issues.length }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });
    const next = await plugin.getNextTask();
    expect(next?.id).toBe('T-2');
  });

  it('returns undefined when all tasks are completed', async () => {
    const issues = [
      mockIssue({ key: 'T-1', statusCategory: 'done' }),
    ];

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ issues, total: issues.length }),
      } as Response),
    ) as unknown as typeof fetch;

    await plugin.initialize({
      baseUrl: 'https://test.atlassian.net',
      email: 'test@test.com',
      apiToken: 'token',
      epicId: 'EPIC-1',
    });
    const next = await plugin.getNextTask();
    expect(next).toBeUndefined();
  });
});
