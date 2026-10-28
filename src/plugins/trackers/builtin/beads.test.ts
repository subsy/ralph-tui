/**
 * ABOUTME: Tests for the Beads tracker plugin, focusing on task completion and PRD context.
 * Uses Bun's mock.module to mock child_process.spawn and fs/promises.
 *
 * The mock is configured in beforeAll (not at module scope) to avoid polluting
 * other test files. The module under test is dynamically imported only once
 * the mock is in place, ensuring isolation.
 */

import { describe, test, expect, mock, beforeEach, beforeAll, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';

// Create a mock spawn function that we can control
let mockSpawnArgs: string[][] = [];
let mockSpawnExitCode = 0;
let mockSpawnStdout = '';
let mockSpawnStderr = '';

// Track spawn call responses for multi-call scenarios
let mockSpawnResponses: Array<{ stdout: string; stderr: string; exitCode: number }> = [];
let mockSpawnCallIndex = 0;

// Mock for fs/promises readFile
let mockReadFileContent = '';
let mockReadFileShouldFail = false;

function createMockChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  // Get response for this call (use indexed responses if available, else global)
  const response = mockSpawnResponses[mockSpawnCallIndex] ?? {
    stdout: mockSpawnStdout,
    stderr: mockSpawnStderr,
    exitCode: mockSpawnExitCode,
  };
  mockSpawnCallIndex++;

  // Emit data and close asynchronously
  setTimeout(() => {
    if (response.stdout) {
      proc.stdout.emit('data', Buffer.from(response.stdout));
    }
    if (response.stderr) {
      proc.stderr.emit('data', Buffer.from(response.stderr));
    }
    proc.emit('close', response.exitCode);
  }, 0);

  return proc;
}

// Declare the class type for the import
let BeadsTrackerPlugin: typeof import('./beads/index.js').BeadsTrackerPlugin;

