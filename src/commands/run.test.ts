/**
 * ABOUTME: Tests for the run command utilities.
 * Covers task range filtering, conflict resolution helpers, and related utilities.
 */

import { describe, test, expect } from 'bun:test';
import {
  filterTasksByRange,
  parseRunArgs,
  printRunHelp,
  clearConflictState,
  findResolutionByPath,
  areAllConflictsResolved,
  applyParallelFailureState,
  type TaskRangeFilter,
  type ParallelConflictState,
} from './run.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { FileConflict, ConflictResolutionResult } from '../parallel/types.js';
import type { PersistedSessionState } from '../session/persistence.js';

/**
 * Helper to create mock tasks for testing.
 */
function createTasks(count: number): TrackerTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    title: `Task ${i + 1}`,
    status: 'open' as const,
    priority: 2 as const,
  }));
}

describe('filterTasksByRange', () => {
  describe('basic filtering', () => {
    test('filters tasks within explicit range (1-3)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 1, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(3);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-1', 'task-2', 'task-3']);
      expect(result.message).toContain('1-3');
      expect(result.message).toContain('3 of 5');
    });

    test('filters tasks with only start specified (3-)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(3);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-3', 'task-4', 'task-5']);
      expect(result.message).toContain('3-');
    });

    test('filters tasks with only end specified (-2)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(2);
      expect(result.filteredTasks.map((t) => t.id)).toEqual(['task-1', 'task-2']);
      expect(result.message).toContain('-2');
    });

    test('returns all tasks when range is undefined/empty', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = {};

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toContain('all');
    });

    test('filters single task when start equals end', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(1);
      expect(result.filteredTasks[0].id).toBe('task-3');
      expect(result.message).toContain('3-3');
    });
  });

  describe('edge cases', () => {
    test('handles empty task list', () => {
      const tasks: TrackerTask[] = [];
      const range: TaskRangeFilter = { start: 1, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(0);
      expect(result.message).toContain('0 of 0');
    });

    test('returns original tasks for invalid range (start < 1)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 0, end: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toBe('Invalid task range, using all tasks');
    });

    test('returns original tasks for invalid range (end < start)', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 4, end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.filteredTasks).toHaveLength(5);
      expect(result.message).toBe('Invalid task range, using all tasks');
    });

    test('handles range exceeding task count gracefully', () => {
      const tasks = createTasks(3);
      const range: TaskRangeFilter = { start: 1, end: 10 };

      const result = filterTasksByRange(tasks, range);

      // Should return all 3 tasks (doesn't fail on out-of-bounds)
      expect(result.filteredTasks).toHaveLength(3);
      expect(result.message).toContain('3 of 3');
    });

    test('handles start exceeding task count', () => {
      const tasks = createTasks(3);
      const range: TaskRangeFilter = { start: 10 };

      const result = filterTasksByRange(tasks, range);

      // No tasks match since start is beyond all tasks
      expect(result.filteredTasks).toHaveLength(0);
      expect(result.message).toContain('0 of 3');
    });
  });

  describe('message formatting', () => {
    test('formats message correctly for full range', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 2, end: 4 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range 2-4: 3 of 5 tasks selected');
    });

    test('formats message correctly for open-ended start', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { start: 3 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range 3-: 3 of 5 tasks selected');
    });

    test('formats message correctly for open-ended end', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = { end: 2 };

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range -2: 2 of 5 tasks selected');
    });

    test('formats message correctly for all tasks', () => {
      const tasks = createTasks(5);
      const range: TaskRangeFilter = {};

      const result = filterTasksByRange(tasks, range);

      expect(result.message).toBe('Task range all: 5 of 5 tasks selected');
    });
  });
});

