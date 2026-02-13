/**
 * ABOUTME: Tests for iteration log persistence functions.
 * Tests building metadata, formatting/parsing headers, and saving/loading logs
 * with proper handling of sandbox configuration.
 *
 * NOTE: These tests should be run in isolation (`bun test tests/logs/persistence.test.ts`)
 * when verifying file I/O behavior, as they may fail when run with the full test suite
 * due to module mocking interference from other test files (e.g., execution-engine.test.ts
 * mocks the logs module globally).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildMetadata,
  saveIterationLog,
  loadIterationLog,
  getIterationsDir,
  generateLogFilename,
  __test__,
} from '../../src/logs/persistence.js';

const { formatMetadataHeader, parseMetadataHeader, formatDuration } = __test__;
import type { IterationResult } from '../../src/engine/types.js';
import type { SandboxConfig } from '../../src/config/types.js';

/**
 * Create a minimal IterationResult for testing
 */
function createTestIterationResult(overrides: Partial<IterationResult> = {}): IterationResult {
  return {
    iteration: 1,
    status: 'completed',
    task: {
      id: 'test-task-1',
      title: 'Test Task',
      status: 'in_progress',
      priority: 2,
    },
    taskCompleted: true,
    promiseComplete: false,
    durationMs: 5000,
    startedAt: '2024-01-15T10:00:00.000Z',
    endedAt: '2024-01-15T10:00:05.000Z',
    agentResult: {
      executionId: 'test-exec-1',
      status: 'completed',
      stdout: 'Test output',
      stderr: '',
      exitCode: 0,
      durationMs: 5000,
      interrupted: false,
      startedAt: '2024-01-15T10:00:00.000Z',
      endedAt: '2024-01-15T10:00:05.000Z',
    },
    ...overrides,
  };
}

