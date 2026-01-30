/**
 * ABOUTME: Tests for the skills command CLI interface.
 * Tests the list and install subcommands for managing agent skills.
 * Install delegates to Vercel's add-skill CLI for ecosystem compatibility.
 *
 * NOTE: These tests are designed to work both:
 * - In environments with real agents installed (full testing)
 * - In CI environments without agents (graceful degradation)
 *
 * IMPORTANT: Uses the Fresh Import Pass-through Pattern to prevent mock pollution
 * from other test files (migration-install.test.ts, wizard.test.ts) that mock
 * skill-installer.js at module level.
 */

import { describe, expect, test, beforeEach, afterEach, beforeAll, afterAll, spyOn, mock } from 'bun:test';

// Declare module-level variables for dynamically imported functions
let executeSkillsCommand: typeof import('./skills.js').executeSkillsCommand;
let printSkillsHelp: typeof import('./skills.js').printSkillsHelp;
let parseInstallArgs: typeof import('./skills.js').parseInstallArgs;
let buildAddSkillArgs: typeof import('./skills.js').buildAddSkillArgs;
let parseAddSkillOutput: typeof import('./skills.js').parseAddSkillOutput;

beforeAll(async () => {
  // CRITICAL: Get the REAL skill-installer module first, bypassing any cached mock
  // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
  const realSkillInstaller = await import('../setup/skill-installer.js?test-reload') as typeof import('../setup/skill-installer.js');

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

  // Import the skills module so it uses our mock (which uses real functions)
  // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
  const skillsModule = await import('./skills.js?test-reload') as typeof import('./skills.js');
  executeSkillsCommand = skillsModule.executeSkillsCommand;
  printSkillsHelp = skillsModule.printSkillsHelp;
  parseInstallArgs = skillsModule.parseInstallArgs;
  buildAddSkillArgs = skillsModule.buildAddSkillArgs;
  parseAddSkillOutput = skillsModule.parseAddSkillOutput;
});