describe('BeadsTrackerPlugin', () => {
  beforeAll(async () => {
    // Mock the child_process module before importing beads
    mock.module('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        mockSpawnArgs.push(args);
        return createMockChildProcess();
      },
    }));

    // Mock node:fs for access (used by detect)
    mock.module('node:fs', () => ({
      access: (_path: string, _mode: number, callback: (err: Error | null) => void) => {
        // Always succeed for test purposes
        callback(null);
      },
      constants: {
        R_OK: 4,
        W_OK: 2,
        X_OK: 1,
        F_OK: 0,
      },
      readFileSync: (path: string) => {
        // Return empty template for template loading
        if (path.endsWith('template.hbs')) {
          return '{{taskTitle}}';
        }
        return '';
      },
    }));

    // Mock fs/promises for readFile
    mock.module('node:fs/promises', () => ({
      readFile: async () => {
        if (mockReadFileShouldFail) {
          throw new Error('ENOENT: no such file or directory');
        }
        return mockReadFileContent;
      },
    }));

    // Import after mocking
    const module = await import('./beads/index.js');
    BeadsTrackerPlugin = module.BeadsTrackerPlugin;
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    // Reset mock state before each test
    mockSpawnArgs = [];
    mockSpawnExitCode = 0;
    mockSpawnStdout = '';
    mockSpawnStderr = '';
    mockSpawnResponses = [];
    mockSpawnCallIndex = 0;
    mockReadFileContent = '';
    mockReadFileShouldFail = false;
  });

  // Helper to create and initialize a plugin
  async function createPlugin(config: Record<string, unknown> = {}) {
    const plugin = new BeadsTrackerPlugin();
    await plugin.initialize({ workingDir: '/test', ...config });
    return plugin;
  }

  describe('getTasks', () => {
    test('uses --limit 0 to bypass default 50 result limit', async () => {
      // The --limit 0 flag is critical to bypass bd's default limit of 50 results.
      // Without it, epics with more than 50 tasks would have tasks truncated.
      // See: https://github.com/subsy/ralph-tui/issues/233
      mockSpawnStdout = '[]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      mockSpawnArgs = []; // Reset after initialize
      await plugin.getTasks();

      expect(mockSpawnArgs.length).toBeGreaterThanOrEqual(1);
      const listCall = mockSpawnArgs.find((args) => args.includes('list'));
      expect(listCall).toBeDefined();
      expect(listCall).toContain('--limit');
      expect(listCall).toContain('0');
    });
  });

  describe('getEpics', () => {
    test('uses --limit 0 to bypass default 50 result limit', async () => {
      // The --limit 0 flag is critical to bypass bd's default limit of 50 results.
      // See: https://github.com/subsy/ralph-tui/issues/233
      mockSpawnStdout = '[]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      mockSpawnArgs = []; // Reset after initialize
      await plugin.getEpics();

      expect(mockSpawnArgs.length).toBeGreaterThanOrEqual(1);
      const listCall = mockSpawnArgs.find((args) => args.includes('list'));
      expect(listCall).toBeDefined();
      expect(listCall).toContain('--type');
      expect(listCall).toContain('epic');
      expect(listCall).toContain('--limit');
      expect(listCall).toContain('0');
    });
  });

  describe('completeTask', () => {
    test('uses bd close command with --force flag', async () => {
      // Return valid array format for both close (ignored) and getTask calls
      mockSpawnStdout = '[{"id": "test-001", "title": "Test", "status": "closed", "priority": 2}]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      await plugin.completeTask('test-001', 'Task completed');

      // Find the close command call (there may be multiple calls for getTask)
      const closeCall = mockSpawnArgs.find((args) => args.includes('close'));
      expect(closeCall).toBeDefined();
      expect(closeCall).toContain('close');
      expect(closeCall).toContain('test-001');
      expect(closeCall).toContain('--force');
      expect(closeCall).toContain('--reason');
      expect(closeCall).toContain('Task completed');
    });

    test('includes --force flag even without reason', async () => {
      // Return valid array format for both close (ignored) and getTask calls
      mockSpawnStdout = '[{"id": "test-002", "title": "Test", "status": "closed", "priority": 2}]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      await plugin.completeTask('test-002');

      const closeCall = mockSpawnArgs.find((args) => args.includes('close'));
      expect(closeCall).toBeDefined();
      expect(closeCall).toContain('--force');
      // Verify --reason is NOT present when no reason provided
      expect(closeCall).not.toContain('--reason');
    });

    test('returns success result on successful close', async () => {
      // Return valid JSON for both close and subsequent getTask calls
      mockSpawnStdout = '[{"id": "test-003", "title": "Test Task", "status": "closed", "priority": 2}]';
      mockSpawnExitCode = 0;

      const plugin = await createPlugin();
      const result = await plugin.completeTask('test-003', 'Done');

      expect(result.success).toBe(true);
      expect(result.message).toContain('test-003');
      expect(result.message).toContain('closed successfully');
    });

    test('returns failure result on command error', async () => {
      mockSpawnStdout = '';
      mockSpawnStderr = 'Error: task not found';
      mockSpawnExitCode = 1;

      const plugin = await createPlugin();
      const result = await plugin.completeTask('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to close');
      expect(result.error).toContain('task not found');
    });
  });

  describe('getPrdContext', () => {
    test('returns null when no epicId is set', async () => {
      const plugin = await createPlugin();
      // Don't set epicId
      const result = await plugin.getPrdContext();
      expect(result).toBeNull();
    });

    test('returns null when epic has no external_ref', async () => {
      // bd show returns epic without external_ref
      mockSpawnResponses = [
        { stdout: 'bd version 1.0.0', stderr: '', exitCode: 0 }, // detect() - bd --version
        { stdout: '[{"id": "epic-001", "title": "Test Epic", "status": "open", "priority": 1}]', stderr: '', exitCode: 0 }, // bd show
      ];

      const plugin = await createPlugin({ epicId: 'epic-001' });
      const result = await plugin.getPrdContext();
      expect(result).toBeNull();
    });

    test('returns null when external_ref does not start with prd:', async () => {
      // bd show returns epic with non-prd external_ref
      mockSpawnResponses = [
        { stdout: 'bd version 1.0.0', stderr: '', exitCode: 0 }, // detect() - bd --version
        { stdout: '[{"id": "epic-001", "title": "Test Epic", "status": "open", "priority": 1, "external_ref": "jira:PROJ-123"}]', stderr: '', exitCode: 0 }, // bd show
      ];

      const plugin = await createPlugin({ epicId: 'epic-001' });
      const result = await plugin.getPrdContext();
      expect(result).toBeNull();
    });

    test('returns PRD content when epic has valid prd: external_ref', async () => {
      // initialize() calls detect() which calls bd --version
      // Then getPrdContext() calls bd show and bd list
      mockSpawnResponses = [
        { stdout: 'bd version 1.0.0', stderr: '', exitCode: 0 }, // detect() - bd --version
        { stdout: '[{"id": "epic-001", "title": "Test Epic", "description": "Epic description", "status": "open", "priority": 1, "external_ref": "prd:./tasks/test.md"}]', stderr: '', exitCode: 0 }, // bd show
        { stdout: '[{"id": "epic-001.1", "status": "closed"}, {"id": "epic-001.2", "status": "open"}, {"id": "epic-001.3", "status": "cancelled"}]', stderr: '', exitCode: 0 }, // bd list
      ];
      mockReadFileContent = '# PRD Content\n\nThis is the PRD content.';

      const plugin = await createPlugin({ epicId: 'epic-001' });
      const result = await plugin.getPrdContext();

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test Epic');
      expect(result!.description).toBe('Epic description');
      expect(result!.content).toBe('# PRD Content\n\nThis is the PRD content.');
      expect(result!.completedCount).toBe(2); // closed + cancelled
      expect(result!.totalCount).toBe(3);
    });

    test('returns null when PRD file cannot be read', async () => {
      mockSpawnResponses = [
        { stdout: 'bd version 1.0.0', stderr: '', exitCode: 0 }, // detect() - bd --version
        { stdout: '[{"id": "epic-001", "title": "Test Epic", "status": "open", "priority": 1, "external_ref": "prd:./nonexistent.md"}]', stderr: '', exitCode: 0 }, // bd show
      ];
      mockReadFileShouldFail = true;

      const plugin = await createPlugin({ epicId: 'epic-001' });
      const result = await plugin.getPrdContext();
      expect(result).toBeNull();
    });

    test('returns null when bd show fails', async () => {
      mockSpawnResponses = [
        { stdout: 'bd version 1.0.0', stderr: '', exitCode: 0 }, // detect() - bd --version
        { stdout: '', stderr: 'Error: epic not found', exitCode: 1 }, // bd show fails
      ];

      const plugin = await createPlugin({ epicId: 'nonexistent-epic' });
      const result = await plugin.getPrdContext();
      expect(result).toBeNull();
    });

    test('handles absolute prd path', async () => {
      mockSpawnResponses = [
        { stdout: 'bd version 1.0.0', stderr: '', exitCode: 0 }, // detect() - bd --version
        { stdout: '[{"id": "epic-001", "title": "Test Epic", "status": "open", "priority": 1, "external_ref": "prd:/absolute/path/to/prd.md"}]', stderr: '', exitCode: 0 }, // bd show
        { stdout: '[]', stderr: '', exitCode: 0 }, // bd list - No children
      ];
      mockReadFileContent = 'Absolute path PRD content';

      const plugin = await createPlugin({ epicId: 'epic-001' });
      const result = await plugin.getPrdContext();

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Absolute path PRD content');
      expect(result!.completedCount).toBe(0);
      expect(result!.totalCount).toBe(0);
    });
  });
});