describe('buildMetadata', () => {
  test('includes sandbox fields when sandbox config is provided', () => {
    const result = createTestIterationResult();
    const sandboxConfig: SandboxConfig = {
      enabled: true,
      mode: 'bwrap',
      network: false,
    };

    const metadata = buildMetadata(result, {
      config: {
        agent: { name: 'claude', plugin: 'claude', options: {} },
        model: 'claude-sonnet-4-20250514',
      },
      sandboxConfig,
      resolvedSandboxMode: 'bwrap',
    });

    expect(metadata.sandboxMode).toBe('bwrap');
    expect(metadata.resolvedSandboxMode).toBe('bwrap');
    expect(metadata.sandboxNetwork).toBe(false);
  });

  test('includes sandbox fields for auto mode with resolved value', () => {
    const result = createTestIterationResult();
    const sandboxConfig: SandboxConfig = {
      enabled: true,
      mode: 'auto',
      network: true,
    };

    const metadata = buildMetadata(result, {
      config: {},
      sandboxConfig,
      resolvedSandboxMode: 'sandbox-exec',
    });

    expect(metadata.sandboxMode).toBe('auto');
    expect(metadata.resolvedSandboxMode).toBe('sandbox-exec');
    expect(metadata.sandboxNetwork).toBe(true);
  });

  test('omits sandbox fields when sandbox config is not provided', () => {
    const result = createTestIterationResult();

    const metadata = buildMetadata(result, {
      config: {},
    });

    expect(metadata.sandboxMode).toBeUndefined();
    expect(metadata.resolvedSandboxMode).toBeUndefined();
    expect(metadata.sandboxNetwork).toBeUndefined();
  });

  test('includes agent and model from config', () => {
    const result = createTestIterationResult();

    const metadata = buildMetadata(result, {
      config: {
        agent: { name: 'claude', plugin: 'claude', options: {} },
        model: 'claude-sonnet-4-20250514',
      },
    });

    expect(metadata.agentPlugin).toBe('claude');
    expect(metadata.model).toBe('claude-sonnet-4-20250514');
  });

  test('handles old config-only signature for backward compatibility', () => {
    const result = createTestIterationResult();

    // Old signature: buildMetadata(result, config) where config is RalphConfig directly
    const metadata = buildMetadata(result, {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      model: 'claude-sonnet-4-20250514',
    } as any);

    expect(metadata.agentPlugin).toBe('claude');
    expect(metadata.model).toBe('claude-sonnet-4-20250514');
    // Sandbox fields should be undefined in old signature
    expect(metadata.sandboxMode).toBeUndefined();
  });

  test('includes epicId from config', () => {
    const result = createTestIterationResult();

    const metadata = buildMetadata(result, {
      config: {
        epicId: 'epic-123',
      },
    });

    expect(metadata.epicId).toBe('epic-123');
  });

  test('includes error from result', () => {
    const result = createTestIterationResult({
      error: 'Task failed due to timeout',
    });

    const metadata = buildMetadata(result, { config: {} });

    expect(metadata.error).toBe('Task failed due to timeout');
  });

  test('includes completionSummary when provided', () => {
    const result = createTestIterationResult();

    const metadata = buildMetadata(result, {
      config: {},
      completionSummary: 'Completed on fallback (opencode) due to rate limit',
    });

    expect(metadata.completionSummary).toBe('Completed on fallback (opencode) due to rate limit');
  });

  test('includes agentSwitches when provided', () => {
    const result = createTestIterationResult();

    const metadata = buildMetadata(result, {
      config: {},
      agentSwitches: [
        { from: 'claude', to: 'opencode', reason: 'fallback', at: '2024-01-15T10:01:00.000Z' },
        { from: 'opencode', to: 'claude', reason: 'primary', at: '2024-01-15T10:02:00.000Z' },
      ],
    });

    expect(metadata.agentSwitches).toHaveLength(2);
    expect(metadata.agentSwitches![0].from).toBe('claude');
    expect(metadata.agentSwitches![0].to).toBe('opencode');
    expect(metadata.agentSwitches![0].reason).toBe('fallback');
    expect(metadata.agentSwitches![1].reason).toBe('primary');
  });

  test('omits empty agentSwitches array', () => {
    const result = createTestIterationResult();

    const metadata = buildMetadata(result, {
      config: {},
      agentSwitches: [],
    });

    expect(metadata.agentSwitches).toBeUndefined();
  });

  test('includes task description from result', () => {
    const result = createTestIterationResult({
      task: {
        id: 'test-task-1',
        title: 'Test Task',
        description: 'This is a test task description',
        status: 'in_progress',
        priority: 2,
      },
    });

    const metadata = buildMetadata(result, { config: {} });

    expect(metadata.taskDescription).toBe('This is a test task description');
  });

  test('copies all basic fields from result', () => {
    const result = createTestIterationResult({
      iteration: 5,
      status: 'failed',
      taskCompleted: false,
      promiseComplete: true,
      durationMs: 12345,
      startedAt: '2024-01-15T10:00:00.000Z',
      endedAt: '2024-01-15T10:00:12.345Z',
    });

    const metadata = buildMetadata(result, { config: {} });

    expect(metadata.iteration).toBe(5);
    expect(metadata.status).toBe('failed');
    expect(metadata.taskCompleted).toBe(false);
    expect(metadata.promiseComplete).toBe(true);
    expect(metadata.durationMs).toBe(12345);
    expect(metadata.startedAt).toBe('2024-01-15T10:00:00.000Z');
    expect(metadata.endedAt).toBe('2024-01-15T10:00:12.345Z');
  });
});

