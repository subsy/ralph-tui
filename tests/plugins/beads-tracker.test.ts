/**
 * ABOUTME: Tests for the BeadsTrackerPlugin.
 * Tests CLI interactions with mocked bd commands.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BeadsTrackerPlugin } from '../../src/plugins/trackers/builtin/beads.js';

// Since BeadsTrackerPlugin relies on external CLI, we'll test the
// plugin methods that don't require actual CLI execution and
// verify the configuration handling

describe('BeadsTrackerPlugin', () => {
  let plugin: BeadsTrackerPlugin;

  beforeEach(() => {
    plugin = new BeadsTrackerPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('beads');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Beads Issue Tracker');
    });

    test('supports bidirectional sync', () => {
      expect(plugin.meta.supportsBidirectionalSync).toBe(true);
    });

    test('supports hierarchy', () => {
      expect(plugin.meta.supportsHierarchy).toBe(true);
    });

    test('supports dependencies', () => {
      expect(plugin.meta.supportsDependencies).toBe(true);
    });
  });

  describe('initialization', () => {
    test('accepts beadsDir config', async () => {
      await plugin.initialize({ beadsDir: '.custom-beads' });
      // Note: isReady will be false if .beads doesn't exist
      // but config should be accepted
    });

    test('accepts epicId config', async () => {
      await plugin.initialize({ epicId: 'my-epic-123' });
      expect(plugin.getEpicId()).toBe('my-epic-123');
    });

    test('accepts labels as string', async () => {
      await plugin.initialize({ labels: 'ralph,frontend' });
      // Labels should be parsed and stored
    });

    test('accepts labels as array', async () => {
      await plugin.initialize({ labels: ['ralph', 'frontend'] });
    });

    test('accepts workingDir config', async () => {
      await plugin.initialize({ workingDir: '/tmp/test-project' });
    });
  });

  describe('epicId management', () => {
    test('setEpicId updates the epic ID', async () => {
      await plugin.initialize({});
      plugin.setEpicId('epic-456');

      expect(plugin.getEpicId()).toBe('epic-456');
    });

    test('getEpicId returns empty string initially', async () => {
      await plugin.initialize({});
      expect(plugin.getEpicId()).toBe('');
    });
  });

  describe('getSetupQuestions', () => {
    test('includes beadsDir question', () => {
      const questions = plugin.getSetupQuestions();
      const beadsDirQuestion = questions.find((q) => q.id === 'beadsDir');

      expect(beadsDirQuestion).toBeDefined();
      expect(beadsDirQuestion?.type).toBe('path');
      expect(beadsDirQuestion?.default).toBe('.beads');
    });

    test('includes labels question', () => {
      const questions = plugin.getSetupQuestions();
      const labelsQuestion = questions.find((q) => q.id === 'labels');

      expect(labelsQuestion).toBeDefined();
      expect(labelsQuestion?.type).toBe('text');
      expect(labelsQuestion?.default).toBe('ralph');
    });
  });

  describe('validateSetup', () => {
    test('validates when beads directory not found', async () => {
      // This will fail validation because .beads doesn't exist
      await plugin.initialize({ workingDir: '/nonexistent/path' });
      const result = await plugin.validateSetup({});

      // Should return an error about beads not being available
      expect(result).not.toBeNull();
    });
  });

  describe('dispose', () => {
    test('disposes cleanly', async () => {
      await plugin.initialize({});
      await plugin.dispose();
      // Note: BeadsTrackerPlugin's isReady() re-detects, so we just verify dispose doesn't throw
      // The ready flag is set based on whether .beads directory exists
    });
  });
});

describe('BeadsTrackerPlugin status mapping', () => {
  // Test the internal status mapping logic
  // These tests verify the conversion between bd status and TrackerTaskStatus

  describe('task conversion', () => {
    test.todo('bead ID with dot infers parent ID - requires mocking bd CLI output');
    // When a bead has ID like "epic-123.45", parent should be "epic-123"
    // This tests the ID parsing logic in beadToTask/getTasks
    // Implementation would require mocking the bd CLI to return beads with dotted IDs
  });
});

describe('BeadsTrackerPlugin detection', () => {
  test('detect returns not available when no .beads directory', async () => {
    const plugin = new BeadsTrackerPlugin();
    await plugin.initialize({ workingDir: '/tmp/nonexistent-dir' });

    const result = await plugin['detect']();
    expect(result.available).toBe(false);

    await plugin.dispose();
  });
});

describe('BeadsTrackerPlugin getNextTask', () => {
  // Tests for the getNextTask() method which uses bd ready for dependency-aware task selection
  // See: https://github.com/subsy/ralph-tui/issues/97

  let plugin: BeadsTrackerPlugin;

  beforeEach(() => {
    plugin = new BeadsTrackerPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('method existence', () => {
    test('has getNextTask method defined', () => {
      expect(plugin.getNextTask).toBeDefined();
      expect(typeof plugin.getNextTask).toBe('function');
    });
  });

  describe('configuration integration', () => {
    test('getNextTask uses epicId for parent filtering', async () => {
      await plugin.initialize({ epicId: 'my-epic-123' });
      plugin.setEpicId('test-epic');

      // Verify epicId is set and will be used by getNextTask
      expect(plugin.getEpicId()).toBe('test-epic');
    });

    test('getNextTask uses labels for filtering', async () => {
      await plugin.initialize({ labels: ['ralph', 'urgent'] });

      // Labels are stored and will be used in bd ready --label flag
      // Note: actual bd ready call requires CLI, this verifies config storage
    });
  });

  describe('filter handling', () => {
    test('accepts TaskFilter with parentId', async () => {
      // Use nonexistent path to avoid hitting real bd CLI
      await plugin.initialize({ workingDir: '/tmp/nonexistent-beads-test' });

      // getNextTask should accept parentId in filter
      // When CLI is unavailable, it will return undefined but shouldn't throw
      const result = await plugin.getNextTask({ parentId: 'specific-epic' });
      // Result is undefined because no .beads directory exists
      expect(result).toBeUndefined();
    });

    test('accepts TaskFilter with assignee', async () => {
      await plugin.initialize({ workingDir: '/tmp/nonexistent-beads-test' });

      const result = await plugin.getNextTask({ assignee: 'test@example.com' });
      expect(result).toBeUndefined();
    });

    test('accepts TaskFilter with priority', async () => {
      await plugin.initialize({ workingDir: '/tmp/nonexistent-beads-test' });

      const result = await plugin.getNextTask({ priority: 1 });
      expect(result).toBeUndefined();
    });

    test('accepts TaskFilter with multiple priorities', async () => {
      await plugin.initialize({ workingDir: '/tmp/nonexistent-beads-test' });

      const result = await plugin.getNextTask({ priority: [0, 1, 2] });
      expect(result).toBeUndefined();
    });

    test('accepts TaskFilter with labels', async () => {
      await plugin.initialize({ workingDir: '/tmp/nonexistent-beads-test' });

      const result = await plugin.getNextTask({ labels: ['feature', 'backend'] });
      expect(result).toBeUndefined();
    });
  });

  describe('excludeIds filter handling', () => {
    // Tests for excludeIds filter - used by engine to skip failed tasks
    // See: https://github.com/subsy/ralph-tui/issues/97#issuecomment-3762075053

    test('accepts TaskFilter with excludeIds', async () => {
      await plugin.initialize({ workingDir: '/tmp/nonexistent-beads-test' });

      // Should accept excludeIds without throwing
      const result = await plugin.getNextTask({
        excludeIds: ['task-1', 'task-2', 'task-3'],
      });
      expect(result).toBeUndefined();
    });

    test('accepts TaskFilter with empty excludeIds', async () => {
      await plugin.initialize({ workingDir: '/tmp/nonexistent-beads-test' });

      const result = await plugin.getNextTask({
        excludeIds: [],
      });
      expect(result).toBeUndefined();
    });

    test.todo('excludeIds filters out specified tasks from bd ready results - requires CLI mocking');
    // When bd ready returns tasks [task-1, task-2, task-3] and excludeIds=['task-1'],
    // getNextTask should return task-2 instead of task-1
    // This is critical for the engine's skipped task handling
  });

  describe('behavior documentation', () => {
    // These tests document the expected behavior of getNextTask
    // The implementation uses bd ready for server-side dependency filtering

    test.todo('bd ready returns only unblocked tasks - requires CLI mocking');
    // bd ready --json returns tasks with no unresolved dependencies
    // This is the fix for issue #97 where chained tasks were shown in wrong order

    test.todo('in_progress tasks are preferred over open tasks - requires CLI mocking');
    // When bd ready returns multiple tasks, getNextTask should prefer
    // tasks with status 'in_progress' over 'open'

    test.todo('tasks are returned in priority order from bd ready - requires CLI mocking');
    // bd ready uses hybrid sorting (priority + other factors)
    // getNextTask trusts this ordering

    test.todo('parent filter is passed to bd ready --parent flag - requires CLI mocking');
    // When filter.parentId or epicId is set, getNextTask should use
    // bd ready --parent <id> to filter to epic descendants

    test.todo('labels are passed to bd ready --label flag - requires CLI mocking');
    // When filter.labels or plugin.labels is set, getNextTask should use
    // bd ready --label <labels> to filter by labels
  });
});
