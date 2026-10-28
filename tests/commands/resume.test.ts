/**
 * ABOUTME: Tests for the resume command.
 * Covers argument parsing, formatting, and the session registry integration.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  parseResumeArgs,
  printResumeHelp,
  formatSessionEntry,
  listSessions,
  cleanupRegistry,
  resolveSession,
  shouldWarnAboutTrackerMismatch,
  type ResumeArgs,
} from '../../src/commands/resume.js';
import type { SessionRegistryEntry } from '../../src/session/registry.js';
import * as sessionModule from '../../src/session/index.js';

/**
 * Tests for tracker validation logic (shouldWarnAboutTrackerMismatch).
 * See: https://github.com/subsy/ralph-tui/issues/247
 *
 * When resuming a session, if the tracker returns no tasks but the session
 * has task history, we warn the user about the mismatch. This indicates
 * the tracker cannot find the expected tasks (wrong epicId, missing prdPath, etc.).
 */
describe('shouldWarnAboutTrackerMismatch (issue #247)', () => {
  describe('mismatch detection (should warn)', () => {
    test('returns true when engine has 0 tasks but session has 130', () => {
      // Scenario: session reports 108/130 complete but tracker finds 0 tasks
      expect(shouldWarnAboutTrackerMismatch(0, 130)).toBe(true);
    });

    test('returns true when engine has 0 tasks but session has 1', () => {
      expect(shouldWarnAboutTrackerMismatch(0, 1)).toBe(true);
    });

    test('returns true when engine has 0 tasks but session has large count', () => {
      expect(shouldWarnAboutTrackerMismatch(0, 1000)).toBe(true);
    });

    test('returns true for minimal mismatch (0 vs 1)', () => {
      // Edge case: smallest possible mismatch
      expect(shouldWarnAboutTrackerMismatch(0, 1)).toBe(true);
    });
  });

  describe('no mismatch (should not warn)', () => {
    test('returns false when both have 0 tasks (fresh session)', () => {
      expect(shouldWarnAboutTrackerMismatch(0, 0)).toBe(false);
    });

    test('returns false when engine has tasks matching session', () => {
      expect(shouldWarnAboutTrackerMismatch(130, 130)).toBe(false);
    });

    test('returns false when engine has more tasks than session (tasks added)', () => {
      expect(shouldWarnAboutTrackerMismatch(150, 130)).toBe(false);
    });

    test('returns false when engine has fewer tasks than session (some completed)', () => {
      // Normal scenario: some tasks completed so fewer remain in open/in_progress state
      expect(shouldWarnAboutTrackerMismatch(22, 130)).toBe(false);
    });

    test('returns false when engine has 1 task and session has 1', () => {
      expect(shouldWarnAboutTrackerMismatch(1, 1)).toBe(false);
    });

    test('returns false when engine has 1 task but session has 0', () => {
      // Session has no history, so no mismatch warning needed
      expect(shouldWarnAboutTrackerMismatch(1, 0)).toBe(false);
    });

    test('returns false when engine has many tasks but session has 0', () => {
      // Session has no history, so no mismatch warning needed
      expect(shouldWarnAboutTrackerMismatch(100, 0)).toBe(false);
    });
  });

  describe('boundary conditions', () => {
    test('handles equal counts correctly', () => {
      expect(shouldWarnAboutTrackerMismatch(0, 0)).toBe(false);
      expect(shouldWarnAboutTrackerMismatch(1, 1)).toBe(false);
      expect(shouldWarnAboutTrackerMismatch(50, 50)).toBe(false);
      expect(shouldWarnAboutTrackerMismatch(1000, 1000)).toBe(false);
    });

    test('handles engine > session correctly', () => {
      expect(shouldWarnAboutTrackerMismatch(1, 0)).toBe(false);
      expect(shouldWarnAboutTrackerMismatch(10, 5)).toBe(false);
      expect(shouldWarnAboutTrackerMismatch(100, 50)).toBe(false);
    });

    test('handles engine < session correctly (normal case)', () => {
      // Some tasks completed, fewer remain
      expect(shouldWarnAboutTrackerMismatch(1, 10)).toBe(false);
      expect(shouldWarnAboutTrackerMismatch(50, 100)).toBe(false);
      expect(shouldWarnAboutTrackerMismatch(99, 100)).toBe(false);
    });

    test('only warns when engine is exactly 0 AND session > 0', () => {
      // Key invariant: both conditions must be true
      expect(shouldWarnAboutTrackerMismatch(0, 1)).toBe(true);
      expect(shouldWarnAboutTrackerMismatch(0, 100)).toBe(true);
      expect(shouldWarnAboutTrackerMismatch(1, 1)).toBe(false);  // engine not 0
      expect(shouldWarnAboutTrackerMismatch(0, 0)).toBe(false);  // session not > 0
    });
  });
});

