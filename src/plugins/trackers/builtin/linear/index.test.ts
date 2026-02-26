/**
 * ABOUTME: Unit tests for the Linear tracker plugin.
 * Covers status mapping, dependency mapping, next-task ordering by ralphPriority,
 * completion comment behavior, parent ID resolution, and client error handling.
 */

import { describe, expect, test, beforeAll, beforeEach, mock } from 'bun:test';

// --- Mock the Linear client module before any imports that use it ---

/** Accumulated mock method calls for verification */
let mockCalls: {
  updateIssueState: Array<{ issueId: string; stateId: string }>;
  addComment: Array<{ issueId: string; body: string }>;
  getIssue: Array<{ idOrKey: string }>;
  getChildIssues: Array<{ parentId: string }>;
  getWorkflowStates: Array<{ teamId: string }>;
  getBlockingIssueIds: Array<{ issueId: string }>;
};

/** Configurable mock responses */
let mockResponses: {
  getIssue: (idOrKey: string) => unknown;
  getChildIssues: (parentId: string) => unknown[];
  getWorkflowStates: (teamId: string) => unknown[];
  getBlockingIssueIds: (issueId: string) => string[];
};

function resetMockCalls(): void {
  mockCalls = {
    updateIssueState: [],
    addComment: [],
    getIssue: [],
    getChildIssues: [],
    getWorkflowStates: [],
    getBlockingIssueIds: [],
  };
}

/** Helper to create a mock Linear Issue object */
function createMockIssue(opts: {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  stateType?: string;
  teamId?: string;
  parentIdentifier?: string;
  labels?: string[];
  url?: string;
  assigneeName?: string;
}) {
  return {
    id: opts.id,
    identifier: opts.identifier,
    title: opts.title,
    description: opts.description ?? '',
    url: opts.url ?? `https://linear.app/team/issue/${opts.identifier}`,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
    state: Promise.resolve({
      type: opts.stateType ?? 'unstarted',
      name: opts.stateType ?? 'Todo',
    }),
    team: Promise.resolve({
      id: opts.teamId ?? 'team-uuid-1',
      key: 'ENG',
      name: 'Engineering',
    }),
    parent: Promise.resolve(
      opts.parentIdentifier
        ? { identifier: opts.parentIdentifier }
        : null,
    ),
    assignee: Promise.resolve(
      opts.assigneeName
        ? { displayName: opts.assigneeName, name: opts.assigneeName }
        : null,
    ),
    labels: () =>
      Promise.resolve({
        nodes: (opts.labels ?? []).map((name) => ({ name })),
      }),
    children: () =>
      Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
    relations: () => Promise.resolve({ nodes: [] }),
    update: () => Promise.resolve({}),
  };
}

/** Default workflow states for mock */
const defaultWorkflowStates = [
  { id: 'state-triage', name: 'Triage', type: 'triage' },
  { id: 'state-backlog', name: 'Backlog', type: 'backlog' },
  { id: 'state-unstarted', name: 'Todo', type: 'unstarted' },
  { id: 'state-started', name: 'In Progress', type: 'started' },
  { id: 'state-completed', name: 'Done', type: 'completed' },
  { id: 'state-canceled', name: 'Canceled', type: 'canceled' },
];