describe('saveIterationLog and loadIterationLog', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('round-trips sandbox configuration', async () => {
    const result = createTestIterationResult();
    const sandboxConfig: SandboxConfig = {
      enabled: true,
      mode: 'bwrap',
      network: false,
    };

    const filePath = await saveIterationLog(
      tempDir,
      result,
      'Test stdout output',
      'Test stderr output',
      {
        config: {
          agent: { name: 'claude', plugin: 'claude', options: {} },
          model: 'claude-sonnet-4-20250514',
        },
        sandboxConfig,
        resolvedSandboxMode: 'bwrap',
      }
    );

    const loaded = await loadIterationLog(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.sandboxMode).toBe('bwrap');
    expect(loaded!.metadata.sandboxNetwork).toBe(false);
    expect(loaded!.metadata.agentPlugin).toBe('claude');
    expect(loaded!.metadata.model).toBe('claude-sonnet-4-20250514');
  });

  test('round-trips auto sandbox mode with resolved value', async () => {
    const result = createTestIterationResult();
    const sandboxConfig: SandboxConfig = {
      enabled: true,
      mode: 'auto',
      network: true,
    };

    const filePath = await saveIterationLog(
      tempDir,
      result,
      'Test output',
      '',
      {
        config: {},
        sandboxConfig,
        resolvedSandboxMode: 'sandbox-exec',
      }
    );

    const loaded = await loadIterationLog(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.sandboxMode).toBe('auto');
    expect(loaded!.metadata.resolvedSandboxMode).toBe('sandbox-exec');
    expect(loaded!.metadata.sandboxNetwork).toBe(true);
  });

  test('handles logs without sandbox config (backward compatibility)', async () => {
    const result = createTestIterationResult();

    const filePath = await saveIterationLog(
      tempDir,
      result,
      'Test output',
      '',
      {
        config: {
          agent: { name: 'opencode', plugin: 'opencode', options: {} },
        },
      }
    );

    const loaded = await loadIterationLog(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.sandboxMode).toBeUndefined();
    expect(loaded!.metadata.resolvedSandboxMode).toBeUndefined();
    expect(loaded!.metadata.sandboxNetwork).toBeUndefined();
    expect(loaded!.metadata.agentPlugin).toBe('opencode');
  });

  test('preserves stdout and stderr content', async () => {
    const result = createTestIterationResult();
    const stdout = 'Line 1\nLine 2\nLine 3';
    const stderr = 'Warning: something happened';

    const filePath = await saveIterationLog(
      tempDir,
      result,
      stdout,
      stderr,
      { config: {} }
    );

    const loaded = await loadIterationLog(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.stdout).toBe(stdout);
    expect(loaded!.stderr).toBe(stderr);
  });

  test('streams raw stdout/stderr from files when provided', async () => {
    const result = createTestIterationResult();
    const rawStdout = `${'x'.repeat(8192)}\n<promise>COMPLETE</promise>`;
    const rawStderr = 'Warning: stream test stderr';
    const rawStdoutFilePath = join(tempDir, 'stdout.raw');
    const rawStderrFilePath = join(tempDir, 'stderr.raw');

    await writeFile(rawStdoutFilePath, rawStdout, 'utf-8');
    await writeFile(rawStderrFilePath, rawStderr, 'utf-8');

    const filePath = await saveIterationLog(
      tempDir,
      result,
      '[truncated stdout]',
      '[truncated stderr]',
      {
        config: {},
        rawStdoutFilePath,
        rawStderrFilePath,
      }
    );

    const loaded = await loadIterationLog(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.stdout).toBe(rawStdout);
    expect(loaded!.stderr).toBe(rawStderr);
  });
});

