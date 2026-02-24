/**
 * ABOUTME: Tests for the run command utilities.
 * Covers task range filtering, --target-branch parsing, conflict resolution helpers,
 * parallel/sequential run summary helpers, and WorktreeInfo-backed summary mocks.
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
  buildParallelSummaryFilePath,
  createParallelRunSummary,
  formatParallelRunSummary,
  buildSequentialSummaryFilePath,
  createSequentialRunSummary,
  formatSequentialRunSummary,
  type TaskRangeFilter,
  type ParallelConflictState,
} from './run.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { FileConflict, ConflictResolutionResult, ParallelExecutorState, WorktreeInfo } from '../parallel/types.js';
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
  });

  describe('--target-branch parsing', () => {
    test('parses --target-branch with value', () => {
      const result = parseRunArgs(['--target-branch', 'feature/parallel-out']);

      expect(result.targetBranch).toBe('feature/parallel-out');
    });

    test('ignores --target-branch without value', () => {
      const result = parseRunArgs(['--target-branch']);

      expect(result.targetBranch).toBeUndefined();
    });

    test('ignores --target-branch when followed by another flag', () => {
      const result = parseRunArgs(['--target-branch', '--headless']);

      expect(result.targetBranch).toBeUndefined();
      expect(result.headless).toBe(true);
    });

    test('parses --target-branch with --direct-merge for runtime validation', () => {
      const result = parseRunArgs([
        '--direct-merge',
        '--target-branch',
        'feature/parallel-out',
      ]);

      expect(result.directMerge).toBe(true);
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
      expect(fullOutput).toContain('--target-branch');
    } finally {
      console.log = originalLog;
    }
  });
});

describe('parallel summary helpers', () => {
  function createMockExecutorState(
    overrides: Partial<ParallelExecutorState> = {}
  ): ParallelExecutorState {
    return {
      status: 'completed',
      taskGraph: null,
      currentGroupIndex: 0,
      totalGroups: 1,
      workers: [],
      mergeQueue: [],
      completedMerges: [],
      activeConflicts: [],
      totalTasksCompleted: 3,
      totalTasks: 3,
      startedAt: '2026-02-23T10:00:00.000Z',
      elapsedMs: 120000,
      ...overrides,
    };
  }

  function createMockWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
    return {
      id: 'worker-1',
      path: '/tmp/worktrees/worker-1',
      branch: 'ralph-parallel/task-1',
      workerId: '1',
      taskId: 'TASK-1',
      active: false,
      dirty: true,
      createdAt: '2026-02-23T10:00:00.000Z',
      ...overrides,
    };
  }

  test('buildParallelSummaryFilePath sanitizes session id and timestamp', () => {
    const path = buildParallelSummaryFilePath(
      '/tmp/project',
      'session/abc',
      '2026-02-23T10:11:12.123Z'
    );

    expect(path).toBe(
      '/tmp/project/.ralph-tui/reports/parallel-summary-session-abc-2026-02-23T10-11-12-123Z.txt'
    );
  });

  test('createParallelRunSummary uses completion metrics when provided', () => {
    const summary = createParallelRunSummary({
      sessionId: 'session-1',
      mode: 'headless',
      executorState: createMockExecutorState({
        totalTasksCompleted: 2,
        totalTasks: 4,
        elapsedMs: 1000,
      }),
      directMerge: false,
      sessionBranch: 'ralph-session/session-1',
      originalBranch: 'main',
      returnToOriginalBranchError: null,
      preservedRecoveryWorktrees: [],
      completionMetrics: {
        totalTasksCompleted: 3,
        totalTasksFailed: 1,
        totalMergesCompleted: 3,
        totalConflictsResolved: 2,
        durationMs: 42000,
      },
    });

    expect(summary.tasksCompleted).toBe(3);
    expect(summary.tasksFailed).toBe(1);
    expect(summary.mergesCompleted).toBe(3);
    expect(summary.conflictsResolved).toBe(2);
    expect(summary.durationMs).toBe(42000);
  });

  test('createParallelRunSummary derives fallback metrics from executor state', () => {
    const summary = createParallelRunSummary({
      sessionId: 'session-2',
      mode: 'tui',
      executorState: createMockExecutorState({
        status: 'interrupted',
        totalTasksCompleted: 2,
        totalTasks: 5,
        elapsedMs: 93000,
      }),
      directMerge: true,
      sessionBranch: null,
      originalBranch: 'main',
      returnToOriginalBranchError: 'checkout failed',
      preservedRecoveryWorktrees: [],
    });

    expect(summary.tasksCompleted).toBe(2);
    expect(summary.tasksFailed).toBe(3);
    expect(summary.mergesCompleted).toBe(2);
    expect(summary.conflictsResolved).toBe(0);
    expect(summary.durationMs).toBe(93000);
  });

  test('formatParallelRunSummary includes worktree and branch details', () => {
    const summary = createParallelRunSummary({
      sessionId: 'session-3',
      mode: 'headless',
      executorState: createMockExecutorState(),
      directMerge: false,
      sessionBranch: 'ralph-session/session-3',
      originalBranch: 'main',
      returnToOriginalBranchError: null,
      preservedRecoveryWorktrees: [createMockWorktree()],
    });

    const output = formatParallelRunSummary(summary);

    expect(output).toContain('Parallel Run Summary');
    expect(output).toContain('Session branch:         ralph-session/session-3');
    expect(output).toContain('Original branch:        main');
    expect(output).toContain('Preserved worktrees:    1');
    expect(output).toContain('ralph-parallel/task-1 (TASK-1)');
    expect(output).toContain('/tmp/worktrees/worker-1');
  });
});

describe('sequential summary helpers', () => {
  test('buildSequentialSummaryFilePath sanitizes session id and timestamp', () => {
    const path = buildSequentialSummaryFilePath(
      '/tmp/project',
      'session/abc',
      '2026-02-23T10:11:12.123Z'
    );

    expect(path).toBe(
      '/tmp/project/.ralph-tui/reports/sequential-summary-session-abc-2026-02-23T10-11-12-123Z.txt'
    );
  });

  test('createSequentialRunSummary computes duration and task counters', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    const summary = createSequentialRunSummary({
      sessionId: 'session-seq',
      mode: 'headless',
      startedAt,
      status: 'completed',
      totalTasks: 5,
      tasksCompleted: 5,
      currentIteration: 7,
      maxIterations: 10,
    });

    expect(summary.sessionId).toBe('session-seq');
    expect(summary.mode).toBe('headless');
    expect(summary.status).toBe('completed');
    expect(summary.totalTasks).toBe(5);
    expect(summary.tasksCompleted).toBe(5);
    expect(summary.currentIteration).toBe(7);
    expect(summary.maxIterations).toBe(10);
    expect(summary.durationMs).toBeGreaterThanOrEqual(89_000);
  });

  test('formatSequentialRunSummary includes key fields', () => {
    const summary = createSequentialRunSummary({
      sessionId: 'session-seq-2',
      mode: 'tui',
      startedAt: '2026-02-23T10:00:00.000Z',
      finishedAt: '2026-02-23T10:05:00.000Z',
      status: 'interrupted',
      totalTasks: 5,
      tasksCompleted: 3,
      currentIteration: 4,
      maxIterations: 10,
    });

    expect(summary.durationMs).toBe(300000);

    const output = formatSequentialRunSummary(summary);
    expect(output).toContain('Sequential Run Summary');
    expect(output).toContain('Status:                 INTERRUPTED');
    expect(output).toContain('Duration:               5m');
    expect(output).toContain('Tasks:                  3/5 completed');
    expect(output).toContain('Iterations:             4/10');
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
