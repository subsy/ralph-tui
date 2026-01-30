/**
 * ABOUTME: Tests for the skills install command subprocess integration.
 * Uses mock.module to mock node:child_process spawn for unit testing
 * the handleInstallSkills function via executeSkillsCommand.
 *
 * IMPORTANT: The mock is set up in beforeAll (not at module level) to prevent
 * polluting other test files. The module under test is dynamically imported
 * after the mock is applied.
 *
 * Uses the Fresh Import Pass-through Pattern to prevent mock pollution from
 * other test files (migration-install.test.ts, wizard.test.ts) that mock
 * skill-installer.js at module level.
 */

import { describe, test, expect, mock, beforeEach, beforeAll, afterEach, afterAll, spyOn } from 'bun:test';
import { EventEmitter } from 'node:events';

let mockSpawnArgs: Array<{ cmd: string; args: string[]; opts: unknown }> = [];
let mockSpawnExitCode = 0;
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
let executeSkillsCommand: typeof import('./skills.js').executeSkillsCommand;

describe('skills install command (spawn)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeAll(async () => {
    // CRITICAL: Get the REAL skill-installer module first, bypassing any cached mock
    // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
    const realSkillInstaller = await import('../setup/skill-installer.js?test-reload-install') as typeof import('../setup/skill-installer.js');

    // Mock skill-installer.js with pass-through to real functions
    // This ensures our tests get real behavior even if other test files mock this module
    mock.module('../setup/skill-installer.js', () => ({
      listBundledSkills: realSkillInstaller.listBundledSkills,
      isSkillInstalledAt: realSkillInstaller.isSkillInstalledAt,
      resolveSkillsPath: realSkillInstaller.resolveSkillsPath,
      installViaAddSkill: realSkillInstaller.installViaAddSkill,
      resolveAddSkillAgentId: realSkillInstaller.resolveAddSkillAgentId,
      buildAddSkillInstallArgs: realSkillInstaller.buildAddSkillInstallArgs,
      expandTilde: realSkillInstaller.expandTilde,
      computeSkillsPath: realSkillInstaller.computeSkillsPath,
      getBundledSkillsDir: realSkillInstaller.getBundledSkillsDir,
      isEloopOnlyFailure: realSkillInstaller.isEloopOnlyFailure,
      getSkillStatusForAgent: realSkillInstaller.getSkillStatusForAgent,
      AGENT_ID_MAP: realSkillInstaller.AGENT_ID_MAP,
    }));

    // Apply child_process mock BEFORE importing the module under test
    mock.module('node:child_process', () => ({
      spawn: (cmd: string, args: string[], opts: unknown) => {
        mockSpawnArgs.push({ cmd, args, opts });
        return createMockChildProcess();
      },
    }));

    // Import the skills module so it uses both our mocks
    // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
    const module = await import('./skills.js?test-reload-install') as typeof import('./skills.js');
    executeSkillsCommand = module.executeSkillsCommand;
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
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('shows success summary for clean install', async () => {
    mockSpawnStdout = 'Found 4 skills\nDetected 3 agents\nInstalling to: Claude Code, OpenCode, Codex\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('Installed 4 skills to 3 agents');
    expect(allOutput).toContain('Claude Code, OpenCode, Codex');
  });

  test('shows ELOOP note when only ELOOP errors present', async () => {
    mockSpawnStdout = 'Found 4 skills\nDetected 9 agents\nInstalling to: Amp, Claude Code\nInstallation complete\nFailed to install 36\n';
    mockSpawnStderr = 'ELOOP: too many symbolic links encountered\n';
    mockSpawnExitCode = 1;

    await executeSkillsCommand(['install']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('Installed 4 skills to 9 agents');
    expect(allOutput).toContain('symlinks');
  });

  test('shows failure message for non-ELOOP errors', async () => {
    mockSpawnStderr = 'ENOENT: no such file or directory\n';
    mockSpawnExitCode = 1;

    await executeSkillsCommand(['install']);

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(errorOutput).toContain('Installation failed');
  });

  test('shows no-output error when exit is non-zero with empty output', async () => {
    mockSpawnExitCode = 1;

    await executeSkillsCommand(['install']);

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(errorOutput).toContain('No output from add-skill');
    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('Run directly for details');
  });

  test('shows error when spawn fails entirely', async () => {
    mockSpawnError = new Error('spawn bunx ENOENT');

    await executeSkillsCommand(['install']);

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(errorOutput).toContain('Failed to run add-skill');
    expect(errorOutput).toContain('spawn bunx ENOENT');
    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('Ensure bun is installed');
  });

  test('spawns with correct default args (global, all skills, all agents)', async () => {
    mockSpawnStdout = 'Found 4 skills\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install']);

    expect(mockSpawnArgs[0].cmd).toBe('bunx');
    expect(mockSpawnArgs[0].args).toContain('add-skill');
    expect(mockSpawnArgs[0].args).toContain('-g');
    expect(mockSpawnArgs[0].args).toContain('-y');
    expect(mockSpawnArgs[0].args).not.toContain('-a');
    expect(mockSpawnArgs[0].args).not.toContain('-s');
  });

  test('passes agent flag when --agent specified', async () => {
    mockSpawnStdout = 'Found 4 skills\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install', '--agent', 'claude']);

    expect(mockSpawnArgs[0].args).toContain('-a');
    expect(mockSpawnArgs[0].args).toContain('claude-code');
  });

  test('passes skill flag when --skill specified', async () => {
    mockSpawnStdout = 'Found 1 skill\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install', '--skill', 'ralph-tui-prd']);

    expect(mockSpawnArgs[0].args).toContain('-s');
    expect(mockSpawnArgs[0].args).toContain('ralph-tui-prd');
  });

  test('uses local flag when --local specified', async () => {
    mockSpawnStdout = 'Found 4 skills\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install', '--local']);

    expect(mockSpawnArgs[0].args).not.toContain('-g');
  });

  test('shows verify hint after install', async () => {
    mockSpawnStdout = 'Found 4 skills\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('ralph-tui skills list');
  });

  test('shows installing message with skill and agent context', async () => {
    mockSpawnStdout = 'Found 1 skill\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install', '--agent', 'claude', '--skill', 'ralph-tui-prd']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('ralph-tui-prd');
    expect(allOutput).toContain('claude');
  });

  test('warns about unknown agent IDs passed through', async () => {
    mockSpawnStdout = 'Found 4 skills\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install', '--agent', 'unknown-agent']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain("Passing 'unknown-agent' directly");
  });

  test('handles single skill singular grammar', async () => {
    mockSpawnStdout = 'Found 1 skill\nDetected 1 agent\nInstalling to: Claude Code\nInstallation complete\n';
    mockSpawnExitCode = 0;

    await executeSkillsCommand(['install']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('Installed 1 skill to 1 agent');
  });
});
