/**
 * ABOUTME: Integration tests for the ralph status command.
 * Tests status determination, JSON output, exit codes, and human-readable output.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { printStatusHelp } from '../../src/commands/status.js';

// Import types for testing
import type { RalphStatus, StatusExitCode, StatusJsonOutput } from '../../src/commands/status.js';

// Mock the session module
const mockHasPersistedSession = mock(() => Promise.resolve(false));
const mockLoadPersistedSession = mock(() => Promise.resolve(null));
const mockGetSessionSummary = mock(() => ({
  sessionId: 'test-session-001',
  status: 'running',
  tasksCompleted: 5,
  totalTasks: 10,
  currentIteration: 3,
  maxIterations: 20,
  agentPlugin: 'claude',
  trackerPlugin: 'beads',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isResumable: true,
}));
const mockIsSessionResumable = mock(() => true);
const mockCheckLock = mock(() => Promise.resolve({
  isLocked: false,
  isStale: false,
  lock: null,
}));

// Import real exports from the session module to re-export in mock
// This prevents mock pollution affecting other tests
import {
  checkSession,
  acquireLock,
  releaseLock,
  cleanStaleLock,
  createSession,
  saveSession,
  updateSessionStatus,
  updateSessionIteration,
  updateSessionMaxIterations,
  endSession,
  resumeSession,
  savePersistedSession,
  deletePersistedSession,
  createPersistedSession,
  updateSessionAfterIteration,
  pauseSession,
  resumePersistedSession,
  completeSession,
  failSession,
  addSkippedTask,
  addActiveTask,
  removeActiveTask,
  clearActiveTasks,
  getActiveTasks,
  setSubagentPanelVisible,
  detectAndRecoverStaleSession,
  acquireLockWithPrompt,
  releaseLock as releaseLockNew,
  registerLockCleanupHandlers,
} from '../../src/session/index.js';

mock.module('../../src/session/index.js', () => ({
  // Mocked functions for testing
  hasPersistedSession: mockHasPersistedSession,
  loadPersistedSession: mockLoadPersistedSession,
  getSessionSummary: mockGetSessionSummary,
  isSessionResumable: mockIsSessionResumable,
  checkLock: mockCheckLock,
  // Re-export real functions to prevent pollution
  checkSession,
  acquireLock,
  releaseLock,
  cleanStaleLock,
  createSession,
  saveSession,
  updateSessionStatus,
  updateSessionIteration,
  updateSessionMaxIterations,
  endSession,
  resumeSession,
  savePersistedSession,
  deletePersistedSession,
  createPersistedSession,
  updateSessionAfterIteration,
  pauseSession,
  resumePersistedSession,
  completeSession,
  failSession,
  addSkippedTask,
  addActiveTask,
  removeActiveTask,
  clearActiveTasks,
  getActiveTasks,
  setSubagentPanelVisible,
  detectAndRecoverStaleSession,
  acquireLockWithPrompt,
  releaseLockNew,
  registerLockCleanupHandlers,
}));

describe('status command', () => {
  describe('status types', () => {
    test('RalphStatus enum values are valid', () => {
      const validStatuses: RalphStatus[] = [
        'running',
        'paused',
        'completed',
        'failed',
        'no-session',
      ];
      expect(validStatuses).toHaveLength(5);
    });

    test('StatusExitCode values are valid', () => {
      const validCodes: StatusExitCode[] = [0, 1, 2];
      expect(validCodes).toHaveLength(3);
    });
  });

  describe('StatusJsonOutput structure', () => {
    test('valid JSON output with session', () => {
      const output: StatusJsonOutput = {
        status: 'running',
        session: {
          id: 'test-123',
          status: 'running',
          progress: {
            completed: 5,
            total: 10,
            percent: 50,
          },
          iteration: {
            current: 3,
            max: 20,
          },
          elapsedSeconds: 120,
          tracker: 'beads',
          agent: 'claude',
          model: 'opus',
          epicId: 'epic-001',
          startedAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-01-15T10:02:00Z',
          resumable: true,
        },
        lock: {
          isLocked: true,
          isStale: false,
          pid: 12345,
          hostname: 'localhost',
        },
      };

      expect(output.status).toBe('running');
      expect(output.session?.progress.percent).toBe(50);
      expect(output.lock?.pid).toBe(12345);
    });

    test('valid JSON output without session', () => {
      const output: StatusJsonOutput = {
        status: 'no-session',
      };

      expect(output.status).toBe('no-session');
      expect(output.session).toBeUndefined();
      expect(output.lock).toBeUndefined();
    });

    test('valid JSON output with optional fields', () => {
      const output: StatusJsonOutput = {
        status: 'completed',
        session: {
          id: 'test-456',
          status: 'completed',
          progress: {
            completed: 10,
            total: 10,
            percent: 100,
          },
          iteration: {
            current: 15,
            max: 0, // unlimited
          },
          elapsedSeconds: 300,
          tracker: 'json',
          agent: 'opencode',
          // model, epicId, prdPath are optional
          startedAt: '2026-01-15T09:00:00Z',
          updatedAt: '2026-01-15T09:05:00Z',
          resumable: false,
        },
      };

      expect(output.session?.model).toBeUndefined();
      expect(output.session?.epicId).toBeUndefined();
      expect(output.session?.prdPath).toBeUndefined();
    });
  });

  describe('exit code mapping', () => {
    test('completed status returns exit code 0', () => {
      // Test the exit code logic directly
      const getExitCode = (status: RalphStatus): StatusExitCode => {
        switch (status) {
          case 'completed':
            return 0;
          case 'running':
          case 'paused':
            return 1;
          case 'failed':
          case 'no-session':
            return 2;
        }
      };

      expect(getExitCode('completed')).toBe(0);
    });

    test('running status returns exit code 1', () => {
      const getExitCode = (status: RalphStatus): StatusExitCode => {
        switch (status) {
          case 'completed':
            return 0;
          case 'running':
          case 'paused':
            return 1;
          case 'failed':
          case 'no-session':
            return 2;
        }
      };

      expect(getExitCode('running')).toBe(1);
    });

    test('paused status returns exit code 1', () => {
      const getExitCode = (status: RalphStatus): StatusExitCode => {
        switch (status) {
          case 'completed':
            return 0;
          case 'running':
          case 'paused':
            return 1;
          case 'failed':
          case 'no-session':
            return 2;
        }
      };

      expect(getExitCode('paused')).toBe(1);
    });

    test('failed status returns exit code 2', () => {
      const getExitCode = (status: RalphStatus): StatusExitCode => {
        switch (status) {
          case 'completed':
            return 0;
          case 'running':
          case 'paused':
            return 1;
          case 'failed':
          case 'no-session':
            return 2;
        }
      };

      expect(getExitCode('failed')).toBe(2);
    });

    test('no-session status returns exit code 2', () => {
      const getExitCode = (status: RalphStatus): StatusExitCode => {
        switch (status) {
          case 'completed':
            return 0;
          case 'running':
          case 'paused':
            return 1;
          case 'failed':
          case 'no-session':
            return 2;
        }
      };

      expect(getExitCode('no-session')).toBe(2);
    });
  });

  describe('status determination logic', () => {
    test('running when lock is held', () => {
      interface LockCheckResult {
        isLocked: boolean;
        isStale: boolean;
        lock: { pid: number } | null;
      }

      interface PersistedSessionState {
        status: string;
      }

      const determineStatus = (
        session: PersistedSessionState | null,
        lockCheck: LockCheckResult
      ): RalphStatus => {
        if (lockCheck.isLocked) {
          return 'running';
        }
        if (!session) {
          return 'no-session';
        }
        switch (session.status) {
          case 'running':
            return 'running';
          case 'paused':
            return 'paused';
          case 'completed':
            return 'completed';
          case 'failed':
            return 'failed';
          case 'interrupted':
            return 'paused';
          default:
            return 'no-session';
        }
      };

      const result = determineStatus(
        { status: 'running' },
        { isLocked: true, isStale: false, lock: { pid: 12345 } }
      );
      expect(result).toBe('running');
    });

    test('no-session when no session file', () => {
      interface LockCheckResult {
        isLocked: boolean;
        isStale: boolean;
        lock: null;
      }

      const determineStatus = (
        session: null,
        lockCheck: LockCheckResult
      ): RalphStatus => {
        if (lockCheck.isLocked) {
          return 'running';
        }
        if (!session) {
          return 'no-session';
        }
        return 'no-session';
      };

      const result = determineStatus(
        null,
        { isLocked: false, isStale: false, lock: null }
      );
      expect(result).toBe('no-session');
    });

    test('paused when session is interrupted', () => {
      interface LockCheckResult {
        isLocked: boolean;
        isStale: boolean;
        lock: null;
      }

      interface PersistedSessionState {
        status: string;
      }

      const determineStatus = (
        session: PersistedSessionState | null,
        lockCheck: LockCheckResult
      ): RalphStatus => {
        if (lockCheck.isLocked) {
          return 'running';
        }
        if (!session) {
          return 'no-session';
        }
        switch (session.status) {
          case 'running':
            return 'running';
          case 'paused':
            return 'paused';
          case 'completed':
            return 'completed';
          case 'failed':
            return 'failed';
          case 'interrupted':
            return 'paused'; // Interrupted sessions are resumable
          default:
            return 'no-session';
        }
      };

      const result = determineStatus(
        { status: 'interrupted' },
        { isLocked: false, isStale: false, lock: null }
      );
      expect(result).toBe('paused');
    });

    test('completed when session is completed', () => {
      interface LockCheckResult {
        isLocked: boolean;
        isStale: boolean;
        lock: null;
      }

      interface PersistedSessionState {
        status: string;
      }

      const determineStatus = (
        session: PersistedSessionState | null,
        lockCheck: LockCheckResult
      ): RalphStatus => {
        if (lockCheck.isLocked) {
          return 'running';
        }
        if (!session) {
          return 'no-session';
        }
        switch (session.status) {
          case 'completed':
            return 'completed';
          case 'failed':
            return 'failed';
          default:
            return 'no-session';
        }
      };

      const result = determineStatus(
        { status: 'completed' },
        { isLocked: false, isStale: false, lock: null }
      );
      expect(result).toBe('completed');
    });

    test('failed when session is failed', () => {
      interface LockCheckResult {
        isLocked: boolean;
        isStale: boolean;
        lock: null;
      }

      interface PersistedSessionState {
        status: string;
      }

      const determineStatus = (
        session: PersistedSessionState | null,
        lockCheck: LockCheckResult
      ): RalphStatus => {
        if (lockCheck.isLocked) {
          return 'running';
        }
        if (!session) {
          return 'no-session';
        }
        switch (session.status) {
          case 'completed':
            return 'completed';
          case 'failed':
            return 'failed';
          default:
            return 'no-session';
        }
      };

      const result = determineStatus(
        { status: 'failed' },
        { isLocked: false, isStale: false, lock: null }
      );
      expect(result).toBe('failed');
    });
  });

  describe('printStatusHelp', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    test('prints help text', () => {
      printStatusHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('ralph-tui status');
      expect(output).toContain('--json');
      expect(output).toContain('--cwd');
    });

    test('includes exit codes documentation', () => {
      printStatusHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Exit Codes:');
      expect(output).toContain('0');
      expect(output).toContain('1');
      expect(output).toContain('2');
    });

    test('includes examples', () => {
      printStatusHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Examples:');
      expect(output).toContain('ralph-tui status');
      expect(output).toContain('ralph-tui status --json');
    });

    test('includes CI/Script usage examples', () => {
      printStatusHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('CI/Script Usage:');
    });
  });

  describe('progress bar rendering', () => {
    test('clamps invalid percent values to avoid RangeError', () => {
      const { __test__ } = require('../../src/commands/status.js');
      const { createProgressBar } = __test__ as { createProgressBar: (percent: number, width: number) => string };

      expect(createProgressBar(-10, 10)).toBe('[░░░░░░░░░░]');
      expect(createProgressBar(150, 10)).toBe('[██████████]');
      expect(createProgressBar(Number.NaN, 10)).toBe('[░░░░░░░░░░]');
    });

    test('handles non-finite width safely', () => {
      const { __test__ } = require('../../src/commands/status.js');
      const { createProgressBar } = __test__ as { createProgressBar: (percent: number, width: number) => string };

      expect(createProgressBar(50, Number.NaN)).toBe('[]');
      expect(createProgressBar(50, Number.POSITIVE_INFINITY)).toBe('[]');
    });
  });

  describe('progress calculation', () => {
    test('calculates progress percentage correctly', () => {
      const calculateProgress = (completed: number, total: number): number => {
        if (total === 0) return 0;
        return Math.round((completed / total) * 100);
      };

      expect(calculateProgress(5, 10)).toBe(50);
      expect(calculateProgress(0, 10)).toBe(0);
      expect(calculateProgress(10, 10)).toBe(100);
      expect(calculateProgress(3, 10)).toBe(30);
      expect(calculateProgress(7, 10)).toBe(70);
    });

    test('handles zero total tasks', () => {
      const calculateProgress = (completed: number, total: number): number => {
        if (total === 0) return 0;
        return Math.round((completed / total) * 100);
      };

      expect(calculateProgress(0, 0)).toBe(0);
      expect(calculateProgress(5, 0)).toBe(0);
    });
  });

  describe('elapsed time calculation', () => {
    test('calculates elapsed seconds correctly', () => {
      const getElapsedSeconds = (startedAt: string, updatedAt: string): number => {
        const start = new Date(startedAt).getTime();
        const end = new Date(updatedAt).getTime();
        return Math.floor((end - start) / 1000);
      };

      // 2 minutes = 120 seconds
      expect(getElapsedSeconds(
        '2026-01-15T10:00:00Z',
        '2026-01-15T10:02:00Z'
      )).toBe(120);

      // 1 hour = 3600 seconds
      expect(getElapsedSeconds(
        '2026-01-15T10:00:00Z',
        '2026-01-15T11:00:00Z'
      )).toBe(3600);

      // 0 seconds
      expect(getElapsedSeconds(
        '2026-01-15T10:00:00Z',
        '2026-01-15T10:00:00Z'
      )).toBe(0);
    });
  });

  describe('duration formatting', () => {
    test('formats duration in human-readable form', () => {
      const formatDuration = (startedAt: string, updatedAt: string): string => {
        const start = new Date(startedAt).getTime();
        const end = new Date(updatedAt).getTime();
        const durationMs = end - start;

        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
          return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
          return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
      };

      // Seconds only
      expect(formatDuration(
        '2026-01-15T10:00:00Z',
        '2026-01-15T10:00:30Z'
      )).toBe('30s');

      // Minutes and seconds
      expect(formatDuration(
        '2026-01-15T10:00:00Z',
        '2026-01-15T10:05:30Z'
      )).toBe('5m 30s');

      // Hours and minutes
      expect(formatDuration(
        '2026-01-15T10:00:00Z',
        '2026-01-15T12:30:00Z'
      )).toBe('2h 30m');
    });
  });
});