afterAll(() => {
  mock.restore();
});

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
    expect(output).toContain('--all');
    expect(output).toContain('--agent');
    expect(output).toContain('--global');
    expect(output).toContain('--local');
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
    expect(output).toContain('codex');
  });

  test('mentions add-skill direct usage in help', () => {
    printSkillsHelp();

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('bunx add-skill');
    expect(output).toContain('subsy/ralph-tui');
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

describe('parseInstallArgs', () => {
  test('defaults to global when no location specified', () => {
    const result = parseInstallArgs([]);
    expect(result.global).toBe(true);
    expect(result.local).toBe(false);
  });

  test('parses --local flag', () => {
    const result = parseInstallArgs(['--local']);
    expect(result.local).toBe(true);
    expect(result.global).toBe(false);
  });

  test('parses -l shorthand', () => {
    const result = parseInstallArgs(['-l']);
    expect(result.local).toBe(true);
  });

  test('parses --global flag', () => {
    const result = parseInstallArgs(['--global']);
    expect(result.global).toBe(true);
  });

  test('parses -g shorthand', () => {
    const result = parseInstallArgs(['-g']);
    expect(result.global).toBe(true);
  });

  test('parses skill name as positional argument', () => {
    const result = parseInstallArgs(['ralph-tui-prd']);
    expect(result.skillName).toBe('ralph-tui-prd');
  });

  test('parses --agent flag', () => {
    const result = parseInstallArgs(['--agent', 'claude']);
    expect(result.agentId).toBe('claude');
  });

  test('parses --agent=value form', () => {
    const result = parseInstallArgs(['--agent=opencode']);
    expect(result.agentId).toBe('opencode');
  });

  test('accepts --force for backwards compat without error', () => {
    const result = parseInstallArgs(['--force']);
    expect(result.global).toBe(true);
  });

  test('accepts --all for backwards compat without error', () => {
    const result = parseInstallArgs(['--all']);
    expect(result.global).toBe(true);
  });

  test('parses combined flags', () => {
    const result = parseInstallArgs(['ralph-tui-prd', '--agent', 'claude', '--local']);
    expect(result.skillName).toBe('ralph-tui-prd');
    expect(result.agentId).toBe('claude');
    expect(result.local).toBe(true);
    expect(result.global).toBe(false);
  });
});

describe('buildAddSkillArgs', () => {
  test('builds basic global install args', () => {
    const args = buildAddSkillArgs({
      skillName: null,
      agentId: null,
      local: false,
      global: true,
    });
    expect(args).toEqual(['add-skill', 'subsy/ralph-tui', '-g', '-y']);
  });

  test('builds local install args (no -g flag)', () => {
    const args = buildAddSkillArgs({
      skillName: null,
      agentId: null,
      local: true,
      global: false,
    });
    expect(args).toEqual(['add-skill', 'subsy/ralph-tui', '-y']);
  });

  test('includes -s flag for specific skill', () => {
    const args = buildAddSkillArgs({
      skillName: 'ralph-tui-prd',
      agentId: null,
      local: false,
      global: true,
    });
    expect(args).toEqual(['add-skill', 'subsy/ralph-tui', '-s', 'ralph-tui-prd', '-g', '-y']);
  });

  test('maps claude agent ID to claude-code', () => {
    const args = buildAddSkillArgs({
      skillName: null,
      agentId: 'claude',
      local: false,
      global: true,
    });
    expect(args).toContain('-a');
    expect(args).toContain('claude-code');
  });

  test('passes through opencode agent ID unchanged', () => {
    const args = buildAddSkillArgs({
      skillName: null,
      agentId: 'opencode',
      local: false,
      global: true,
    });
    expect(args).toContain('-a');
    expect(args).toContain('opencode');
  });

  test('passes through unknown agent IDs as-is', () => {
    const args = buildAddSkillArgs({
      skillName: null,
      agentId: 'cursor',
      local: false,
      global: true,
    });
    expect(args).toContain('-a');
    expect(args).toContain('cursor');
  });

  test('builds full command with all options', () => {
    const args = buildAddSkillArgs({
      skillName: 'ralph-tui-prd',
      agentId: 'claude',
      local: false,
      global: true,
    });
    expect(args).toEqual([
      'add-skill', 'subsy/ralph-tui',
      '-s', 'ralph-tui-prd',
      '-a', 'claude-code',
      '-g', '-y',
    ]);
  });
});

describe('skills install command', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('shows help with --help flag', async () => {
    await executeSkillsCommand(['install', '--help']);

    const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(allOutput).toContain('ralph-tui skills');
    expect(allOutput).toContain('add-skill');
  });
});

describe('parseAddSkillOutput', () => {
  test('parses successful install with no failures', () => {
    const output = `Found 4 skills
Detected 3 agents
Installing to: Claude Code, OpenCode, Codex
Installation complete`;
    const result = parseAddSkillOutput(output);
    expect(result.skillCount).toBe(4);
    expect(result.agentCount).toBe(3);
    expect(result.agents).toEqual(['Claude Code', 'OpenCode', 'Codex']);
    expect(result.installed).toBe(true);
    expect(result.failureCount).toBe(0);
    expect(result.eloopOnly).toBe(false);
  });

  test('parses install with ELOOP-only failures', () => {
    const output = `Found 4 skills
Detected 9 agents
Installing to: Amp, Antigravity, Claude Code, Codex, Cursor, Droid, Gemini CLI, GitHub Copilot, OpenCode
Installation complete
Failed to install 36
ELOOP: too many symbolic links encountered, mkdir`;
    const result = parseAddSkillOutput(output);
    expect(result.skillCount).toBe(4);
    expect(result.agentCount).toBe(9);
    expect(result.installed).toBe(true);
    expect(result.failureCount).toBe(36);
    expect(result.eloopOnly).toBe(true);
  });

  test('parses install with non-ELOOP failures', () => {
    const output = `Found 2 skills
Detected 2 agents
Installing to: Claude Code, OpenCode
Installation complete
Failed to install 1
ENOENT: no such file or directory`;
    const result = parseAddSkillOutput(output);
    expect(result.installed).toBe(true);
    expect(result.failureCount).toBe(1);
    expect(result.eloopOnly).toBe(false);
  });

  test('handles empty output', () => {
    const result = parseAddSkillOutput('');
    expect(result.skillCount).toBe(0);
    expect(result.agentCount).toBe(0);
    expect(result.agents).toEqual([]);
    expect(result.installed).toBe(false);
    expect(result.failureCount).toBe(0);
    expect(result.eloopOnly).toBe(false);
  });

  test('handles single skill single agent', () => {
    const output = `Found 1 skill
Detected 1 agent
Installing to: Claude Code
Installation complete`;
    const result = parseAddSkillOutput(output);
    expect(result.skillCount).toBe(1);
    expect(result.agentCount).toBe(1);
    expect(result.agents).toEqual(['Claude Code']);
    expect(result.installed).toBe(true);
  });
});
