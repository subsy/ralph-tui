/**
 * ABOUTME: Tests for migration skill installation via add-skill.
 * Uses mock.module to mock dependencies and test the installViaAddSkill
 * integration within migrateConfig.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let mockInstallResult = { success: true, output: '' };
let mockAgentAvailable = true;

mock.module('./skill-installer.js', () => ({
  installViaAddSkill: () => Promise.resolve(mockInstallResult),
  resolveAddSkillAgentId: (id: string) => id === 'claude' ? 'claude-code' : id,
}));

mock.module('../templates/engine.js', () => ({
  installBuiltinTemplates: () => {},
  installGlobalTemplatesIfMissing: () => false,
}));

mock.module('../plugins/agents/builtin/index.js', () => ({
  registerBuiltinAgents: () => {},
}));

mock.module('../plugins/agents/registry.js', () => ({
  getAgentRegistry: () => ({
    getRegisteredPlugins: () => [
      {
        id: 'claude',
        name: 'Claude Code',
        skillsPaths: { personal: '~/.claude/skills', repo: '.claude/skills' },
      },
    ],
    createInstance: () => ({
      detect: () => Promise.resolve({ available: mockAgentAvailable }),
      dispose: () => Promise.resolve(),
    }),
  }),
}));

// Mock config module to return an old config that needs migration
mock.module('../config/index.js', () => ({
  loadProjectConfigOnly: () => Promise.resolve({ configVersion: '1.0', agent: 'claude' }),
  saveProjectConfig: () => Promise.resolve(),
  getProjectConfigPath: (cwd: string) => join(cwd, '.ralph-tui', 'config.toml'),
}));

const { migrateConfig } = await import('./migration.js');

describe('migration skill installation', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockInstallResult = { success: true, output: '' };
    mockAgentAvailable = true;

    // Create a real temp directory with a config file so access() passes
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-tui-migration-test-'));
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.toml'), 'configVersion = "1.0"\nagent = "claude"\n');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('calls installViaAddSkill and reports success', async () => {
    mockInstallResult = { success: true, output: 'Installed 4 skills' };

    const result = await migrateConfig(tempDir, { quiet: true });

    expect(result.skillsUpdated).toContain('claude:all');
    expect(result.warnings).toHaveLength(0);
  });

  test('reports warning when installViaAddSkill fails', async () => {
    mockInstallResult = { success: false, output: 'ENOENT: not found' };

    const result = await migrateConfig(tempDir, { quiet: true });

    expect(result.skillsUpdated).not.toContain('claude:all');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Failed to install skills for Claude Code');
  });

  test('skips unavailable agents', async () => {
    mockAgentAvailable = false;

    const result = await migrateConfig(tempDir, { quiet: true });

    expect(result.skillsUpdated).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
