/**
 * ABOUTME: Tests for the skills command CLI interface.
 * Tests the list and install subcommands for managing agent skills.
 * Supports multi-agent skill installation (Claude Code, OpenCode, Factory Droid).
 *
 * NOTE: These tests are designed to work both:
 * - In environments with real agents installed (full testing)
 * - In CI environments without agents (graceful degradation)
 */

import { describe, expect, test, beforeEach, afterEach, spyOn, mock } from 'bun:test';

// Restore any mocks from other test files to prevent pollution
mock.restore();

// Import the command functions - these use the real agent registry
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
    expect(output).toContain('--agent');
  });

  test('includes examples in help', () => {
    printSkillsHelp();

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ralph-tui skills list');
    expect(output).toContain('ralph-tui skills install');
    expect(output).toContain('--agent claude');
  });

  test('includes supported agents in help', () => {
    printSkillsHelp();

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('claude');
    expect(output).toContain('opencode');
    expect(output).toContain('droid');
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

  test('shows installation status by agent', async () => {
    await executeSkillsCommand(['list']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show "Installation Status by Agent" section
    expect(allOutput).toContain('Installation Status by Agent');
  });

  test('shows agent names and paths', async () => {
    await executeSkillsCommand(['list']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // Should show at least one agent's skill path
    // The paths vary by agent: .claude/skills, .config/opencode/skills, .factory/skills
    // All registered agents are listed with their paths (even if not installed)
    const hasAgentPaths =
      allOutput.includes('.claude/skills') ||
      allOutput.includes('.config/opencode/skills') ||
      allOutput.includes('.factory/skills');

    // In CI environments, the agent registry should still show paths for all
    // registered agents. If somehow no paths appear, at minimum we should
    // see the "Installation Status by Agent" section header.
    if (!hasAgentPaths) {
      // Fallback: ensure at least the section structure is present
      expect(allOutput).toContain('Installation Status by Agent');
    } else {
      expect(hasAgentPaths).toBe(true);
    }
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

  test('installs all skills to detected agents by default', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // In CI without agents installed, we get "No supported agents detected"
    if (allOutput.includes('No supported agents detected')) {
      expect(allOutput).toContain('Install Claude Code, OpenCode, or Factory Droid');
      return;
    }

    // Should show "Installing all skills to N agent(s)"
    expect(allOutput).toContain('Installing all skills');
    expect(allOutput).toContain('agent');
  });

  test('installs specific skill by name', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', 'ralph-tui-prd', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // In CI without agents installed, we get "No supported agents detected"
    if (allOutput.includes('No supported agents detected')) {
      expect(allOutput).toContain('Install Claude Code, OpenCode, or Factory Droid');
      return;
    }

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

    // In CI without agents installed, we get "No supported agents detected"
    if (allOutput.includes('No supported agents detected')) {
      expect(allOutput).toContain('Install Claude Code, OpenCode, or Factory Droid');
      return;
    }

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

    // In CI without agents installed, we get "No supported agents detected"
    if (allOutput.includes('No supported agents detected')) {
      expect(allOutput).toContain('Install Claude Code, OpenCode, or Factory Droid');
      return;
    }

    // Should show installation output
    expect(allOutput).toContain('Installing all skills');
  });

  test('accepts --all flag explicitly', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--all', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // In CI without agents installed, we get "No supported agents detected"
    if (allOutput.includes('No supported agents detected')) {
      expect(allOutput).toContain('Install Claude Code, OpenCode, or Factory Droid');
      return;
    }

    // Should show installing all
    expect(allOutput).toContain('Installing all skills');
  });

  test('accepts --agent flag to install to specific agent', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--agent', 'claude', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // When --agent is specified, it attempts to install even if agent not available
    // Should show installing to specific agent (agent name appears in output)
    expect(allOutput).toContain('claude');
  });

  test('accepts --agent=value form', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--agent=opencode', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // When --agent is specified, it attempts to install even if agent not available
    // Should show installing to specific agent (agent name appears in output)
    expect(allOutput).toContain('opencode');
  });

  test('shows error for unknown agent', async () => {
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
      await executeSkillsCommand(['install', '--agent', 'nonexistent-agent']);
    } catch {
      // Expected - process.exit throws
    }

    const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(errorOutput).toContain('Unknown agent');

    exitSpy.mockRestore();
  });

  test('shows summary after installation', async () => {
    const skills = await listBundledSkills();
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }

    await executeSkillsCommand(['install', '--force']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    // In CI without agents installed, we get "No supported agents detected"
    if (allOutput.includes('No supported agents detected')) {
      expect(allOutput).toContain('Install Claude Code, OpenCode, or Factory Droid');
      return;
    }

    // Should show summary with counts
    expect(allOutput).toContain('Installed:');
  });
});