describe('generateLogFilename', () => {
  describe('legacy format (no sessionId)', () => {
    test('generates filename with padded iteration number', () => {
      const filename = generateLogFilename(1, 'task-123');
      expect(filename).toBe('iteration-001-task-123.log');
    });

    test('handles iteration numbers over 100', () => {
      const filename = generateLogFilename(150, 'task-abc');
      expect(filename).toBe('iteration-150-task-abc.log');
    });

    test('sanitizes task IDs with special characters', () => {
      const filename = generateLogFilename(1, 'beads-123/subtask');
      expect(filename).toBe('iteration-001-beads-123-subtask.log');
    });
  });

  describe('new format (with sessionId)', () => {
    test('generates filename with sessionId, timestamp, and taskId', () => {
      const filename = generateLogFilename(
        1,
        'BEAD-001',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '2024-01-15T10:30:45.123Z'
      );
      expect(filename).toBe('a1b2c3d4_2024-01-15_10-30-45_BEAD-001.log');
    });

    test('uses first 8 chars of session ID', () => {
      const filename = generateLogFilename(
        1,
        'task-123',
        'abcdefgh-ijkl-mnop-qrst-uvwxyz123456',
        '2024-06-20T15:45:30.000Z'
      );
      expect(filename).toMatch(/^abcdefgh_/);
    });

    test('formats timestamp without milliseconds', () => {
      const filename = generateLogFilename(
        1,
        'task-123',
        'session-id',
        '2024-12-31T23:59:59.999Z'
      );
      // Note: local timezone may affect the exact time shown
      expect(filename).toMatch(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/);
    });

    test('sanitizes task IDs with special characters', () => {
      const filename = generateLogFilename(
        1,
        'beads-123/subtask:test',
        'a1b2c3d4-5678',
        '2024-01-15T10:00:00.000Z'
      );
      expect(filename).toMatch(/_beads-123-subtask-test\.log$/);
    });

    test('falls back to legacy format if sessionId missing', () => {
      const filename = generateLogFilename(1, 'task-123', undefined, '2024-01-15T10:00:00.000Z');
      expect(filename).toBe('iteration-001-task-123.log');
    });

    test('falls back to legacy format if startedAt missing', () => {
      const filename = generateLogFilename(1, 'task-123', 'session-id', undefined);
      expect(filename).toBe('iteration-001-task-123.log');
    });
  });
});

describe('formatDuration', () => {
  test('formats seconds only', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(45000)).toBe('45s');
  });

  test('formats minutes and seconds', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(125000)).toBe('2m 5s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  test('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3600000)).toBe('1h 0m 0s');
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
    expect(formatDuration(7325000)).toBe('2h 2m 5s');
  });
});

describe('formatMetadataHeader', () => {
  test('formats basic metadata', () => {
    const metadata = buildMetadata(createTestIterationResult(), { config: {} });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('# Iteration 1 Log');
    expect(header).toContain('**Task ID**: test-task-1');
    expect(header).toContain('**Task Title**: Test Task');
    expect(header).toContain('**Status**: completed');
    expect(header).toContain('**Task Completed**: Yes');
  });

  test('includes description when present', () => {
    const result = createTestIterationResult({
      task: {
        id: 'test-task-1',
        title: 'Test Task',
        description: 'A test description',
        status: 'in_progress',
        priority: 2,
      },
    });
    const metadata = buildMetadata(result, { config: {} });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Description**: A test description');
  });

  test('truncates long descriptions', () => {
    const longDesc = 'x'.repeat(250);
    const result = createTestIterationResult({
      task: {
        id: 'test-task-1',
        title: 'Test Task',
        description: longDesc,
        status: 'in_progress',
        priority: 2,
      },
    });
    const metadata = buildMetadata(result, { config: {} });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Description**: ' + 'x'.repeat(200) + '...');
  });

  test('includes error when present', () => {
    const result = createTestIterationResult({ error: 'Something went wrong' });
    const metadata = buildMetadata(result, { config: {} });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Error**: Something went wrong');
  });

  test('includes agent and model when present', () => {
    const metadata = buildMetadata(createTestIterationResult(), {
      config: {
        agent: { name: 'claude', plugin: 'claude', options: {} },
        model: 'claude-sonnet-4-20250514',
      },
    });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Agent**: claude');
    expect(header).toContain('**Model**: claude-sonnet-4-20250514');
  });

  test('includes epicId when present', () => {
    const metadata = buildMetadata(createTestIterationResult(), {
      config: { epicId: 'epic-123' },
    });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Epic**: epic-123');
  });

  test('includes sandbox configuration', () => {
    const metadata = buildMetadata(createTestIterationResult(), {
      config: {},
      sandboxConfig: { enabled: true, mode: 'bwrap', network: false },
      resolvedSandboxMode: 'bwrap',
    });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Sandbox Mode**: bwrap');
    expect(header).toContain('**Sandbox Network**: Disabled');
  });

  test('formats auto sandbox mode with resolved value', () => {
    const metadata = buildMetadata(createTestIterationResult(), {
      config: {},
      sandboxConfig: { enabled: true, mode: 'auto', network: true },
      resolvedSandboxMode: 'sandbox-exec',
    });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Sandbox Mode**: auto (sandbox-exec)');
    expect(header).toContain('**Sandbox Network**: Enabled');
  });

  test('includes completion summary when present', () => {
    const metadata = buildMetadata(createTestIterationResult(), {
      config: {},
      completionSummary: 'Completed successfully',
    });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('**Completion Summary**: Completed successfully');
  });

  test('includes agent switches section', () => {
    const metadata = buildMetadata(createTestIterationResult(), {
      config: {},
      agentSwitches: [
        { from: 'claude', to: 'opencode', reason: 'fallback', at: '2024-01-15T10:01:00.000Z' },
        { from: 'opencode', to: 'claude', reason: 'primary', at: '2024-01-15T10:02:00.000Z' },
      ],
    });
    const header = formatMetadataHeader(metadata);

    expect(header).toContain('## Agent Switches');
    expect(header).toContain('**Switched to fallback**: claude → opencode');
    expect(header).toContain('**Recovered to primary**: opencode → claude');
  });
});

