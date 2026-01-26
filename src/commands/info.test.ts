/**
 * ABOUTME: Tests for the system info command.
 * Tests the collection and formatting of system diagnostic information.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectSystemInfo,
  formatSystemInfo,
  formatForBugReport,
  parseCwdArg,
  computePackageJsonPath,
  type SystemInfo,
} from './info.js';

// Helper to create a temp directory for each test
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-info-test-'));
}

// Helper to write a TOML config file
async function writeConfig(dir: string, config: Record<string, unknown>): Promise<void> {
  const configDir = join(dir, '.ralph-tui');
  await mkdir(configDir, { recursive: true });

  const lines: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      lines.push(`${key} = "${value}"`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key} = ${value}`);
    }
  }

  await writeFile(join(configDir, 'config.toml'), lines.join('\n'), 'utf-8');
}

describe('collectSystemInfo', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('collects basic system info', async () => {
    await writeConfig(tempDir, {
      agent: 'claude',
      tracker: 'beads',
    });

    const info = await collectSystemInfo(tempDir);

    // Check structure
    expect(info).toHaveProperty('version');
    expect(info).toHaveProperty('runtime');
    expect(info).toHaveProperty('os');
    expect(info).toHaveProperty('config');
    expect(info).toHaveProperty('templates');
    expect(info).toHaveProperty('agent');
    expect(info).toHaveProperty('tracker');
    expect(info).toHaveProperty('skills');
  });

  test('collects skills info', async () => {
    await writeConfig(tempDir, {
      agent: 'claude',
    });

    const info = await collectSystemInfo(tempDir);

    // Check skills structure
    expect(info.skills).toHaveProperty('bundled');
    expect(info.skills).toHaveProperty('customDir');
    expect(info.skills).toHaveProperty('customSkills');
    expect(info.skills).toHaveProperty('agents');
    expect(Array.isArray(info.skills.bundled)).toBe(true);
    expect(Array.isArray(info.skills.agents)).toBe(true);
  });

  test('detects runtime correctly', async () => {
    await writeConfig(tempDir, { agent: 'claude' });

    const info = await collectSystemInfo(tempDir);

    // We're running in Bun
    expect(info.runtime.name).toBe('bun');
    expect(info.runtime.version).toBeTruthy();
  });

  test('collects OS info', async () => {
    await writeConfig(tempDir, { agent: 'claude' });

    const info = await collectSystemInfo(tempDir);

    expect(info.os.platform).toBeTruthy();
    expect(info.os.release).toBeTruthy();
    expect(info.os.arch).toBeTruthy();
  });

  test('detects project config', async () => {
    await writeConfig(tempDir, { agent: 'claude' });

    const info = await collectSystemInfo(tempDir);

    expect(info.config.projectPath).toBe(join(tempDir, '.ralph-tui', 'config.toml'));
    expect(info.config.projectExists).toBe(true);
  });

  test('handles missing project config', async () => {
    // Don't create any config
    const info = await collectSystemInfo(tempDir);

    expect(info.config.projectExists).toBe(false);
  });

  test('uses configured agent name', async () => {
    await writeConfig(tempDir, { agent: 'opencode' });

    const info = await collectSystemInfo(tempDir);

    expect(info.agent.name).toBe('opencode');
  });

  test('uses configured tracker name', async () => {
    await writeConfig(tempDir, { tracker: 'json' });

    const info = await collectSystemInfo(tempDir);

    expect(info.tracker.name).toBe('json');
  });

  test('defaults to claude agent when not configured', async () => {
    await writeConfig(tempDir, {});

    const info = await collectSystemInfo(tempDir);

    expect(info.agent.name).toBe('claude');
  });

  test('defaults to beads tracker when not configured', async () => {
    await writeConfig(tempDir, {});

    const info = await collectSystemInfo(tempDir);

    expect(info.tracker.name).toBe('beads');
  });

  test('uses agent from [[agents]] array with default=true', async () => {
    // Create config with agents array instead of shorthand
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.toml'),
      `
tracker = "beads"

[[agents]]
name = "custom-claude"
plugin = "claude"
default = true
`,
      'utf-8'
    );

    const info = await collectSystemInfo(tempDir);

    expect(info.agent.name).toBe('custom-claude');
  });

  test('includes command from agent config when configured', async () => {
    // Create config with agent that has a custom command
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.toml'),
      `
tracker = "beads"

[[agents]]
name = "claude-glm"
plugin = "claude"
default = true
command = "claude-glm"
`,
      'utf-8'
    );

    const info = await collectSystemInfo(tempDir);

    expect(info.agent.name).toBe('claude-glm');
    expect(info.agent.command).toBe('claude-glm');
  });

  test('command is undefined when not configured', async () => {
    await writeConfig(tempDir, { agent: 'claude' });

    const info = await collectSystemInfo(tempDir);

    expect(info.agent.command).toBeUndefined();
  });
});

describe('formatSystemInfo', () => {
  const mockInfo: SystemInfo = {
    version: '0.2.1',
    runtime: {
      name: 'bun',
      version: '1.3.5',
    },
    os: {
      platform: 'linux',
      release: '6.0.0',
      arch: 'x64',
    },
    config: {
      globalPath: '/home/user/.config/ralph-tui/config.toml',
      globalExists: true,
      projectPath: '/project/.ralph-tui/config.toml',
      projectExists: true,
    },
    templates: {
      globalDir: '/home/user/.config/ralph-tui/templates',
      installed: ['default.hbs', 'beads.hbs'],
    },
    agent: {
      name: 'claude',
      available: true,
      version: '2.1.0',
    },
    tracker: {
      name: 'beads',
    },
    skills: {
      bundled: ['ralph-tui-prd', 'ralph-tui-create-beads'],
      customDir: null,
      customSkills: [],
      agents: [
        {
          id: 'claude',
          name: 'Claude Code',
          available: true,
          personalDir: '/home/user/.claude/skills',
          repoDir: '.claude/skills',
          personalSkills: ['ralph-tui-prd'],
        },
      ],
    },
    envExclusion: {
      blocked: [],
      allowed: [],
    },
  };

  test('includes version info', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('ralph-tui version: 0.2.1');
    expect(output).toContain('Runtime: bun 1.3.5');
  });

  test('includes OS info', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('OS: linux 6.0.0 (x64)');
  });

  test('includes config paths', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('Global config: /home/user/.config/ralph-tui/config.toml');
    expect(output).toContain('Project config: /project/.ralph-tui/config.toml');
  });

  test('shows config existence status', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('Exists: yes');
  });

  test('includes templates info', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('Installed: default.hbs, beads.hbs');
  });

  test('includes agent info', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('Configured: claude');
    expect(output).toContain('Available: yes');
    expect(output).toContain('Version: 2.1.0');
  });

  test('includes tracker info', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('Configured: beads');
  });

  test('includes skills info', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('Skills:');
    expect(output).toContain('Bundled: ralph-tui-prd, ralph-tui-create-beads');
    expect(output).toContain('Claude Code:');
    expect(output).toContain('Path: /home/user/.claude/skills');
    expect(output).toContain('Installed: ralph-tui-prd');
  });

  test('shows no project config when missing', () => {
    const infoWithoutProject: SystemInfo = {
      ...mockInfo,
      config: {
        ...mockInfo.config,
        projectPath: null,
        projectExists: false,
      },
    };

    const output = formatSystemInfo(infoWithoutProject);

    expect(output).toContain('Project config: (none found)');
  });

  test('shows no templates when none installed', () => {
    const infoWithoutTemplates: SystemInfo = {
      ...mockInfo,
      templates: {
        ...mockInfo.templates,
        installed: [],
      },
    };

    const output = formatSystemInfo(infoWithoutTemplates);

    expect(output).toContain('Installed: (none)');
  });

  test('shows agent error when present', () => {
    const infoWithError: SystemInfo = {
      ...mockInfo,
      agent: {
        name: 'claude',
        available: false,
        error: 'Command not found',
      },
    };

    const output = formatSystemInfo(infoWithError);

    expect(output).toContain('Available: no');
    expect(output).toContain('Error: Command not found');
  });

  test('shows custom command when configured', () => {
    const infoWithCommand: SystemInfo = {
      ...mockInfo,
      agent: {
        name: 'claude-custom',
        command: 'claude-glm',
        available: true,
        version: '2.1.0',
      },
    };

    const output = formatSystemInfo(infoWithCommand);

    expect(output).toContain('Configured: claude-custom');
    expect(output).toContain('Command: claude-glm');
    expect(output).toContain('Available: yes');
  });

  test('does not show command line when command is not configured', () => {
    const output = formatSystemInfo(mockInfo);

    // mockInfo doesn't have a command, so "Command:" should not appear
    expect(output).not.toContain('Command:');
  });

  test('shows env filter message even when no vars match', () => {
    const output = formatSystemInfo(mockInfo);

    expect(output).toContain('Env filter:');
    expect(output).toContain('no vars matched exclusion patterns');
  });

  test('shows blocked env vars when present', () => {
    const infoWithBlocked: SystemInfo = {
      ...mockInfo,
      envExclusion: {
        blocked: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
        allowed: [],
      },
    };

    const output = formatSystemInfo(infoWithBlocked);

    expect(output).toContain('Env filter:');
    expect(output).toContain('Blocked:');
    expect(output).toContain('ANTHROPIC_API_KEY');
  });

  test('shows passthrough env vars when present', () => {
    const infoWithPassthrough: SystemInfo = {
      ...mockInfo,
      envExclusion: {
        blocked: ['OPENAI_API_KEY'],
        allowed: ['ANTHROPIC_API_KEY'],
      },
    };

    const output = formatSystemInfo(infoWithPassthrough);

    expect(output).toContain('Env filter:');
    expect(output).toContain('Passthrough:');
    expect(output).toContain('ANTHROPIC_API_KEY');
    expect(output).toContain('Blocked:');
    expect(output).toContain('OPENAI_API_KEY');
  });
});

describe('formatForBugReport', () => {
  const mockInfo: SystemInfo = {
    version: '0.2.1',
    runtime: {
      name: 'bun',
      version: '1.3.5',
    },
    os: {
      platform: 'linux',
      release: '6.0.0',
      arch: 'x64',
    },
    config: {
      globalPath: '/home/user/.config/ralph-tui/config.toml',
      globalExists: true,
      projectPath: '/project/.ralph-tui/config.toml',
      projectExists: true,
    },
    templates: {
      globalDir: '/home/user/.config/ralph-tui/templates',
      installed: ['default.hbs', 'beads.hbs'],
    },
    agent: {
      name: 'claude',
      available: true,
      version: '2.1.0',
    },
    tracker: {
      name: 'beads',
    },
    skills: {
      bundled: ['ralph-tui-prd', 'ralph-tui-create-beads'],
      customDir: null,
      customSkills: [],
      agents: [
        {
          id: 'claude',
          name: 'Claude Code',
          available: true,
          personalDir: '/home/user/.claude/skills',
          repoDir: '.claude/skills',
          personalSkills: ['ralph-tui-prd'],
        },
      ],
    },
    envExclusion: {
      blocked: [],
      allowed: [],
    },
  };

  test('wraps output in code block', () => {
    const output = formatForBugReport(mockInfo);

    expect(output.startsWith('```')).toBe(true);
    expect(output.endsWith('```')).toBe(true);
  });

  test('includes key-value pairs', () => {
    const output = formatForBugReport(mockInfo);

    expect(output).toContain('ralph-tui: 0.2.1');
    expect(output).toContain('runtime: bun 1.3.5');
    expect(output).toContain('os: linux 6.0.0 (x64)');
    expect(output).toContain('agent: claude v2.1.0');
    expect(output).toContain('tracker: beads');
  });

  test('includes config status', () => {
    const output = formatForBugReport(mockInfo);

    expect(output).toContain('global-config: yes');
    expect(output).toContain('project-config: yes');
  });

  test('includes templates list', () => {
    const output = formatForBugReport(mockInfo);

    expect(output).toContain('templates: default.hbs, beads.hbs');
  });

  test('shows unavailable agent status', () => {
    const infoUnavailable: SystemInfo = {
      ...mockInfo,
      agent: {
        name: 'claude',
        available: false,
      },
    };

    const output = formatForBugReport(infoUnavailable);

    expect(output).toContain('agent: claude (unavailable)');
  });

  test('shows none when no templates', () => {
    const infoNoTemplates: SystemInfo = {
      ...mockInfo,
      templates: {
        ...mockInfo.templates,
        installed: [],
      },
    };

    const output = formatForBugReport(infoNoTemplates);

    expect(output).toContain('templates: none');
  });

  test('includes skills info', () => {
    const output = formatForBugReport(mockInfo);

    expect(output).toContain('bundled-skills: 2');
    expect(output).toContain('skills-installed: claude:1');
  });
});

describe('parseCwdArg', () => {
  test('returns process.cwd() when no --cwd argument', () => {
    const result = parseCwdArg(['--json', '-c']);

    expect(result).toBe(process.cwd());
  });

  test('parses --cwd=path form', () => {
    const result = parseCwdArg(['--json', '--cwd=/some/path', '-c']);

    expect(result).toBe('/some/path');
  });

  test('parses --cwd path form (space-separated)', () => {
    const result = parseCwdArg(['--json', '--cwd', '/some/path', '-c']);

    expect(result).toBe('/some/path');
  });

  test('handles paths containing = characters with --cwd= form', () => {
    const result = parseCwdArg(['--cwd=/path/with=equals/dir']);

    expect(result).toBe('/path/with=equals/dir');
  });

  test('handles paths containing = characters with space form', () => {
    const result = parseCwdArg(['--cwd', '/path/with=equals/dir']);

    expect(result).toBe('/path/with=equals/dir');
  });

  test('returns process.cwd() when --cwd is last argument without value', () => {
    const result = parseCwdArg(['--json', '--cwd']);

    expect(result).toBe(process.cwd());
  });

  test('returns first --cwd value when multiple specified', () => {
    const result = parseCwdArg(['--cwd=/first', '--cwd=/second']);

    expect(result).toBe('/first');
  });

  test('handles empty args array', () => {
    const result = parseCwdArg([]);

    expect(result).toBe(process.cwd());
  });
});

describe('computePackageJsonPath', () => {
  test('resolves from dist directory (bundled)', () => {
    // When bundled, the code lives in dist/cli.js so dirname is dist/
    const result = computePackageJsonPath('/app/dist');

    expect(result).toBe('/app/package.json');
  });

  test('resolves from src/commands directory (development)', () => {
    // In development, this file is at src/commands/info.ts
    const result = computePackageJsonPath('/app/src/commands');

    expect(result).toBe('/app/package.json');
  });

  test('handles Windows-style dist path', () => {
    const result = computePackageJsonPath('C:\\app\\dist');

    expect(result).toContain('package.json');
  });

  test('handles path ending with dist', () => {
    // Ensure paths that end with 'dist' are detected correctly
    const result = computePackageJsonPath('/some/path/dist');

    expect(result).toBe('/some/path/package.json');
  });
});