beforeAll(() => {
  resetMockCalls();

  // Set default mock responses
  mockResponses = {
    getIssue: () => createMockIssue({ id: 'uuid-1', identifier: 'ENG-1', title: 'Default' }),
    getChildIssues: () => [],
    getWorkflowStates: () => defaultWorkflowStates,
    getBlockingIssueIds: () => [],
  };

  mock.module('./client.js', () => {
    return {
      createLinearClient: () => ({
        getIssue: async (idOrKey: string) => {
          mockCalls.getIssue.push({ idOrKey });
          return mockResponses.getIssue(idOrKey);
        },
        getChildIssues: async (parentId: string) => {
          mockCalls.getChildIssues.push({ parentId });
          return mockResponses.getChildIssues(parentId);
        },
        getWorkflowStates: async (teamId: string) => {
          mockCalls.getWorkflowStates.push({ teamId });
          return mockResponses.getWorkflowStates(teamId);
        },
        findWorkflowState: async (teamId: string, stateType: string) => {
          const states = mockResponses.getWorkflowStates(teamId);
          return (states as Array<{ type: string }>).find((s) => s.type === stateType);
        },
        getBlockingIssueIds: async (issueId: string) => {
          mockCalls.getBlockingIssueIds.push({ issueId });
          return mockResponses.getBlockingIssueIds(issueId);
        },
        updateIssueState: async (issueId: string, stateId: string) => {
          mockCalls.updateIssueState.push({ issueId, stateId });
        },
        addComment: async (issueId: string, body: string) => {
          mockCalls.addComment.push({ issueId, body });
        },
      }),
      LinearApiError: class LinearApiError extends Error {
        kind: string;
        constructor(message: string, kind: string) {
          super(message);
          this.name = 'LinearApiError';
          this.kind = kind;
        }
      },
    };
  });
});

// Import after mock setup
import { LinearTrackerPlugin } from './index.js';
import { buildStoryIssueBody } from './body.js';
import type { TrackerTaskStatus } from '../../types.js';

/**
 * Create and initialize a LinearTrackerPlugin with the default mock.
 */
async function createInitializedPlugin(epicId = 'ENG-1'): Promise<LinearTrackerPlugin> {
  const plugin = new LinearTrackerPlugin();
  await plugin.initialize({ epicId, apiKey: 'test-key' });
  return plugin;
}