describe('parseMetadataHeader', () => {
  test('round-trips metadata through format and parse', () => {
    const result = createTestIterationResult();
    const original = buildMetadata(result, {
      config: {
        agent: { name: 'claude', plugin: 'claude', options: {} },
        model: 'claude-sonnet-4-20250514',
      },
    });
    const header = formatMetadataHeader(original);
    const parsed = parseMetadataHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.iteration).toBe(original.iteration);
    expect(parsed!.taskId).toBe(original.taskId);
    expect(parsed!.taskTitle).toBe(original.taskTitle);
    expect(parsed!.status).toBe(original.status);
    expect(parsed!.taskCompleted).toBe(original.taskCompleted);
    expect(parsed!.agentPlugin).toBe(original.agentPlugin);
    expect(parsed!.model).toBe(original.model);
  });

  test('parses sandbox configuration', () => {
    const original = buildMetadata(createTestIterationResult(), {
      config: {},
      sandboxConfig: { enabled: true, mode: 'bwrap', network: false },
      resolvedSandboxMode: 'bwrap',
    });
    const header = formatMetadataHeader(original);
    const parsed = parseMetadataHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.sandboxMode).toBe('bwrap');
    expect(parsed!.sandboxNetwork).toBe(false);
  });

  test('parses auto sandbox mode with resolved value', () => {
    const original = buildMetadata(createTestIterationResult(), {
      config: {},
      sandboxConfig: { enabled: true, mode: 'auto', network: true },
      resolvedSandboxMode: 'sandbox-exec',
    });
    const header = formatMetadataHeader(original);
    const parsed = parseMetadataHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.sandboxMode).toBe('auto');
    expect(parsed!.resolvedSandboxMode).toBe('sandbox-exec');
    expect(parsed!.sandboxNetwork).toBe(true);
  });

  test('parses error field', () => {
    const original = buildMetadata(createTestIterationResult({ error: 'Test error' }), { config: {} });
    const header = formatMetadataHeader(original);
    const parsed = parseMetadataHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.error).toBe('Test error');
  });

  test('parses epicId', () => {
    const original = buildMetadata(createTestIterationResult(), {
      config: { epicId: 'epic-456' },
    });
    const header = formatMetadataHeader(original);
    const parsed = parseMetadataHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.epicId).toBe('epic-456');
  });

  test('returns null for invalid header', () => {
    const parsed = parseMetadataHeader('not a valid header');
    // Should return metadata with default values, not null
    expect(parsed).not.toBeNull();
    expect(parsed!.iteration).toBe(0);
  });
});