describe('resume command', () => {
  describe('parseResumeArgs', () => {
    describe('cwd option', () => {
      test('parses --cwd with path', () => {
        const result = parseResumeArgs(['--cwd', '/some/path']);
        expect(result.cwd).toBe('/some/path');
      });

      test('defaults cwd to process.cwd()', () => {
        const result = parseResumeArgs([]);
        expect(result.cwd).toBe(process.cwd());
      });

      test('ignores --cwd without value', () => {
        const result = parseResumeArgs(['--cwd']);
        expect(result.cwd).toBe(process.cwd());
      });

      test('ignores --cwd followed by another flag', () => {
        const result = parseResumeArgs(['--cwd', '--force']);
        expect(result.cwd).toBe(process.cwd());
        expect(result.force).toBe(true);
      });
    });

    describe('headless option', () => {
      test('parses --headless flag', () => {
        const result = parseResumeArgs(['--headless']);
        expect(result.headless).toBe(true);
      });

      test('headless defaults to false', () => {
        const result = parseResumeArgs([]);
        expect(result.headless).toBe(false);
      });
    });

    describe('force option', () => {
      test('parses --force flag', () => {
        const result = parseResumeArgs(['--force']);
        expect(result.force).toBe(true);
      });

      test('force defaults to false', () => {
        const result = parseResumeArgs([]);
        expect(result.force).toBe(false);
      });
    });

    describe('list option', () => {
      test('parses --list flag', () => {
        const result = parseResumeArgs(['--list']);
        expect(result.list).toBe(true);
      });

      test('parses -l short flag', () => {
        const result = parseResumeArgs(['-l']);
        expect(result.list).toBe(true);
      });

      test('list defaults to false', () => {
        const result = parseResumeArgs([]);
        expect(result.list).toBe(false);
      });
    });

    describe('cleanup option', () => {
      test('parses --cleanup flag', () => {
        const result = parseResumeArgs(['--cleanup']);
        expect(result.cleanup).toBe(true);
      });

      test('cleanup defaults to false', () => {
        const result = parseResumeArgs([]);
        expect(result.cleanup).toBe(false);
      });
    });

    describe('session ID positional argument', () => {
      test('parses session ID as first positional arg', () => {
        const result = parseResumeArgs(['abc123']);
        expect(result.sessionId).toBe('abc123');
      });

      test('parses session ID before flags', () => {
        const result = parseResumeArgs(['abc123', '--force']);
        expect(result.sessionId).toBe('abc123');
        expect(result.force).toBe(true);
      });

      test('parses session ID after flags', () => {
        const result = parseResumeArgs(['--force', 'abc123']);
        expect(result.sessionId).toBe('abc123');
        expect(result.force).toBe(true);
      });

      test('sessionId defaults to undefined', () => {
        const result = parseResumeArgs([]);
        expect(result.sessionId).toBeUndefined();
      });

      test('ignores arguments that look like flags', () => {
        const result = parseResumeArgs(['--unknown']);
        expect(result.sessionId).toBeUndefined();
      });
    });

    describe('combined options', () => {
      test('parses multiple flags together', () => {
        const result = parseResumeArgs(['--force', '--headless', '--list']);
        expect(result.force).toBe(true);
        expect(result.headless).toBe(true);
        expect(result.list).toBe(true);
      });

      test('parses session ID with cwd', () => {
        const result = parseResumeArgs(['abc123', '--cwd', '/path/to/project']);
        expect(result.sessionId).toBe('abc123');
        expect(result.cwd).toBe('/path/to/project');
      });

      test('parses all options together', () => {
        const result = parseResumeArgs([
          'session-id-123',
          '--cwd', '/my/project',
          '--headless',
          '--force',
        ]);
        expect(result.sessionId).toBe('session-id-123');
        expect(result.cwd).toBe('/my/project');
        expect(result.headless).toBe(true);
        expect(result.force).toBe(true);
        expect(result.list).toBe(false);
        expect(result.cleanup).toBe(false);
      });
    });
  });

  describe('formatSessionEntry', () => {
    const baseEntry: SessionRegistryEntry = {
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      cwd: '/home/user/my-project',
      status: 'paused',
      startedAt: '2025-01-22T10:00:00Z',
      updatedAt: '2025-01-22T11:00:00Z',
      agentPlugin: 'claude',
      trackerPlugin: 'beads',
    };

    test('formats paused session with index', () => {
      const result = formatSessionEntry(baseEntry, 0);
      expect(result).toContain('1.');
      expect(result).toContain('⏸');
      expect(result).toContain('a1b2c3d4');
      expect(result).toContain('paused');
      expect(result).toContain('claude');
      expect(result).toContain('beads');
      expect(result).toContain('/home/user/my-project');
    });

    test('formats running session', () => {
      const entry = { ...baseEntry, status: 'running' as const };
      const result = formatSessionEntry(entry);
      expect(result).toContain('▶');
      expect(result).toContain('running');
    });

    test('formats interrupted session', () => {
      const entry = { ...baseEntry, status: 'interrupted' as const };
      const result = formatSessionEntry(entry);
      expect(result).toContain('⚠');
      expect(result).toContain('interrupted');
    });

    test('formats completed session with dot icon', () => {
      const entry = { ...baseEntry, status: 'completed' as const };
      const result = formatSessionEntry(entry);
      expect(result).toContain('•');
      expect(result).toContain('completed');
    });

    test('formats failed session with dot icon', () => {
      const entry = { ...baseEntry, status: 'failed' as const };
      const result = formatSessionEntry(entry);
      expect(result).toContain('•');
      expect(result).toContain('failed');
    });

    test('formats session with sandbox tag', () => {
      const entry = { ...baseEntry, sandbox: true };
      const result = formatSessionEntry(entry);
      expect(result).toContain('[sandbox]');
    });

    test('formats session without sandbox tag', () => {
      const entry = { ...baseEntry, sandbox: false };
      const result = formatSessionEntry(entry);
      expect(result).not.toContain('[sandbox]');
    });

    test('formats session with epicId', () => {
      const entry = { ...baseEntry, epicId: 'EPIC-123' };
      const result = formatSessionEntry(entry);
      expect(result).toContain('epic:EPIC-123');
    });

    test('formats session with prdPath', () => {
      const entry = { ...baseEntry, prdPath: './tasks/prd.json' };
      const result = formatSessionEntry(entry);
      expect(result).toContain('prd:./tasks/prd.json');
    });

    test('formats session without index', () => {
      const result = formatSessionEntry(baseEntry);
      expect(result).not.toMatch(/^\d+\./);
      expect(result).toContain('⏸');
    });

    test('uses trackerPlugin when neither epicId nor prdPath present', () => {
      const result = formatSessionEntry(baseEntry);
      expect(result).toContain('beads');
      expect(result).not.toContain('epic:');
      expect(result).not.toContain('prd:');
    });

    test('formats with different indices', () => {
      const result1 = formatSessionEntry(baseEntry, 0);
      const result2 = formatSessionEntry(baseEntry, 5);
      const result3 = formatSessionEntry(baseEntry, 99);
      expect(result1).toContain('1.');
      expect(result2).toContain('6.');
      expect(result3).toContain('100.');
    });
  });

  describe('listSessions', () => {
    let logs: string[];
    let originalLog: typeof console.log;
    let listResumableSessionsSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      logs = [];
      originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
      listResumableSessionsSpy?.mockRestore();
    });

    test('shows message when no sessions found', async () => {
      listResumableSessionsSpy = spyOn(sessionModule, 'listResumableSessions').mockResolvedValue([]);

      await listSessions();

      const output = logs.join('\n');
      expect(output).toContain('No resumable sessions found');
      expect(output).toContain('ralph-tui run');
    });

    test('lists sessions with proper formatting', async () => {
      const mockSessions: SessionRegistryEntry[] = [
        {
          sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          cwd: '/home/user/project1',
          status: 'paused',
          startedAt: '2025-01-22T10:00:00Z',
          updatedAt: '2025-01-22T11:00:00Z',
          agentPlugin: 'claude',
          trackerPlugin: 'beads',
        },
        {
          sessionId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          cwd: '/home/user/project2',
          status: 'running',
          startedAt: '2025-01-22T12:00:00Z',
          updatedAt: '2025-01-22T13:00:00Z',
          agentPlugin: 'codex',
          trackerPlugin: 'json',
          prdPath: './prd.json',
        },
      ];

      listResumableSessionsSpy = spyOn(sessionModule, 'listResumableSessions').mockResolvedValue(mockSessions);

      await listSessions();

      const output = logs.join('\n');
      expect(output).toContain('Resumable sessions');
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('b2c3d4e5');
      expect(output).toContain('/home/user/project1');
      expect(output).toContain('/home/user/project2');
      expect(output).toContain('ralph-tui resume <session-id>');
    });
  });

  describe('cleanupRegistry', () => {
    let logs: string[];
    let originalLog: typeof console.log;
    let cleanupSpy: ReturnType<typeof spyOn>;
    let getRegistryFilePathSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      logs = [];
      originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      };
      getRegistryFilePathSpy = spyOn(sessionModule, 'getRegistryFilePath').mockReturnValue('/home/user/.config/ralph-tui/sessions.json');
    });

    afterEach(() => {
      console.log = originalLog;
      cleanupSpy?.mockRestore();
      getRegistryFilePathSpy?.mockRestore();
    });

    test('shows message when no stale entries found', async () => {
      cleanupSpy = spyOn(sessionModule, 'cleanupStaleRegistryEntries').mockResolvedValue(0);

      await cleanupRegistry();

      const output = logs.join('\n');
      expect(output).toContain('Cleaning up stale session registry entries');
      expect(output).toContain('No stale entries found');
      expect(output).toContain('/home/user/.config/ralph-tui/sessions.json');
    });

    test('shows message when one stale entry cleaned', async () => {
      cleanupSpy = spyOn(sessionModule, 'cleanupStaleRegistryEntries').mockResolvedValue(1);

      await cleanupRegistry();

      const output = logs.join('\n');
      expect(output).toContain('Removed 1 stale session from registry');
    });

    test('shows message when multiple stale entries cleaned', async () => {
      cleanupSpy = spyOn(sessionModule, 'cleanupStaleRegistryEntries').mockResolvedValue(5);

      await cleanupRegistry();

      const output = logs.join('\n');
      expect(output).toContain('Removed 5 stale sessions from registry');
    });
  });

  describe('resolveSession', () => {
    let errors: string[];
    let originalError: typeof console.error;
    let getSessionByIdSpy: ReturnType<typeof spyOn>;
    let findSessionsByPrefixSpy: ReturnType<typeof spyOn>;
    let hasPersistedSessionSpy: ReturnType<typeof spyOn>;
    let getSessionByCwdSpy: ReturnType<typeof spyOn>;
    let listResumableSessionsSpy: ReturnType<typeof spyOn>;

    const mockEntry: SessionRegistryEntry = {
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      cwd: '/home/user/project',
      status: 'paused',
      startedAt: '2025-01-22T10:00:00Z',
      updatedAt: '2025-01-22T11:00:00Z',
      agentPlugin: 'claude',
      trackerPlugin: 'beads',
    };

    beforeEach(() => {
      errors = [];
      originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.error = originalError;
      getSessionByIdSpy?.mockRestore();
      findSessionsByPrefixSpy?.mockRestore();
      hasPersistedSessionSpy?.mockRestore();
      getSessionByCwdSpy?.mockRestore();
      listResumableSessionsSpy?.mockRestore();
    });

    test('resolves session by exact ID match', async () => {
      getSessionByIdSpy = spyOn(sessionModule, 'getSessionById').mockResolvedValue(mockEntry);
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(true);

      const args: ResumeArgs = {
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        cwd: process.cwd(),
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).not.toBeNull();
      expect(result!.cwd).toBe('/home/user/project');
      expect(result!.registryEntry).toEqual(mockEntry);
    });

    test('resolves session by prefix match when single match', async () => {
      getSessionByIdSpy = spyOn(sessionModule, 'getSessionById').mockResolvedValue(null);
      findSessionsByPrefixSpy = spyOn(sessionModule, 'findSessionsByPrefix').mockResolvedValue([mockEntry]);
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(true);

      const args: ResumeArgs = {
        sessionId: 'a1b2c3d4',
        cwd: process.cwd(),
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).not.toBeNull();
      expect(result!.cwd).toBe('/home/user/project');
    });

    test('returns null when session found in registry but file is missing', async () => {
      getSessionByIdSpy = spyOn(sessionModule, 'getSessionById').mockResolvedValue(mockEntry);
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(false);

      const args: ResumeArgs = {
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        cwd: process.cwd(),
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).toBeNull();
      const output = errors.join('\n');
      expect(output).toContain("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(output).toContain('session file is missing');
      expect(output).toContain('--cleanup');
    });

    test('returns null when multiple sessions match prefix', async () => {
      const anotherEntry = { ...mockEntry, sessionId: 'a1b2c3d5-different', cwd: '/home/user/project2' };
      getSessionByIdSpy = spyOn(sessionModule, 'getSessionById').mockResolvedValue(null);
      findSessionsByPrefixSpy = spyOn(sessionModule, 'findSessionsByPrefix').mockResolvedValue([mockEntry, anotherEntry]);

      const args: ResumeArgs = {
        sessionId: 'a1b2c3d',
        cwd: process.cwd(),
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).toBeNull();
      const output = errors.join('\n');
      expect(output).toContain("Multiple sessions match prefix");
      expect(output).toContain('Please provide a more specific session ID');
    });

    test('returns null when session ID not found', async () => {
      getSessionByIdSpy = spyOn(sessionModule, 'getSessionById').mockResolvedValue(null);
      findSessionsByPrefixSpy = spyOn(sessionModule, 'findSessionsByPrefix').mockResolvedValue([]);

      const args: ResumeArgs = {
        sessionId: 'nonexistent',
        cwd: process.cwd(),
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).toBeNull();
      const output = errors.join('\n');
      expect(output).toContain("not found in registry");
    });

    test('resolves session from current directory when no session ID provided', async () => {
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(true);
      getSessionByCwdSpy = spyOn(sessionModule, 'getSessionByCwd').mockResolvedValue(mockEntry);

      const args: ResumeArgs = {
        cwd: '/home/user/project',
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).not.toBeNull();
      expect(result!.cwd).toBe('/home/user/project');
      expect(result!.registryEntry).toEqual(mockEntry);
    });

    test('returns null when session file exists but no registry entry', async () => {
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(true);
      getSessionByCwdSpy = spyOn(sessionModule, 'getSessionByCwd').mockResolvedValue(null);

      const args: ResumeArgs = {
        cwd: '/home/user/project',
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).not.toBeNull();
      expect(result!.cwd).toBe('/home/user/project');
      expect(result!.registryEntry).toBeUndefined();
    });

    test('returns null when registry entry exists but session file missing', async () => {
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(false);
      getSessionByCwdSpy = spyOn(sessionModule, 'getSessionByCwd').mockResolvedValue(mockEntry);

      const args: ResumeArgs = {
        cwd: '/home/user/project',
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).toBeNull();
      const output = errors.join('\n');
      expect(output).toContain('Session file not found');
      expect(output).toContain('--cleanup');
    });

    test('shows available sessions when no session in current directory', async () => {
      const otherSessions = [
        { ...mockEntry, cwd: '/home/user/other-project1' },
        { ...mockEntry, sessionId: 'b2c3d4e5-xxxx', cwd: '/home/user/other-project2' },
      ];
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(false);
      getSessionByCwdSpy = spyOn(sessionModule, 'getSessionByCwd').mockResolvedValue(null);
      listResumableSessionsSpy = spyOn(sessionModule, 'listResumableSessions').mockResolvedValue(otherSessions);

      const args: ResumeArgs = {
        cwd: '/home/user/current',
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).toBeNull();
      const output = errors.join('\n');
      expect(output).toContain('No session to resume');
      expect(output).toContain('Available sessions in other directories');
    });

    test('shows run suggestion when no sessions available anywhere', async () => {
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(false);
      getSessionByCwdSpy = spyOn(sessionModule, 'getSessionByCwd').mockResolvedValue(null);
      listResumableSessionsSpy = spyOn(sessionModule, 'listResumableSessions').mockResolvedValue([]);

      const args: ResumeArgs = {
        cwd: '/home/user/current',
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).toBeNull();
      const output = errors.join('\n');
      expect(output).toContain('ralph-tui run');
    });

    test('truncates session list to 3 entries with count', async () => {
      const manySessions = Array.from({ length: 5 }, (_, i) => ({
        ...mockEntry,
        sessionId: `session-${i}`,
        cwd: `/home/user/project-${i}`,
      }));
      hasPersistedSessionSpy = spyOn(sessionModule, 'hasPersistedSession').mockResolvedValue(false);
      getSessionByCwdSpy = spyOn(sessionModule, 'getSessionByCwd').mockResolvedValue(null);
      listResumableSessionsSpy = spyOn(sessionModule, 'listResumableSessions').mockResolvedValue(manySessions);

      const args: ResumeArgs = {
        cwd: '/home/user/current',
        headless: false,
        force: false,
        list: false,
        cleanup: false,
      };

      const result = await resolveSession(args);

      expect(result).toBeNull();
      const output = errors.join('\n');
      expect(output).toContain('... and 2 more');
    });
  });

  describe('printResumeHelp', () => {
    let logs: string[];
    let originalLog: typeof console.log;

    beforeEach(() => {
      logs = [];
      originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    test('does not throw', () => {
      expect(() => printResumeHelp()).not.toThrow();
    });

    test('outputs help text', () => {
      printResumeHelp();
      expect(logs.length).toBeGreaterThan(0);
      const output = logs.join('\n');
      expect(output).toContain('ralph-tui resume');
    });

    test('includes list option documentation', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('--list');
      expect(output).toContain('-l');
    });

    test('includes cleanup option documentation', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('--cleanup');
    });

    test('includes session-id argument documentation', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('session-id');
    });

    test('includes headless option', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('--headless');
    });

    test('includes force option', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('--force');
    });

    test('includes cwd option', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('--cwd');
    });

    test('includes usage examples', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('Examples:');
      expect(output).toContain('ralph-tui resume');
    });

    test('explains cross-directory resume', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('Cross-directory');
      expect(output).toContain('registry');
    });

    test('explains resumable states', () => {
      printResumeHelp();
      const output = logs.join('\n');
      expect(output).toContain('paused');
      expect(output).toContain('running');
      expect(output).toContain('interrupted');
    });
  });
});
