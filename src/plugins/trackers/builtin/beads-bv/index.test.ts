/**
 * ABOUTME: Tests for BeadsBvTrackerPlugin focusing on unit-testable behavior.
 * Complex integration scenarios with spawn mocking are difficult due to ES module
 * caching, so we focus on synchronous behavior and exported utilities.
 *
 * IMPORTANT: The mock is set up in beforeAll (not at module level) to prevent
 * polluting other test files. The module under test is dynamically imported
 * after the mock is applied.
 */

import { describe, test, expect, mock, beforeAll, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';

// Declare the types for the imports
let BeadsBvTrackerPlugin: typeof import('./index.js').BeadsBvTrackerPlugin;
type TaskReasoning = import('./index.js').TaskReasoning;

describe('BeadsBvTrackerPlugin', () => {
  beforeAll(async () => {
    // Minimal mocks to allow module to load
    mock.module('node:child_process', () => ({
      spawn: () => {
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => {
          proc.emit('close', 0);
        }, 0);
        return proc;
      },
    }));

    mock.module('node:fs', () => ({
      access: (
        _path: string,
        _mode: number,
        callback: (err: Error | null) => void
      ) => {
        callback(null);
      },
      constants: { R_OK: 4, W_OK: 2, X_OK: 1, F_OK: 0 },
      readFileSync: (path: string) => {
        if (path.endsWith('template.hbs')) {
          return 'bd close {{taskId}}\nbd sync\n';
        }
        return '';
      },
    }));

    mock.module('node:fs/promises', () => ({
      access: async () => {},
      readFile: async () => '',
    }));

    const module = await import('./index.js');
    BeadsBvTrackerPlugin = module.BeadsBvTrackerPlugin;
  });

  afterAll(() => {
    mock.restore();
  });

  describe('meta', () => {
    test('has correct plugin metadata', () => {
      const plugin = new BeadsBvTrackerPlugin();

      expect(plugin.meta.id).toBe('beads-bv');
      expect(plugin.meta.name).toContain('Beads');
      expect(plugin.meta.name).toContain('Smart');
      expect(plugin.meta.description).toContain('bv');
      expect(plugin.meta.supportsDependencies).toBe(true);
      expect(plugin.meta.supportsHierarchy).toBe(true);
      expect(plugin.meta.supportsBidirectionalSync).toBe(true);
    });

    test('meta version is semver format', () => {
      const plugin = new BeadsBvTrackerPlugin();
      expect(plugin.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('getTemplate', () => {
    test('returns template content with bd commands', () => {
      const plugin = new BeadsBvTrackerPlugin();
      const template = plugin.getTemplate();

      expect(template).toContain('bd close');
      expect(template).toContain('bd sync');
    });

    test('template does not contain br commands (uses bd, not br)', () => {
      const plugin = new BeadsBvTrackerPlugin();
      const template = plugin.getTemplate();

      // beads-bv uses bd (Go version), not br (Rust version)
      expect(template).not.toContain('br close');
      expect(template).not.toContain('br sync');
    });
  });

  describe('reasoning methods before triage', () => {
    test('getTaskReasoning returns undefined before any triage', () => {
      const plugin = new BeadsBvTrackerPlugin();
      expect(plugin.getTaskReasoning('any-task-id')).toBeUndefined();
    });

    test('getAllTaskReasoning returns empty map before any triage', () => {
      const plugin = new BeadsBvTrackerPlugin();
      const allReasoning = plugin.getAllTaskReasoning();
      expect(allReasoning.size).toBe(0);
      expect(allReasoning instanceof Map).toBe(true);
    });

    test('getTriageStats returns undefined before any triage', () => {
      const plugin = new BeadsBvTrackerPlugin();
      expect(plugin.getTriageStats()).toBeUndefined();
    });
  });

  describe('initial state', () => {
    test('isBvAvailable returns false before initialization', () => {
      const plugin = new BeadsBvTrackerPlugin();
      // Before initialize(), bvAvailable should be false (default)
      expect(plugin.isBvAvailable()).toBe(false);
    });
  });

  describe('TaskReasoning interface', () => {
    test('TaskReasoning type is exported correctly', () => {
      // This tests that the interface is accessible
      const reasoning: TaskReasoning = {
        taskId: 't1',
        score: 0.8,
        reasons: ['High PageRank'],
        unblocks: 3,
      };

      expect(reasoning.taskId).toBe('t1');
      expect(reasoning.score).toBe(0.8);
      expect(reasoning.reasons).toContain('High PageRank');
      expect(reasoning.unblocks).toBe(3);
    });

    test('TaskReasoning breakdown is optional', () => {
      const withoutBreakdown: TaskReasoning = {
        taskId: 't1',
        score: 0.5,
        reasons: [],
        unblocks: 0,
      };

      const withBreakdown: TaskReasoning = {
        taskId: 't2',
        score: 0.9,
        reasons: ['Critical path'],
        unblocks: 5,
        breakdown: {
          pagerank: 0.7,
          betweenness: 0.4,
        },
      };

      expect(withoutBreakdown.breakdown).toBeUndefined();
      expect(withBreakdown.breakdown?.pagerank).toBe(0.7);
    });
  });
});