describe('getIterationsDir', () => {
  test('returns default directory when no custom dir specified', () => {
    const dir = getIterationsDir('/project');
    expect(dir).toBe('/project/.ralph-tui/iterations');
  });

  test('joins relative custom dir with cwd', () => {
    const dir = getIterationsDir('/project', 'custom/output');
    expect(dir).toBe('/project/custom/output');
  });

  test('uses absolute custom dir directly', () => {
    const dir = getIterationsDir('/project', '/absolute/path');
    expect(dir).toBe('/absolute/path');
  });
});

describe('listIterationLogs chronological sorting', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('sorts logs by startedAt timestamp, not by iteration number', async () => {
    // Simulate cross-session scenario:
    // Session 1: task ran at iteration 3 (older timestamp)
    // Session 2: same task ran at iteration 1 (newer timestamp)
    const { listIterationLogs } = await import('../../src/logs/persistence.js');

    // Create iteration 3 first (older, from "Session 1")
    const result1 = createTestIterationResult({
      iteration: 3,
      task: { id: 'test-task', title: 'Test Task', status: 'open', priority: 2 },
      startedAt: '2024-01-15T10:00:00.000Z',
      endedAt: '2024-01-15T10:00:05.000Z',
    });
    await saveIterationLog(tempDir, result1, 'Session 1 output', '');

    // Create iteration 1 second (newer, from "Session 2")
    const result2 = createTestIterationResult({
      iteration: 1,
      task: { id: 'test-task', title: 'Test Task', status: 'open', priority: 2 },
      startedAt: '2024-01-16T10:00:00.000Z', // One day later
      endedAt: '2024-01-16T10:00:05.000Z',
    });
    await saveIterationLog(tempDir, result2, 'Session 2 output', '');

    // List logs - should be sorted chronologically, not by iteration
    const logs = await listIterationLogs(tempDir);

    // Expect chronological order: oldest first (iteration 3), newest last (iteration 1)
    expect(logs.length).toBe(2);
    expect(logs[0].iteration).toBe(3); // Older (Session 1)
    expect(logs[1].iteration).toBe(1); // Newer (Session 2)

    // The "most recent" log (last in list) should be the one from Session 2
    const mostRecent = logs[logs.length - 1];
    expect(mostRecent.startedAt).toBe('2024-01-16T10:00:00.000Z');
  });

  test('getIterationLogsByTask returns logs sorted chronologically', async () => {
    const { getIterationLogsByTask } = await import('../../src/logs/persistence.js');

    // Create logs with different iteration numbers but different timestamps
    const result1 = createTestIterationResult({
      iteration: 5,
      task: { id: 'my-task', title: 'My Task', status: 'open', priority: 2 },
      startedAt: '2024-01-10T10:00:00.000Z',
      endedAt: '2024-01-10T10:00:05.000Z',
    });
    await saveIterationLog(tempDir, result1, 'Old output', '');

    const result2 = createTestIterationResult({
      iteration: 2,
      task: { id: 'my-task', title: 'My Task', status: 'open', priority: 2 },
      startedAt: '2024-01-20T10:00:00.000Z',
      endedAt: '2024-01-20T10:00:05.000Z',
    });
    await saveIterationLog(tempDir, result2, 'New output', '');

    // Get logs by task ID - should return chronologically ordered
    const logs = await getIterationLogsByTask(tempDir, 'my-task');

    expect(logs.length).toBe(2);
    // Most recent (last) should have the newer timestamp, even though iteration is lower
    expect(logs[logs.length - 1].stdout).toBe('New output');
    expect(logs[logs.length - 1].metadata.iteration).toBe(2);
  });
});
