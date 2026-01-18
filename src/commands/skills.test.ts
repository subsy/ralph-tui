/**
 * ABOUTME: Tests for the skills command CLI interface.
 * Tests the list and install subcommands for managing Claude Code skills.
 */

import { describe, expect, test, beforeEach, afterEach, spyOn, mock } from 'bun:test';

// Restore any mocks before tests run to prevent mock leakage
mock.restore();

// Import the command functions
import { executeSkillsCommand, printSkillsHelp } from './skills.js';
import { listBundledSkills } from '../setup/skill-installer.js';

describe('printSkillsHelp', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('prints help text', () => {
    printSkillsHelp();

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills');
    expect(output).toContain('list');
    expect(output).toContain('install');
  });

  test('includes install options in help', () => {
    printSkillsHelp();

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('--force');
    expect(output).toContain('--all');
  });

  test('includes examples in help', () => {
    printSkillsHelp();

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills list');
    expect(output).toContain('ralph-tui skills install');
  });
});

describe('executeSkillsCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('shows help when no subcommand given', async () => {
    await executeSkillsCommand([]);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills');
  });

  test('shows help with --help flag', async () => {
    await executeSkillsCommand(['--help']);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills');
  });

  test('shows help with -h flag', async () => {
    await executeSkillsCommand(['-h']);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills');
  });

  test('list subcommand shows help with --help', async () => {
    await executeSkillsCommand(['list', '--help']);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills');
  });

  test('install subcommand shows help with --help', async () => {
    await executeSkillsCommand(['install', '--help']);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills');
  });
});

describe('skills list command', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('lists bundled skills', async () => {
    await executeSkillsCommand(['list']);

    // Should have output
    expect(consoleSpy).toHaveBeenCalled();

    // Combine all log outputs
    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show "Bundled Skills" header
    expect(allOutput).toContain('Bundled Skills');
  });

  test('shows installation status', async () => {
    await executeSkillsCommand(['list']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show installed or not installed status
    expect(allOutput.includes('installed') || allOutput.includes('not installed')).toBe(true);
  });

  test('shows install location', async () => {
    await executeSkillsCommand(['list']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show install location
    expect(allOutput).toContain('.claude/skills');
  });
});

describe('skills install command', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('installs all skills by default', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show "Installing all bundled skills"
    expect(allOutput).toContain('Installing all bundled skills');
  });

  test('installs specific skill by name', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', 'ralph-tui-prd', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show installing specific skill
    expect(allOutput).toContain('ralph-tui-prd');
  });

  test('shows error for non-existent skill', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    // Mock process.exit to prevent test from exiting
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    try {
      await executeSkillsCommand(['install', 'non-existent-skill-xyz']);
    } catch {
      // Expected - process.exit throws
    }

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(errorOutput).toContain('not found');

    exitSpy.mockRestore();
  });

  test('accepts --force flag', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    // First install
    await executeSkillsCommand(['install', '--force']);

    // Second install with force should not skip
    consoleSpy.mockClear();
    await executeSkillsCommand(['install', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show "Installed" not "Skipped" for at least some skills
    expect(allOutput).toContain('Installed');
  });

  test('accepts -f shorthand for --force', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '-f']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show installation output
    expect(allOutput).toContain('Installing all bundled skills');
  });

  test('accepts --all flag explicitly', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--all', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show installing all
    expect(allOutput).toContain('Installing all bundled skills');
  });

  test('shows summary after installation', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show summary with counts
    expect(allOutput).toContain('Installed:');
  });
});
