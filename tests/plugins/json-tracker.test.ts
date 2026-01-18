/**
 * ABOUTME: Tests for the JsonTrackerPlugin.
 * Tests prd.json file operations, schema validation, and task management.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  JsonTrackerPlugin,
  validatePrdJsonSchema,
} from '../../src/plugins/trackers/builtin/json/index.js';
import { PrdJsonSchemaError } from '../../src/plugins/trackers/builtin/json/index.js';

describe('JsonTrackerPlugin', () => {
  let plugin: JsonTrackerPlugin;
  let testDir: string;
  let prdPath: string;

  const validPrdJson = {
    name: 'Test Project',
    description: 'A test project for unit tests',
    branchName: 'feature/test',
    userStories: [
      {
        id: 'US-001',
        title: 'First Story',
        description: 'As a user, I want to test',
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        priority: 1,
        passes: false,
        labels: ['test'],
      },
      {
        id: 'US-002',
        title: 'Second Story',
        description: 'Another test story',
        priority: 2,
        passes: true,
        dependsOn: ['US-001'],
      },
    ],
    metadata: {
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  };

  beforeEach(async () => {
    plugin = new JsonTrackerPlugin();
    testDir = join(tmpdir(), `ralph-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    prdPath = join(testDir, 'prd.json');
    await writeFile(prdPath, JSON.stringify(validPrdJson, null, 2));
  });

  afterEach(async () => {
    await plugin.dispose();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('json');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('JSON File Tracker');
    });

    test('supports hierarchy', () => {
      expect(plugin.meta.supportsHierarchy).toBe(true);
    });

    test('supports dependencies', () => {
      expect(plugin.meta.supportsDependencies).toBe(true);
    });

    test('does not support bidirectional sync', () => {
      expect(plugin.meta.supportsBidirectionalSync).toBe(false);
    });
  });

  describe('initialization', () => {
    test('initializes with valid path', async () => {
      await plugin.initialize({ path: prdPath });
      expect(await plugin.isReady()).toBe(true);
    });

    test('is not ready with invalid path', async () => {
      await plugin.initialize({ path: '/nonexistent/path/prd.json' });
      expect(await plugin.isReady()).toBe(false);
    });

    test('accepts branchName config', async () => {
      await plugin.initialize({ path: prdPath, branchName: 'custom-branch' });
      expect(plugin.getBranchName()).toBe('custom-branch');
    });

    test('uses branchName from prd.json when not configured', async () => {
      await plugin.initialize({ path: prdPath });
      // Trigger a read to populate cache
      await plugin.getTasks();
      expect(plugin.getBranchName()).toBe('feature/test');
    });
  });

  describe('getTasks', () => {
    test('returns all tasks from prd.json', async () => {
      await plugin.initialize({ path: prdPath });
      const tasks = await plugin.getTasks();

      expect(tasks.length).toBe(2);
      expect(tasks[0]?.id).toBe('US-001');
      expect(tasks[1]?.id).toBe('US-002');
    });

    test('maps story properties to task format', async () => {
      await plugin.initialize({ path: prdPath });
      const tasks = await plugin.getTasks();
      const task = tasks[0];

      expect(task?.title).toBe('First Story');
      expect(task?.description).toBe('As a user, I want to test');
      expect(task?.status).toBe('open'); // passes: false -> open
      expect(task?.priority).toBe(0); // priority 1 -> 0 (0-indexed)
      expect(task?.labels).toEqual(['test']);
      expect(task?.type).toBe('story');
    });

    test('maps completed status correctly', async () => {
      await plugin.initialize({ path: prdPath });
      const tasks = await plugin.getTasks();
      const completedTask = tasks.find((t) => t.id === 'US-002');

      expect(completedTask?.status).toBe('completed'); // passes: true -> completed
    });

    test('includes dependencies', async () => {
      await plugin.initialize({ path: prdPath });
      const tasks = await plugin.getTasks();
      const taskWithDeps = tasks.find((t) => t.id === 'US-002');

      expect(taskWithDeps?.dependsOn).toEqual(['US-001']);
    });

    test('includes acceptance criteria in metadata', async () => {
      await plugin.initialize({ path: prdPath });
      const tasks = await plugin.getTasks();
      const task = tasks[0];

      expect(task?.metadata?.acceptanceCriteria).toEqual([
        'Criterion 1',
        'Criterion 2',
      ]);
    });

    test('filters by status', async () => {
      await plugin.initialize({ path: prdPath });
      const openTasks = await plugin.getTasks({ status: 'open' });

      expect(openTasks.length).toBe(1);
      expect(openTasks[0]?.id).toBe('US-001');
    });

    test('returns empty array for non-existent file', async () => {
      await plugin.initialize({ path: '/nonexistent/prd.json' });
      const tasks = await plugin.getTasks();

      expect(tasks).toEqual([]);
    });
  });

  describe('getTask', () => {
    test('returns specific task by ID', async () => {
      await plugin.initialize({ path: prdPath });
      const task = await plugin.getTask('US-001');

      expect(task).toBeDefined();
      expect(task?.id).toBe('US-001');
      expect(task?.title).toBe('First Story');
    });

    test('returns undefined for non-existent task', async () => {
      await plugin.initialize({ path: prdPath });
      const task = await plugin.getTask('US-999');

      expect(task).toBeUndefined();
    });
  });

  describe('getNextTask', () => {
    test('returns highest priority open task', async () => {
      await plugin.initialize({ path: prdPath });
      const task = await plugin.getNextTask();

      expect(task).toBeDefined();
      expect(task?.id).toBe('US-001');
    });

    test('returns undefined when all tasks complete', async () => {
      const allCompletePrd = {
        name: 'Complete',
        userStories: [{ id: 'US-1', title: 'Done', passes: true }],
      };
      await writeFile(prdPath, JSON.stringify(allCompletePrd));
      await plugin.initialize({ path: prdPath });

      const task = await plugin.getNextTask();
      expect(task).toBeUndefined();
    });
  });

  describe('completeTask', () => {
    test('marks task as complete in file', async () => {
      await plugin.initialize({ path: prdPath });
      const result = await plugin.completeTask('US-001');

      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('completed');

      // Verify file was updated
      const content = await readFile(prdPath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.userStories[0].passes).toBe(true);
    });

    test('stores completion notes', async () => {
      await plugin.initialize({ path: prdPath });
      await plugin.completeTask('US-001', 'Completed successfully');

      const content = await readFile(prdPath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.userStories[0].completionNotes).toBe(
        'Completed successfully',
      );
    });

    test('returns failure for non-existent task', async () => {
      await plugin.initialize({ path: prdPath });
      const result = await plugin.completeTask('US-999');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('updates metadata timestamp', async () => {
      await plugin.initialize({ path: prdPath });
      await plugin.completeTask('US-001');

      const content = await readFile(prdPath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.metadata.updatedAt).toBeDefined();
    });
  });

  describe('updateTaskStatus', () => {
    test('updates task status', async () => {
      await plugin.initialize({ path: prdPath });
      const task = await plugin.updateTaskStatus('US-001', 'completed');

      expect(task).toBeDefined();
      expect(task?.status).toBe('completed');
    });

    test('returns undefined for non-existent task', async () => {
      await plugin.initialize({ path: prdPath });
      const task = await plugin.updateTaskStatus('US-999', 'completed');

      expect(task).toBeUndefined();
    });
  });

  describe('isComplete', () => {
    test('returns false when tasks remain', async () => {
      await plugin.initialize({ path: prdPath });
      const isComplete = await plugin.isComplete();

      expect(isComplete).toBe(false);
    });

    test('returns true when all tasks complete', async () => {
      const allCompletePrd = {
        name: 'Complete',
        userStories: [
          { id: 'US-1', title: 'Done', passes: true },
          { id: 'US-2', title: 'Also Done', passes: true },
        ],
      };
      await writeFile(prdPath, JSON.stringify(allCompletePrd));
      await plugin.initialize({ path: prdPath });

      const isComplete = await plugin.isComplete();
      expect(isComplete).toBe(true);
    });
  });

  describe('getEpics', () => {
    test('returns prd as a single epic', async () => {
      await plugin.initialize({ path: prdPath });
      const epics = await plugin.getEpics();

      expect(epics.length).toBe(1);
      expect(epics[0]?.type).toBe('epic');
      expect(epics[0]?.title).toBe('Test Project');
    });

    test('includes story count metadata', async () => {
      await plugin.initialize({ path: prdPath });
      const epics = await plugin.getEpics();

      expect(epics[0]?.metadata?.storyCount).toBe(2);
      expect(epics[0]?.metadata?.completedCount).toBe(1);
    });
  });

  describe('setFilePath', () => {
    test('changes active prd file', async () => {
      const newPrdPath = join(testDir, 'prd2.json');
      const newPrd = {
        name: 'New Project',
        userStories: [{ id: 'NEW-1', title: 'New Task', passes: false }],
      };
      await writeFile(newPrdPath, JSON.stringify(newPrd));

      await plugin.initialize({ path: prdPath });
      const success = await plugin.setFilePath(newPrdPath);

      expect(success).toBe(true);
      const tasks = await plugin.getTasks();
      expect(tasks[0]?.id).toBe('NEW-1');
    });

    test('returns false for invalid path', async () => {
      await plugin.initialize({ path: prdPath });
      const success = await plugin.setFilePath('/nonexistent/prd.json');

      expect(success).toBe(false);
    });
  });

  describe('epicId management', () => {
    test('setEpicId and getEpicId work', async () => {
      await plugin.initialize({ path: prdPath });
      plugin.setEpicId('prd:test');

      expect(plugin.getEpicId()).toBe('prd:test');
    });
  });

  describe('getSetupQuestions', () => {
    test('returns empty array (path via CLI, not config)', () => {
      const questions = plugin.getSetupQuestions();
      expect(questions).toEqual([]);
    });
  });

  describe('validateSetup', () => {
    test('accepts any configuration', async () => {
      const result = await plugin.validateSetup({});
      expect(result).toBeNull();
    });
  });
});

describe('validatePrdJsonSchema', () => {
  test('accepts valid prd.json', () => {
    const data = {
      name: 'Project',
      userStories: [{ id: 'US-1', title: 'Story', passes: false }],
    };

    const result = validatePrdJsonSchema(data, 'test.json');
    expect(result.name).toBe('Project');
    expect(result.userStories.length).toBe(1);
  });

  test('accepts project as alias for name', () => {
    const data = {
      project: 'My Project',
      userStories: [{ id: 'US-1', title: 'Story', passes: false }],
    };

    const result = validatePrdJsonSchema(data, 'test.json');
    expect(result.name).toBe('My Project');
  });

  test('throws for non-object data', () => {
    expect(() => validatePrdJsonSchema('string', 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for null data', () => {
    expect(() => validatePrdJsonSchema(null, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for hallucinated prd field', () => {
    const data = {
      prd: { name: 'Wrong Structure' },
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for hallucinated tasks field', () => {
    const data = {
      name: 'Project',
      tasks: [{ id: 'T-1' }],
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for missing name', () => {
    const data = {
      userStories: [{ id: 'US-1', title: 'Story', passes: false }],
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for missing userStories', () => {
    const data = {
      name: 'Project',
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for userStories not array', () => {
    const data = {
      name: 'Project',
      userStories: 'not array',
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for story missing id', () => {
    const data = {
      name: 'Project',
      userStories: [{ title: 'Story', passes: false }],
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for story missing title', () => {
    const data = {
      name: 'Project',
      userStories: [{ id: 'US-1', passes: false }],
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('throws for story missing passes', () => {
    const data = {
      name: 'Project',
      userStories: [{ id: 'US-1', title: 'Story' }],
    };

    expect(() => validatePrdJsonSchema(data, 'test.json')).toThrow(
      PrdJsonSchemaError,
    );
  });

  test('detects status field instead of passes', () => {
    const data = {
      name: 'Project',
      userStories: [{ id: 'US-1', title: 'Story', status: 'open' }],
    };

    try {
      validatePrdJsonSchema(data, 'test.json');
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(PrdJsonSchemaError);
      const schemaErr = err as PrdJsonSchemaError;
      expect(schemaErr.details.some((d) => d.includes('status'))).toBe(true);
    }
  });

  test('warns about unsupported fields like subtasks', () => {
    const data = {
      name: 'Project',
      userStories: [
        {
          id: 'US-1',
          title: 'Story',
          passes: false,
          subtasks: ['a', 'b'],
        },
      ],
    };

    try {
      validatePrdJsonSchema(data, 'test.json');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PrdJsonSchemaError);
      const schemaErr = err as PrdJsonSchemaError;
      expect(schemaErr.details.some((d) => d.includes('subtasks'))).toBe(true);
    }
  });
});
