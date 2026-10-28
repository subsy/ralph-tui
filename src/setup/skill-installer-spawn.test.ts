/**
 * ABOUTME: Tests for installViaAddSkill subprocess spawning.
 * Uses mock.module to mock node:child_process spawn for unit testing.
 *
 * The mock is configured in beforeAll (not at module scope) to avoid polluting
 * other test files. The module under test is dynamically imported only once
 * the mock is in place, ensuring isolation.
 */

import { describe, test, expect, mock, beforeEach, beforeAll, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';

let mockSpawnArgs: Array<{ cmd: string; args: string[]; opts: unknown }> = [];
let mockSpawnExitCode: number | null = 0;
let mockSpawnStdout = '';
let mockSpawnStderr = '';
let mockSpawnError: Error | null = null;

function createMockChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setTimeout(() => {
    if (mockSpawnError) {
      proc.emit('error', mockSpawnError);
      return;
    }
    if (mockSpawnStdout) proc.stdout.emit('data', Buffer.from(mockSpawnStdout));
    if (mockSpawnStderr) proc.stderr.emit('data', Buffer.from(mockSpawnStderr));
    proc.emit('close', mockSpawnExitCode);
  }, 0);

  return proc;
}

// Declare the function type for the import
let installViaAddSkill: typeof import('./skill-installer.js').installViaAddSkill;

describe('installViaAddSkill', () => {
  beforeAll(async () => {
    // Apply mock BEFORE importing the module under test
    mock.module('node:child_process', () => ({
      spawn: (cmd: string, args: string[], opts: unknown) => {
        mockSpawnArgs.push({ cmd, args, opts });
        return createMockChildProcess();
      },
    }));

    // Use ?test-reload query string to force a fresh module import after mock setup.
    // Without this, Bun may return a cached module that was imported by other test files
    // before our mock was applied, causing the mock to not work in full test suite runs.
    // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
    const module = await import('./skill-installer.js?test-reload') as typeof import('./skill-installer.js');
    installViaAddSkill = module.installViaAddSkill;
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mockSpawnArgs = [];
    mockSpawnExitCode = 0;
    mockSpawnStdout = '';
    mockSpawnStderr = '';
    mockSpawnError = null;
  });

  test('returns success when add-skill exits with code 0', async () => {
    mockSpawnStdout = 'Installation complete\nFound 4 skills\n';
    mockSpawnExitCode = 0;

    const result = await installViaAddSkill({ agentId: 'claude', global: true });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Installation complete');
  });

  test('spawns bunx with correct args for agent install', async () => {
    mockSpawnExitCode = 0;

    await installViaAddSkill({ agentId: 'claude', global: true });

    expect(mockSpawnArgs[0].cmd).toBe('bunx');
    expect(mockSpawnArgs[0].args).toContain('add-skill');
    expect(mockSpawnArgs[0].args).toContain('subsy/ralph-tui');
    expect(mockSpawnArgs[0].args).toContain('-a');
    expect(mockSpawnArgs[0].args).toContain('claude-code');
    expect(mockSpawnArgs[0].args).toContain('-g');
    expect(mockSpawnArgs[0].args).toContain('-y');
  });

  test('spawns with stdio pipe', async () => {
    mockSpawnExitCode = 0;

    await installViaAddSkill({ agentId: 'claude' });

    const opts = mockSpawnArgs[0].opts as { stdio: string };
    expect(opts.stdio).toBe('pipe');
  });

  test('returns success for ELOOP-only failures', async () => {
    mockSpawnStdout = 'Installation complete\n';
    mockSpawnStderr = 'ELOOP: too many symbolic links encountered, mkdir\n';
    mockSpawnExitCode = 1;

    const result = await installViaAddSkill({ agentId: 'claude', global: true });

    expect(result.success).toBe(true);
    expect(result.output).toContain('ELOOP');
  });

  test('returns failure for non-ELOOP errors with non-zero exit', async () => {
    mockSpawnStderr = 'ENOENT: no such file or directory\n';
    mockSpawnExitCode = 1;

    const result = await installViaAddSkill({ agentId: 'claude', global: true });

    expect(result.success).toBe(false);
    expect(result.output).toContain('ENOENT');
  });

  test('returns failure for mixed ELOOP and ENOENT errors', async () => {
    mockSpawnStderr = 'ELOOP: too many symbolic links\nENOENT: not found\n';
    mockSpawnExitCode = 1;

    const result = await installViaAddSkill({ agentId: 'claude', global: true });

    expect(result.success).toBe(false);
  });

  test('returns failure when spawn emits error event', async () => {
    mockSpawnError = new Error('spawn bunx ENOENT');

    const result = await installViaAddSkill({ agentId: 'claude', global: true });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Failed to run add-skill');
    expect(result.output).toContain('spawn bunx ENOENT');
  });

  test('captures both stdout and stderr in output', async () => {
    mockSpawnStdout = 'stdout line\n';
    mockSpawnStderr = 'stderr line\n';
    mockSpawnExitCode = 0;

    const result = await installViaAddSkill({ agentId: 'claude', global: true });

    expect(result.output).toContain('stdout line');
    expect(result.output).toContain('stderr line');
  });

  test('passes skill name when specified', async () => {
    mockSpawnExitCode = 0;

    await installViaAddSkill({ agentId: 'claude', skillName: 'ralph-tui-prd', global: true });

    expect(mockSpawnArgs[0].args).toContain('-s');
    expect(mockSpawnArgs[0].args).toContain('ralph-tui-prd');
  });

  test('handles null exit code as failure', async () => {
    mockSpawnStderr = 'some error\n';
    mockSpawnExitCode = null;

    const result = await installViaAddSkill({ agentId: 'claude', global: true });

    expect(result.success).toBe(false);
    expect(result.output).toContain('some error');
  });
});