describe('parseRunArgs', () => {
  describe('--task-range parsing', () => {
    test('parses full range "1-5"', () => {
      const result = parseRunArgs(['--task-range', '1-5']);

      expect(result.taskRange).toEqual({ start: 1, end: 5 });
    });

    test('parses start-only range "3-"', () => {
      const result = parseRunArgs(['--task-range', '3-']);

      expect(result.taskRange).toEqual({ start: 3, end: undefined });
    });

    test('parses end-only range "-10"', () => {
      const result = parseRunArgs(['--task-range', '-10']);

      expect(result.taskRange).toEqual({ start: undefined, end: 10 });
    });

    test('parses single task number "5"', () => {
      const result = parseRunArgs(['--task-range', '5']);

      expect(result.taskRange).toEqual({ start: 5, end: 5 });
    });

    test('parses range with same start and end "3-3"', () => {
      const result = parseRunArgs(['--task-range', '3-3']);

      expect(result.taskRange).toEqual({ start: 3, end: 3 });
    });

    test('handles missing value after --task-range', () => {
      const result = parseRunArgs(['--task-range']);

      expect(result.taskRange).toBeUndefined();
    });

    test('handles --task-range followed by another flag', () => {
      const result = parseRunArgs(['--task-range', '--parallel']);

      // --parallel should not be consumed as a range value
      expect(result.taskRange).toBeUndefined();
      expect(result.parallel).toBe(true);
    });

    test('handles invalid range format gracefully', () => {
      const result = parseRunArgs(['--task-range', 'abc']);

      // NaN parsing should not set taskRange
      expect(result.taskRange).toBeUndefined();
    });
  });

  describe('--parallel parsing', () => {
    test('parses --parallel without value as true', () => {
      const result = parseRunArgs(['--parallel']);

      expect(result.parallel).toBe(true);
    });

    test('parses --parallel with numeric value', () => {
      const result = parseRunArgs(['--parallel', '4']);

      expect(result.parallel).toBe(4);
    });

    test('parses --parallel with invalid value as true', () => {
      const result = parseRunArgs(['--parallel', 'abc']);

      expect(result.parallel).toBe(true);
    });

    test('parses --parallel followed by another flag', () => {
      const result = parseRunArgs(['--parallel', '--headless']);

      expect(result.parallel).toBe(true);
      expect(result.headless).toBe(true);
    });
  });

  describe('--direct-merge parsing', () => {
    test('parses --direct-merge flag', () => {
      const result = parseRunArgs(['--direct-merge']);

      expect(result.directMerge).toBe(true);
    });

    test('parses --target-branch with value', () => {
      const result = parseRunArgs(['--target-branch', 'feature/parallel-out']);

      expect(result.targetBranch).toBe('feature/parallel-out');
    });
  });

  describe('--serial/--sequential parsing', () => {
    test('parses --serial flag', () => {
      const result = parseRunArgs(['--serial']);

      expect(result.serial).toBe(true);
    });

    test('parses --sequential flag', () => {
      const result = parseRunArgs(['--sequential']);

      expect(result.serial).toBe(true);
    });
  });

  describe('--listen parsing', () => {
    test('parses --listen flag and sets headless', () => {
      const result = parseRunArgs(['--listen']);

      expect(result.listen).toBe(true);
      expect(result.headless).toBe(true);
    });

    test('parses --listen-port with valid port', () => {
      const result = parseRunArgs(['--listen-port', '8080']);

      expect(result.listenPort).toBe(8080);
    });

    test('ignores --listen-port with invalid port', () => {
      const result = parseRunArgs(['--listen-port', '0']);

      expect(result.listenPort).toBeUndefined();
    });

    test('ignores --listen-port with port > 65535', () => {
      const result = parseRunArgs(['--listen-port', '70000']);

      expect(result.listenPort).toBeUndefined();
    });
  });

  describe('combined options', () => {
    test('parses multiple options together', () => {
      const result = parseRunArgs([
        '--parallel',
        '3',
        '--task-range',
        '1-10',
        '--direct-merge',
        '--target-branch',
        'feature/parallel-out',
        '--headless',
      ]);

      expect(result.parallel).toBe(3);
      expect(result.taskRange).toEqual({ start: 1, end: 10 });
      expect(result.directMerge).toBe(true);
      expect(result.targetBranch).toBe('feature/parallel-out');
      expect(result.headless).toBe(true);
    });
  });
});

describe('printRunHelp', () => {
  test('prints help without throwing', () => {
    // Capture console output
    const originalLog = console.log;
    const output: string[] = [];
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    };

    try {
      // Should not throw
      printRunHelp();

      // Should have printed something
      expect(output.length).toBeGreaterThan(0);

      // Should contain usage info
      const fullOutput = output.join('\n');
      expect(fullOutput).toContain('ralph-tui run');
      expect(fullOutput).toContain('--task-range');
      expect(fullOutput).toContain('--parallel');
    } finally {
      console.log = originalLog;
    }
  });
});