describe('LinearTrackerPlugin', () => {
  beforeEach(() => {
    resetMockCalls();

    // Reset to default responses
    mockResponses.getIssue = (idOrKey: string) =>
      createMockIssue({ id: 'uuid-epic', identifier: idOrKey, title: 'Epic Issue' });
    mockResponses.getChildIssues = () => [];
    mockResponses.getWorkflowStates = () => defaultWorkflowStates;
    mockResponses.getBlockingIssueIds = () => [];
  });

  describe('initialization', () => {
    test('initializes with epicId', async () => {
      const plugin = await createInitializedPlugin('ENG-42');
      expect(plugin.getEpicId()).toBe('ENG-42');
      const ready = await plugin.isReady();
      expect(ready).toBe(true);
    });

    test('resolves team from epic issue', async () => {
      await createInitializedPlugin('ENG-1');
      expect(mockCalls.getIssue.length).toBeGreaterThanOrEqual(1);
      expect(mockCalls.getIssue[0].idOrKey).toBe('ENG-1');
    });

    test('meta has correct id and capabilities', async () => {
      const plugin = new LinearTrackerPlugin();
      expect(plugin.meta.id).toBe('linear');
      expect(plugin.meta.supportsHierarchy).toBe(true);
      expect(plugin.meta.supportsDependencies).toBe(true);
      expect(plugin.meta.supportsBidirectionalSync).toBe(false);
    });
  });

  describe('epicId management', () => {
    test('setEpicId updates the epic', async () => {
      const plugin = await createInitializedPlugin('ENG-1');
      plugin.setEpicId('ENG-99');
      expect(plugin.getEpicId()).toBe('ENG-99');
    });

    test('getTasks returns empty when no epicId', async () => {
      const plugin = new LinearTrackerPlugin();
      await plugin.initialize({ apiKey: 'test-key' });
      const tasks = await plugin.getTasks();
      expect(tasks).toEqual([]);
    });
  });

  describe('status mapping', () => {
    test('maps Linear "started" to "in_progress"', async () => {
      const childIssue = createMockIssue({
        id: 'uuid-child',
        identifier: 'ENG-10',
        title: 'Task 1',
        stateType: 'started',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [childIssue];
      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks.length).toBe(1);
      expect(tasks[0].status).toBe('in_progress');
    });

    test('maps Linear "completed" to "completed"', async () => {
      const childIssue = createMockIssue({
        id: 'uuid-child',
        identifier: 'ENG-10',
        title: 'Done Task',
        stateType: 'completed',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [childIssue];
      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].status).toBe('completed');
    });

    test('maps Linear "canceled" to "cancelled"', async () => {
      const childIssue = createMockIssue({
        id: 'uuid-child',
        identifier: 'ENG-10',
        title: 'Canceled Task',
        stateType: 'canceled',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [childIssue];
      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].status).toBe('cancelled');
    });

    test('maps Linear "unstarted" to "open"', async () => {
      const childIssue = createMockIssue({
        id: 'uuid-child',
        identifier: 'ENG-10',
        title: 'New Task',
        stateType: 'unstarted',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [childIssue];
      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].status).toBe('open');
    });

    test('maps Linear "backlog" to "open"', async () => {
      const childIssue = createMockIssue({
        id: 'uuid-child',
        identifier: 'ENG-10',
        title: 'Backlog Task',
        stateType: 'backlog',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [childIssue];
      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].status).toBe('open');
    });

    test('maps Linear "triage" to "open"', async () => {
      const childIssue = createMockIssue({
        id: 'uuid-child',
        identifier: 'ENG-10',
        title: 'Triage Task',
        stateType: 'triage',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [childIssue];
      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].status).toBe('open');
    });
  });

  describe('updateTaskStatus - reverse mapping', () => {
    test('maps "in_progress" to "started" workflow state', async () => {
      const plugin = await createInitializedPlugin();
      await plugin.updateTaskStatus('ENG-10', 'in_progress' as TrackerTaskStatus);

      expect(mockCalls.updateIssueState.length).toBe(1);
      expect(mockCalls.updateIssueState[0].stateId).toBe('state-started');
    });

    test('maps "completed" to "completed" workflow state', async () => {
      const plugin = await createInitializedPlugin();
      await plugin.updateTaskStatus('ENG-10', 'completed' as TrackerTaskStatus);

      expect(mockCalls.updateIssueState.length).toBe(1);
      expect(mockCalls.updateIssueState[0].stateId).toBe('state-completed');
    });

    test('maps "cancelled" to "canceled" workflow state', async () => {
      const plugin = await createInitializedPlugin();
      await plugin.updateTaskStatus('ENG-10', 'cancelled' as TrackerTaskStatus);

      expect(mockCalls.updateIssueState.length).toBe(1);
      expect(mockCalls.updateIssueState[0].stateId).toBe('state-canceled');
    });

    test('maps "open" to "unstarted" workflow state', async () => {
      const plugin = await createInitializedPlugin();
      await plugin.updateTaskStatus('ENG-10', 'open' as TrackerTaskStatus);

      expect(mockCalls.updateIssueState.length).toBe(1);
      expect(mockCalls.updateIssueState[0].stateId).toBe('state-unstarted');
    });

    test('maps "blocked" to "unstarted" workflow state', async () => {
      const plugin = await createInitializedPlugin();
      await plugin.updateTaskStatus('ENG-10', 'blocked' as TrackerTaskStatus);

      expect(mockCalls.updateIssueState.length).toBe(1);
      expect(mockCalls.updateIssueState[0].stateId).toBe('state-unstarted');
    });
  });

  describe('dependency mapping', () => {
    test('maps blocking relation UUIDs to identifiers', async () => {
      const child1 = createMockIssue({
        id: 'uuid-1',
        identifier: 'ENG-10',
        title: 'First',
        parentIdentifier: 'ENG-1',
      });
      const child2 = createMockIssue({
        id: 'uuid-2',
        identifier: 'ENG-11',
        title: 'Second (depends on First)',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [child1, child2];
      mockResponses.getBlockingIssueIds = (issueId: string) => {
        if (issueId === 'uuid-2') return ['uuid-1'];
        return [];
      };

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      const secondTask = tasks.find((t) => t.id === 'ENG-11');
      expect(secondTask).toBeDefined();
      expect(secondTask!.dependsOn).toEqual(['ENG-10']);
    });

    test('tasks without dependencies have undefined dependsOn', async () => {
      const child = createMockIssue({
        id: 'uuid-1',
        identifier: 'ENG-10',
        title: 'No deps',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [child];
      mockResponses.getBlockingIssueIds = () => [];

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].dependsOn).toBeUndefined();
    });

    test('ignores blocking UUIDs not in the child issue set', async () => {
      const child = createMockIssue({
        id: 'uuid-1',
        identifier: 'ENG-10',
        title: 'Has external dep',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [child];
      // Returns a UUID that is not in the child set
      mockResponses.getBlockingIssueIds = () => ['uuid-external-not-in-children'];

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].dependsOn).toBeUndefined();
    });
  });

  describe('next-task ordering by ralphPriority', () => {
    test('returns task with lowest ralphPriority first', async () => {
      const body1 = buildStoryIssueBody({
        storyId: 'US-001', ralphPriority: 5,
        description: 'Low priority', acceptanceCriteria: [],
      });
      const body2 = buildStoryIssueBody({
        storyId: 'US-002', ralphPriority: 1,
        description: 'High priority', acceptanceCriteria: [],
      });
      const body3 = buildStoryIssueBody({
        storyId: 'US-003', ralphPriority: 3,
        description: 'Medium priority', acceptanceCriteria: [],
      });

      const children = [
        createMockIssue({ id: 'uuid-1', identifier: 'ENG-10', title: 'US-001: Low', description: body1, parentIdentifier: 'ENG-1' }),
        createMockIssue({ id: 'uuid-2', identifier: 'ENG-11', title: 'US-002: High', description: body2, parentIdentifier: 'ENG-1' }),
        createMockIssue({ id: 'uuid-3', identifier: 'ENG-12', title: 'US-003: Medium', description: body3, parentIdentifier: 'ENG-1' }),
      ];

      mockResponses.getChildIssues = () => children;

      const plugin = await createInitializedPlugin();
      const nextTask = await plugin.getNextTask();

      expect(nextTask).toBeDefined();
      expect(nextTask!.id).toBe('ENG-11'); // Priority 1 comes first
    });

    test('prefers in_progress task over higher-priority open task', async () => {
      const body1 = buildStoryIssueBody({
        storyId: 'US-001', ralphPriority: 1,
        description: 'Highest priority but open', acceptanceCriteria: [],
      });
      const body2 = buildStoryIssueBody({
        storyId: 'US-002', ralphPriority: 5,
        description: 'Lower priority but in progress', acceptanceCriteria: [],
      });

      const children = [
        createMockIssue({
          id: 'uuid-1', identifier: 'ENG-10', title: 'US-001: Open',
          description: body1, stateType: 'unstarted', parentIdentifier: 'ENG-1',
        }),
        createMockIssue({
          id: 'uuid-2', identifier: 'ENG-11', title: 'US-002: In Progress',
          description: body2, stateType: 'started', parentIdentifier: 'ENG-1',
        }),
      ];

      mockResponses.getChildIssues = () => children;

      const plugin = await createInitializedPlugin();
      const nextTask = await plugin.getNextTask();

      expect(nextTask).toBeDefined();
      expect(nextTask!.id).toBe('ENG-11'); // In-progress preferred
      expect(nextTask!.status).toBe('in_progress');
    });

    test('returns undefined when all tasks are completed', async () => {
      const body = buildStoryIssueBody({
        storyId: 'US-001', ralphPriority: 1,
        description: 'Done', acceptanceCriteria: [],
      });

      const children = [
        createMockIssue({
          id: 'uuid-1', identifier: 'ENG-10', title: 'US-001: Done',
          description: body, stateType: 'completed', parentIdentifier: 'ENG-1',
        }),
      ];

      mockResponses.getChildIssues = () => children;

      const plugin = await createInitializedPlugin();
      const nextTask = await plugin.getNextTask();

      expect(nextTask).toBeUndefined();
    });

    test('uses DEFAULT_RALPH_PRIORITY for issues without metadata', async () => {
      const children = [
        createMockIssue({
          id: 'uuid-1', identifier: 'ENG-10', title: 'No metadata',
          description: 'Just plain text', parentIdentifier: 'ENG-1',
        }),
      ];

      mockResponses.getChildIssues = () => children;

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      // DEFAULT_RALPH_PRIORITY is 3
      expect(tasks[0].metadata?.ralphPriority).toBe(3);
      // Coarse priority: Math.min(4, Math.max(0, 3 - 1)) = 2
      expect(tasks[0].priority).toBe(2);
    });
  });

  describe('priority clamping', () => {
    test('clamps ralphPriority=1 to coarse priority 0', async () => {
      const body = buildStoryIssueBody({
        storyId: 'US-001', ralphPriority: 1,
        description: 'Urgent', acceptanceCriteria: [],
      });

      const children = [
        createMockIssue({ id: 'uuid-1', identifier: 'ENG-10', title: 'Test', description: body, parentIdentifier: 'ENG-1' }),
      ];
      mockResponses.getChildIssues = () => children;

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].priority).toBe(0);
    });

    test('clamps ralphPriority=5 to coarse priority 4', async () => {
      const body = buildStoryIssueBody({
        storyId: 'US-001', ralphPriority: 5,
        description: 'Low', acceptanceCriteria: [],
      });

      const children = [
        createMockIssue({ id: 'uuid-1', identifier: 'ENG-10', title: 'Test', description: body, parentIdentifier: 'ENG-1' }),
      ];
      mockResponses.getChildIssues = () => children;

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].priority).toBe(4);
    });

    test('clamps high ralphPriority (e.g., 99) to coarse priority 4', async () => {
      const body = buildStoryIssueBody({
        storyId: 'US-001', ralphPriority: 99,
        description: 'Very low', acceptanceCriteria: [],
      });

      const children = [
        createMockIssue({ id: 'uuid-1', identifier: 'ENG-10', title: 'Test', description: body, parentIdentifier: 'ENG-1' }),
      ];
      mockResponses.getChildIssues = () => children;

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].priority).toBe(4);
      expect(tasks[0].metadata?.ralphPriority).toBe(99);
    });
  });

  describe('completeTask', () => {
    test('moves issue to completed state and posts comment', async () => {
      const plugin = await createInitializedPlugin();
      const result = await plugin.completeTask('ENG-10');

      expect(result.success).toBe(true);

      // Verify state was updated to completed
      expect(mockCalls.updateIssueState.length).toBe(1);
      expect(mockCalls.updateIssueState[0].stateId).toBe('state-completed');

      // Verify comment was posted
      expect(mockCalls.addComment.length).toBe(1);
      expect(mockCalls.addComment[0].body).toBe('Completed by Ralph');
    });

    test('includes reason in completion comment when provided', async () => {
      const plugin = await createInitializedPlugin();
      const result = await plugin.completeTask('ENG-10', 'All tests passing');

      expect(result.success).toBe(true);
      expect(mockCalls.addComment.length).toBe(1);
      expect(mockCalls.addComment[0].body).toBe('Completed by Ralph: All tests passing');
    });

    test('returns failure when issue has no team', async () => {
      mockResponses.getIssue = () => ({
        ...createMockIssue({ id: 'uuid-1', identifier: 'ENG-10', title: 'Test' }),
        team: Promise.resolve(null),
      });

      const plugin = await createInitializedPlugin();
      const result = await plugin.completeTask('ENG-10');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No team');
    });

    test('returns failure when no completed workflow state exists', async () => {
      mockResponses.getWorkflowStates = () => [
        { id: 'state-unstarted', name: 'Todo', type: 'unstarted' },
        { id: 'state-started', name: 'In Progress', type: 'started' },
        // No completed state
      ];

      const plugin = await createInitializedPlugin();
      const result = await plugin.completeTask('ENG-10');

      expect(result.success).toBe(false);
      expect(result.error).toContain('completed workflow state');
    });
  });

  describe('parent ID resolution (issue key and UUID)', () => {
    test('resolves issue by identifier (issue key)', async () => {
      const plugin = await createInitializedPlugin();
      const task = await plugin.getTask('ENG-42');

      expect(task).toBeDefined();
      expect(mockCalls.getIssue.some((c) => c.idOrKey === 'ENG-42')).toBe(true);
    });

    test('resolves issue by UUID', async () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      mockResponses.getIssue = () =>
        createMockIssue({ id: uuid, identifier: 'ENG-42', title: 'UUID Issue' });

      const plugin = await createInitializedPlugin();
      const task = await plugin.getTask(uuid);

      expect(task).toBeDefined();
      expect(mockCalls.getIssue.some((c) => c.idOrKey === uuid)).toBe(true);
    });

    test('returns undefined for not-found issue', async () => {
      const { LinearApiError: MockLinearApiError } = await import('./client.js');
      mockResponses.getIssue = (idOrKey: string) => {
        // First call is for epic during initialization, allow it
        if (idOrKey === 'ENG-1') {
          return createMockIssue({ id: 'uuid-epic', identifier: 'ENG-1', title: 'Epic' });
        }
        throw new MockLinearApiError('Not found', 'not_found');
      };

      const plugin = await createInitializedPlugin();
      const task = await plugin.getTask('ENG-999');

      expect(task).toBeUndefined();
    });
  });

  describe('sync', () => {
    test('returns success (no-op for API-backed tracker)', async () => {
      const plugin = await createInitializedPlugin();
      const result = await plugin.sync();

      expect(result.success).toBe(true);
      expect(result.message).toContain('no sync required');
    });
  });

  describe('getEpics', () => {
    test('returns empty array when no epicId set', async () => {
      const plugin = new LinearTrackerPlugin();
      await plugin.initialize({ apiKey: 'test-key' });
      const epics = await plugin.getEpics();
      expect(epics).toEqual([]);
    });

    test('returns epic with progress metadata', async () => {
      const doneChild = createMockIssue({
        id: 'uuid-done', identifier: 'ENG-10', title: 'Done task',
        stateType: 'completed', parentIdentifier: 'ENG-1',
      });
      const openChild = createMockIssue({
        id: 'uuid-open', identifier: 'ENG-11', title: 'Open task',
        stateType: 'unstarted', parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [doneChild, openChild];

      const plugin = await createInitializedPlugin();
      const epics = await plugin.getEpics();

      expect(epics.length).toBe(1);
      expect(epics[0].type).toBe('epic');
      expect(epics[0].metadata?.totalCount).toBe(2);
      expect(epics[0].metadata?.completedCount).toBe(1);
    });
  });

  describe('task metadata', () => {
    test('includes linearIdentifier and linearUrl in metadata', async () => {
      const child = createMockIssue({
        id: 'uuid-1', identifier: 'ENG-10', title: 'Task',
        url: 'https://linear.app/eng/ENG-10', parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [child];

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].metadata?.linearIdentifier).toBe('ENG-10');
      expect(tasks[0].metadata?.linearUrl).toBe('https://linear.app/eng/ENG-10');
    });

    test('includes storyId from body metadata', async () => {
      const body = buildStoryIssueBody({
        storyId: 'US-007', ralphPriority: 2,
        description: 'A story', acceptanceCriteria: ['AC1'],
      });

      const child = createMockIssue({
        id: 'uuid-1', identifier: 'ENG-10', title: 'US-007: Story',
        description: body, parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [child];

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].metadata?.storyId).toBe('US-007');
      expect(tasks[0].metadata?.acceptanceCriteria).toEqual(['AC1']);
    });

    test('uses identifier as task ID (not UUID)', async () => {
      const child = createMockIssue({
        id: 'uuid-1', identifier: 'ENG-10', title: 'Task',
        parentIdentifier: 'ENG-1',
      });

      mockResponses.getChildIssues = () => [child];

      const plugin = await createInitializedPlugin();
      const tasks = await plugin.getTasks();

      expect(tasks[0].id).toBe('ENG-10');
    });
  });
});