describe('conflict resolution helpers', () => {
  /**
   * Tests for the exported conflict resolution helper functions.
   * These functions are used by the parallel execution callbacks.
   */

  /** Helper to create a mock FileConflict */
  function mockConflict(filePath: string): FileConflict {
    return {
      filePath,
      oursContent: 'ours',
      theirsContent: 'theirs',
      baseContent: 'base',
      conflictMarkers: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch',
    };
  }

  /** Helper to create a mock ConflictResolutionResult */
  function mockResolution(filePath: string, success: boolean): ConflictResolutionResult {
    return {
      filePath,
      success,
      method: 'ai',
      resolvedContent: success ? 'resolved' : undefined,
      error: success ? undefined : 'Resolution failed',
    };
  }

  describe('clearConflictState', () => {
    test('clears all conflict-related fields', () => {
      const state: ParallelConflictState = {
        conflicts: [mockConflict('src/file1.ts'), mockConflict('src/file2.ts')],
        conflictResolutions: [mockResolution('src/file1.ts', true)],
        conflictTaskId: 'TASK-001',
        conflictTaskTitle: 'Test task',
        aiResolving: true,
      };

      clearConflictState(state);

      expect(state.conflicts).toHaveLength(0);
      expect(state.conflictResolutions).toHaveLength(0);
      expect(state.conflictTaskId).toBe('');
      expect(state.conflictTaskTitle).toBe('');
      expect(state.aiResolving).toBe(false);
    });

    test('works on already empty state', () => {
      const state: ParallelConflictState = {
        conflicts: [],
        conflictResolutions: [],
        conflictTaskId: '',
        conflictTaskTitle: '',
        aiResolving: false,
      };

      // Should not throw
      clearConflictState(state);

      expect(state.conflicts).toHaveLength(0);
      expect(state.conflictTaskId).toBe('');
    });
  });

  describe('findResolutionByPath', () => {
    test('finds resolution when it exists', () => {
      const resolutions: ConflictResolutionResult[] = [
        mockResolution('src/file1.ts', true),
        mockResolution('src/file2.ts', false),
        mockResolution('src/file3.ts', true),
      ];

      const result = findResolutionByPath(resolutions, 'src/file2.ts');

      expect(result).toBeDefined();
      expect(result?.filePath).toBe('src/file2.ts');
      expect(result?.success).toBe(false);
    });

    test('returns undefined when resolution does not exist', () => {
      const resolutions: ConflictResolutionResult[] = [
        mockResolution('src/file1.ts', true),
      ];

      const result = findResolutionByPath(resolutions, 'nonexistent.ts');

      expect(result).toBeUndefined();
    });

    test('returns undefined for empty resolutions array', () => {
      const result = findResolutionByPath([], 'src/file1.ts');

      expect(result).toBeUndefined();
    });

    test('finds first match when duplicates exist', () => {
      const resolutions: ConflictResolutionResult[] = [
        mockResolution('src/file1.ts', true),
        mockResolution('src/file1.ts', false), // duplicate with different success
      ];

      const result = findResolutionByPath(resolutions, 'src/file1.ts');

      expect(result?.success).toBe(true); // First match
    });
  });

  describe('areAllConflictsResolved', () => {
    test('returns true when all conflicts have successful resolutions', () => {
      const conflicts: FileConflict[] = [
        mockConflict('src/file1.ts'),
        mockConflict('src/file2.ts'),
      ];
      const resolutions: ConflictResolutionResult[] = [
        mockResolution('src/file1.ts', true),
        mockResolution('src/file2.ts', true),
      ];

      expect(areAllConflictsResolved(conflicts, resolutions)).toBe(true);
    });

    test('returns false when some resolutions failed', () => {
      const conflicts: FileConflict[] = [
        mockConflict('src/file1.ts'),
        mockConflict('src/file2.ts'),
      ];
      const resolutions: ConflictResolutionResult[] = [
        mockResolution('src/file1.ts', true),
        mockResolution('src/file2.ts', false), // failed
      ];

      expect(areAllConflictsResolved(conflicts, resolutions)).toBe(false);
    });

    test('returns false when resolutions are missing', () => {
      const conflicts: FileConflict[] = [
        mockConflict('src/file1.ts'),
        mockConflict('src/file2.ts'),
      ];
      const resolutions: ConflictResolutionResult[] = [
        mockResolution('src/file1.ts', true),
        // file2.ts resolution missing
      ];

      expect(areAllConflictsResolved(conflicts, resolutions)).toBe(false);
    });

    test('returns true when no conflicts exist', () => {
      expect(areAllConflictsResolved([], [])).toBe(true);
    });

    test('returns false when resolutions exist but for wrong files', () => {
      const conflicts: FileConflict[] = [
        mockConflict('src/file1.ts'),
      ];
      const resolutions: ConflictResolutionResult[] = [
        mockResolution('src/other.ts', true), // wrong file
      ];

      expect(areAllConflictsResolved(conflicts, resolutions)).toBe(false);
    });
  });

  describe('keyboard handler behavior', () => {
    test('escape key triggers abort callback', () => {
      let abortCalled = false;
      let panelHidden = false;

      const onConflictAbort = async () => {
        abortCalled = true;
      };

      // Simulate escape key handler from RunApp.tsx
      const handleEscapeKey = () => {
        if (onConflictAbort) {
          onConflictAbort().catch(() => {});
        }
        panelHidden = true;
      };

      handleEscapeKey();

      expect(abortCalled).toBe(true);
      expect(panelHidden).toBe(true);
    });

    test('a key triggers accept callback with selected file', () => {
      let acceptedFile: string | undefined;
      const conflicts = [
        { filePath: 'src/file1.ts' },
        { filePath: 'src/file2.ts' },
      ];
      const selectedIndex = 1;

      const onConflictAccept = (filePath: string) => {
        acceptedFile = filePath;
      };

      // Simulate 'a' key handler from RunApp.tsx
      const handleAcceptKey = () => {
        if (onConflictAccept && conflicts[selectedIndex]) {
          onConflictAccept(conflicts[selectedIndex].filePath);
        }
      };

      handleAcceptKey();

      expect(acceptedFile).toBe('src/file2.ts');
    });

    test('r key triggers abort callback (reject)', () => {
      let abortCalled = false;
      let panelHidden = false;

      const onConflictAbort = async () => {
        abortCalled = true;
      };

      // Simulate 'r' key handler from RunApp.tsx
      const handleRejectKey = () => {
        if (onConflictAbort) {
          onConflictAbort().catch(() => {});
        }
        panelHidden = true;
      };

      handleRejectKey();

      expect(abortCalled).toBe(true);
      expect(panelHidden).toBe(true);
    });

    test('shift+A triggers acceptAll callback and hides panel', () => {
      let acceptAllCalled = false;
      let panelHidden = false;

      const onConflictAcceptAll = () => {
        acceptAllCalled = true;
      };

      // Simulate shift+A key handler from RunApp.tsx
      const handleAcceptAllKey = () => {
        if (onConflictAcceptAll) {
          onConflictAcceptAll();
        }
        panelHidden = true;
      };

      handleAcceptAllKey();

      expect(acceptAllCalled).toBe(true);
      expect(panelHidden).toBe(true);
    });

    test('navigation keys update selected index', () => {
      let selectedIndex = 0;
      const conflictsLength = 3;

      // Simulate j/down key handler
      const handleDownKey = () => {
        selectedIndex = Math.min(selectedIndex + 1, conflictsLength - 1);
      };

      // Simulate k/up key handler
      const handleUpKey = () => {
        selectedIndex = Math.max(selectedIndex - 1, 0);
      };

      // Test navigation
      handleDownKey();
      expect(selectedIndex).toBe(1);

      handleDownKey();
      expect(selectedIndex).toBe(2);

      handleDownKey(); // Should not go beyond max
      expect(selectedIndex).toBe(2);

      handleUpKey();
      expect(selectedIndex).toBe(1);

      handleUpKey();
      expect(selectedIndex).toBe(0);

      handleUpKey(); // Should not go below 0
      expect(selectedIndex).toBe(0);
    });
  });

  describe('parallel failure handling', () => {
    const basePersistedState: PersistedSessionState = {
      version: 1,
      sessionId: 'parallel-session-failure',
      status: 'running',
      startedAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      currentIteration: 0,
      maxIterations: 0,
      tasksCompleted: 0,
      isPaused: false,
      agentPlugin: 'agent',
      trackerState: {
        plugin: 'tracker',
        totalTasks: 0,
        tasks: [],
      },
      iterations: [],
      skippedTaskIds: [],
      cwd: '/tmp',
      activeTaskIds: [],
    };

    test('sets and persists failed state on startup fallback with default message', () => {
      let persisted: PersistedSessionState | undefined;
      const parallelState = { failureMessage: null as string | null };
      const recordPersistedState = (state: PersistedSessionState) => {
        persisted = state;
      };
      const fallbackState = applyParallelFailureState(
        basePersistedState,
        parallelState,
        'Parallel execution failed before startup',
        recordPersistedState
      );

      expect(parallelState.failureMessage).toBe('Parallel execution failed before startup');
      expect(fallbackState.status).toBe('failed');
      expect(persisted?.status).toBe('failed');
      expect(persisted).toEqual(fallbackState);
    });

    test('keeps existing startup error message and still persists failed state', () => {
      let persisted: PersistedSessionState | undefined;
      const parallelState = { failureMessage: 'Existing startup failure' as string | null };
      const recordPersistedState = (state: PersistedSessionState) => {
        persisted = state;
      };
      const fallbackState = applyParallelFailureState(
        basePersistedState,
        parallelState,
        'Parallel execution failed before startup',
        recordPersistedState
      );

      expect(parallelState.failureMessage).toBe('Existing startup failure');
      expect(fallbackState.status).toBe('failed');
      expect(persisted?.status).toBe('failed');
    });
  });
});
