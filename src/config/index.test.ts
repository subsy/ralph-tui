/**
 * ABOUTME: Tests for configuration loading, merging, and validation.
 * Covers file discovery, config merging, and runtime config building.
 */

import { describe, expect, test, beforeEach, afterEach, beforeAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadStoredConfig,
  loadStoredConfigWithSource,
  serializeConfig,
  validateConfig,
  saveProjectConfig,
  getProjectConfigPath,
  getProjectConfigDir,
  checkSetupStatus,
  buildConfig,
  CONFIG_PATHS,
} from './index.js';
import type { StoredConfig, RalphConfig } from './types.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import { registerBuiltinTrackers } from '../plugins/trackers/builtin/index.js';

// Register built-in plugins for validation tests
beforeAll(() => {
  registerBuiltinAgents();
  registerBuiltinTrackers();
});

// Helper to create a temp directory for each test
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-config-test-'));
}

// Helper to write TOML config file
async function writeTomlConfig(path: string, config: StoredConfig): Promise<void> {
  const { stringify } = await import('smol-toml');
  const content = stringify(config);
  await writeFile(path, content, 'utf-8');
}

describe('loadStoredConfig', () => {
  let tempDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    globalConfigPath = join(tempDir, 'global-config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns empty config when no files exist', async () => {
    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config).toEqual({});
  });

  test('loads global config file', async () => {
    await writeTomlConfig(globalConfigPath, {
      maxIterations: 15,
      agent: 'claude',
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.maxIterations).toBe(15);
    expect(config.agent).toBe('claude');
  });

  test('loads project config file', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      maxIterations: 25,
      tracker: 'json',
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.maxIterations).toBe(25);
    expect(config.tracker).toBe('json');
  });

  test('merges global and project configs (project overrides)', async () => {
    // Write global config
    await writeTomlConfig(globalConfigPath, {
      maxIterations: 15,
      agent: 'claude',
      iterationDelay: 1000,
    });

    // Write project config
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      maxIterations: 30,  // Override
      tracker: 'json',    // New field
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.maxIterations).toBe(30);        // Project override
    expect(config.agent).toBe('claude');          // From global
    expect(config.tracker).toBe('json');          // From project
    expect(config.iterationDelay).toBe(1000);     // From global
  });

  test('handles empty config files', async () => {
    await writeFile(globalConfigPath, '', 'utf-8');
    
    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config).toEqual({});
  });

  test('finds project config in parent directories', async () => {
    // Create a project structure with config at project root
    const projectRoot = join(tempDir, 'my-project');
    await mkdir(projectRoot, { recursive: true });
    
    const projectConfigDir = join(projectRoot, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      agent: 'droid',
    });

    // Create a nested working directory inside the project
    // Only one level deep to simplify path traversal
    const nestedDir = join(projectRoot, 'src');
    await mkdir(nestedDir, { recursive: true });

    // Should find config from parent
    const config = await loadStoredConfig(nestedDir, globalConfigPath);
    expect(config.agent).toBe('droid');
  });

  test('merges nested objects (agentOptions)', async () => {
    await writeTomlConfig(globalConfigPath, {
      agentOptions: { model: 'claude-sonnet-4-20250514', temperature: 0.7 },
    });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      agentOptions: { temperature: 0.9, maxTokens: 4000 },
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.agentOptions?.model).toBe('claude-sonnet-4-20250514');
    expect(config.agentOptions?.temperature).toBe(0.9);
    expect(config.agentOptions?.maxTokens).toBe(4000);
  });

  test('replaces arrays entirely from project config', async () => {
    await writeTomlConfig(globalConfigPath, {
      agents: [
        { name: 'global-agent', plugin: 'claude', options: {} },
      ],
    });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      agents: [
        { name: 'project-agent', plugin: 'droid', options: {} },
      ],
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.agents).toHaveLength(1);
    expect(config.agents![0].name).toBe('project-agent');
  });

  test('merges errorHandling config', async () => {
    await writeTomlConfig(globalConfigPath, {
      errorHandling: { strategy: 'retry', maxRetries: 3 },
    });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      errorHandling: { maxRetries: 5 },
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.errorHandling?.strategy).toBe('retry');
    expect(config.errorHandling?.maxRetries).toBe(5);
  });

  test('merges rateLimitHandling config', async () => {
    await writeTomlConfig(globalConfigPath, {
      rateLimitHandling: { enabled: true, maxRetries: 3 },
    });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      rateLimitHandling: { baseBackoffMs: 10000 },
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.rateLimitHandling?.enabled).toBe(true);
    expect(config.rateLimitHandling?.maxRetries).toBe(3);
    expect(config.rateLimitHandling?.baseBackoffMs).toBe(10000);
  });

  test('merges notifications config', async () => {
    await writeTomlConfig(globalConfigPath, {
      notifications: { enabled: true },
    });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      notifications: { sound: 'ralph' },
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.notifications?.enabled).toBe(true);
    expect(config.notifications?.sound).toBe('ralph');
  });

  test('promotes a misplaced defaultAgent from an agent options table', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    const projectConfigPath = join(projectConfigDir, 'config.toml');
    await writeFile(
      projectConfigPath,
      `
configVersion = "2.1"
maxIterations = 0
tracker = "beads-rust"

[[agents]]
name = "cc-claude-4.6"
plugin = "claude"

    [agents.options]
    model = "claude-opus-4-6"

[[agents]]
name = "oc-claude-4.6"
plugin = "opencode"

    [agents.options]
    model = "github-copilot/claude-opus-4.6"

defaultAgent = "cc-claude-4.6"
`,
      'utf-8',
    );

    const config = await loadStoredConfig(tempDir, globalConfigPath);

    expect(config.defaultAgent).toBe('cc-claude-4.6');
    expect(config.agents?.[1]?.options).toEqual({
      model: 'github-copilot/claude-opus-4.6',
    });
    expect(config.agents?.[1]?.options).not.toHaveProperty('defaultAgent');
  });

  test('merges parallel config', async () => {
    await writeTomlConfig(globalConfigPath, {
      parallel: { mode: 'auto', maxWorkers: 2, worktreeDir: '.global/worktrees' },
    });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      parallel: { maxWorkers: 5, directMerge: true },
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.parallel?.mode).toBe('auto');
    expect(config.parallel?.worktreeDir).toBe('.global/worktrees');
    expect(config.parallel?.maxWorkers).toBe(5);
    expect(config.parallel?.directMerge).toBe(true);
  });
});

describe('loadStoredConfigWithSource', () => {
  let tempDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    globalConfigPath = join(tempDir, 'global-config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns source info when no configs exist', async () => {
    const { config, source } = await loadStoredConfigWithSource(tempDir, globalConfigPath);
    expect(config).toEqual({});
    expect(source.globalLoaded).toBe(false);
    expect(source.projectLoaded).toBe(false);
    expect(source.globalPath).toBeNull();
    expect(source.projectPath).toBeNull();
  });

  test('returns source info for global config only', async () => {
    await writeTomlConfig(globalConfigPath, { agent: 'claude' });

    const { config, source } = await loadStoredConfigWithSource(tempDir, globalConfigPath);
    expect(config.agent).toBe('claude');
    expect(source.globalLoaded).toBe(true);
    expect(source.projectLoaded).toBe(false);
    expect(source.globalPath).toBe(globalConfigPath);
    expect(source.projectPath).toBeNull();
  });

  test('returns source info for project config only', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    const projectConfigPath = join(projectConfigDir, 'config.toml');
    await writeTomlConfig(projectConfigPath, { tracker: 'json' });

    const { config, source } = await loadStoredConfigWithSource(tempDir, globalConfigPath);
    expect(config.tracker).toBe('json');
    expect(source.globalLoaded).toBe(false);
    expect(source.projectLoaded).toBe(true);
    expect(source.globalPath).toBeNull();
    expect(source.projectPath).toBe(projectConfigPath);
  });

  test('returns source info for both configs', async () => {
    await writeTomlConfig(globalConfigPath, { agent: 'claude' });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    const projectConfigPath = join(projectConfigDir, 'config.toml');
    await writeTomlConfig(projectConfigPath, { tracker: 'json' });

    const { config, source } = await loadStoredConfigWithSource(tempDir, globalConfigPath);
    expect(config.agent).toBe('claude');
    expect(config.tracker).toBe('json');
    expect(source.globalLoaded).toBe(true);
    expect(source.projectLoaded).toBe(true);
    expect(source.globalPath).toBe(globalConfigPath);
    expect(source.projectPath).toBe(projectConfigPath);
  });
});

describe('serializeConfig', () => {
  test('serializes empty config', () => {
    const toml = serializeConfig({});
    // smol-toml may add a trailing newline for empty objects
    expect(toml.trim()).toBe('');
  });

  test('serializes simple config', () => {
    const toml = serializeConfig({
      agent: 'claude',
      maxIterations: 10,
    });
    expect(toml).toContain('agent');
    expect(toml).toContain('claude');
    expect(toml).toContain('maxIterations');
    expect(toml).toContain('10');
  });

  test('serializes nested config', () => {
    const toml = serializeConfig({
      agents: [
        { name: 'test', plugin: 'claude', options: {} },
      ],
    });
    expect(toml).toContain('[[agents]]');
    expect(toml).toContain('name');
    expect(toml).toContain('test');
  });
});

describe('saveProjectConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('creates config directory and file', async () => {
    await saveProjectConfig({ agent: 'claude' }, tempDir);

    const config = await loadStoredConfig(tempDir, join(tempDir, 'nonexistent.toml'));
    expect(config.agent).toBe('claude');
  });

  test('overwrites existing config', async () => {
    await saveProjectConfig({ agent: 'claude' }, tempDir);
    await saveProjectConfig({ agent: 'droid' }, tempDir);

    const config = await loadStoredConfig(tempDir, join(tempDir, 'nonexistent.toml'));
    expect(config.agent).toBe('droid');
  });
});

describe('getProjectConfigPath', () => {
  test('returns correct path', () => {
    const path = getProjectConfigPath('/some/project');
    expect(path).toBe('/some/project/.ralph-tui/config.toml');
  });
});

describe('getProjectConfigDir', () => {
  test('returns correct directory', () => {
    const dir = getProjectConfigDir('/some/project');
    expect(dir).toBe('/some/project/.ralph-tui');
  });
});

describe('CONFIG_PATHS', () => {
  test('contains expected paths', () => {
    expect(CONFIG_PATHS.projectDir).toBe('.ralph-tui');
    expect(CONFIG_PATHS.projectFilename).toBe('config.toml');
    expect(CONFIG_PATHS.global).toContain('config.toml');
  });
});

describe('checkSetupStatus', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns not ready when no config exists', async () => {
    // Override loadStoredConfigWithSource behavior by not having any config
    const status = await checkSetupStatus(tempDir);
    expect(status.ready).toBe(false);
    expect(status.configExists).toBe(false);
    expect(status.agentConfigured).toBe(false);
    expect(status.message).toContain('No configuration found');
  });

  test('treats configured agents as ready even without defaultAgent', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      agents: [{ name: 'custom-agent', plugin: 'claude', options: {} }],
    });

    const status = await checkSetupStatus(tempDir);

    expect(status.ready).toBe(true);
    expect(status.agentConfigured).toBe(true);
  });
});

describe('Edge cases: Invalid config files', () => {
  let tempDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    globalConfigPath = join(tempDir, 'global-config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('handles invalid TOML syntax gracefully', async () => {
    await writeFile(globalConfigPath, 'invalid toml { content', 'utf-8');
    
    // Should not throw, returns empty config
    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config).toEqual({});
  });

  test('handles schema validation errors gracefully', async () => {
    // Write valid TOML but invalid schema
    await writeFile(globalConfigPath, 'unknownField = "value"', 'utf-8');
    
    // Should not throw, returns empty config (validation fails)
    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config).toEqual({});
  });

  test('handles unreadable files gracefully', async () => {
    // Non-existent path should be handled
    const config = await loadStoredConfig(tempDir, '/nonexistent/path/config.toml');
    expect(config).toEqual({});
  });

  test('handles config with invalid maxIterations', async () => {
    await writeFile(globalConfigPath, 'maxIterations = -1', 'utf-8');
    
    // Should return empty config due to validation failure
    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config).toEqual({});
  });

  test('handles config with invalid agent array', async () => {
    await writeFile(globalConfigPath, `
[[agents]]
name = ""
plugin = "claude"
`, 'utf-8');
    
    // Should return empty config due to validation failure
    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config).toEqual({});
  });
});

describe('Config merging - scalar overrides', () => {
  let tempDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    globalConfigPath = join(tempDir, 'global-config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('project overrides defaultAgent', async () => {
    await writeTomlConfig(globalConfigPath, { defaultAgent: 'global-default' });
    
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { defaultAgent: 'project-default' });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.defaultAgent).toBe('project-default');
  });

  test('project overrides defaultTracker', async () => {
    await writeTomlConfig(globalConfigPath, { defaultTracker: 'beads-bv' });
    
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { defaultTracker: 'json' });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.defaultTracker).toBe('json');
  });

  test('project overrides outputDir', async () => {
    await writeTomlConfig(globalConfigPath, { outputDir: '/global/output' });
    
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { outputDir: '/project/output' });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.outputDir).toBe('/project/output');
  });

  test('project overrides autoCommit', async () => {
    await writeTomlConfig(globalConfigPath, { autoCommit: false });
    
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { autoCommit: true });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.autoCommit).toBe(true);
  });

  test('project overrides prompt_template', async () => {
    await writeTomlConfig(globalConfigPath, { prompt_template: '/global/prompt.md' });
    
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { prompt_template: '/project/prompt.md' });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.prompt_template).toBe('/project/prompt.md');
  });

  test('project overrides skills_dir', async () => {
    await writeTomlConfig(globalConfigPath, { skills_dir: '/global/skills' });
    
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { skills_dir: '/project/skills' });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.skills_dir).toBe('/project/skills');
  });

  test('project overrides subagentTracingDetail', async () => {
    await writeTomlConfig(globalConfigPath, { subagentTracingDetail: 'off' });
    
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { subagentTracingDetail: 'full' });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.subagentTracingDetail).toBe('full');
  });

  test('project replaces fallbackAgents array', async () => {
    await writeTomlConfig(globalConfigPath, { fallbackAgents: ['claude', 'codex'] });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { fallbackAgents: ['droid'] });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.fallbackAgents).toEqual(['droid']);
  });

  test('project overrides command', async () => {
    await writeTomlConfig(globalConfigPath, { command: 'global-ccr code' });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), { command: 'project-ccr code' });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.command).toBe('project-ccr code');
  });

  test('command from global config is preserved when project has none', async () => {
    await writeTomlConfig(globalConfigPath, {
      agent: 'claude',
      command: 'ccr code',
    });

    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      maxIterations: 20,  // Other field, no command
    });

    const config = await loadStoredConfig(tempDir, globalConfigPath);
    expect(config.command).toBe('ccr code');
    expect(config.maxIterations).toBe(20);
  });
});

describe('validateConfig', () => {
  test('validates valid configuration', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'beads-bv', plugin: 'beads-bv', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('reports error for unknown agent plugin', async () => {
    const config: RalphConfig = {
      agent: { name: 'unknown', plugin: 'nonexistent-plugin', options: {} },
      tracker: { name: 'beads-bv', plugin: 'beads-bv', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nonexistent-plugin'))).toBe(true);
  });

  test('reports error for unknown tracker plugin', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'unknown', plugin: 'nonexistent-tracker', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nonexistent-tracker'))).toBe(true);
  });

  test('reports error for negative iterations', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'beads-bv', plugin: 'beads-bv', options: {} },
      maxIterations: -1,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('iterations'))).toBe(true);
  });

  test('reports error for negative delay', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'beads-bv', plugin: 'beads-bv', options: {} },
      maxIterations: 10,
      iterationDelay: -1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('delay'))).toBe(true);
  });

  test('warns about missing epic ID for beads tracker in TUI mode', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'beads-bv', plugin: 'beads-bv', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('epic'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('interactive epic selection'))).toBe(true);
  });

  test('warns about missing epic ID for beads-rust tracker in TUI mode', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'beads-rust', plugin: 'beads-rust', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('epic'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('interactive epic selection'))).toBe(true);
  });

  test('warns about missing epic ID for beads tracker in headless mode', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'beads', plugin: 'beads', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: false,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('headless'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('no interactive epic selection'))).toBe(true);
  });

  test('reports warning for json tracker without prdPath (TUI will prompt)', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'json', plugin: 'json', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    // Now valid - TUI will show file prompt dialog instead of erroring
    const result = await validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('PRD') || w.includes('prd'))).toBe(true);
  });

  test('reports error for linear tracker without epic', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'linear', plugin: 'linear', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Linear'))).toBe(true);
    expect(result.errors.some((e) => e.includes('--epic'))).toBe(true);
  });

  test('linear tracker with epic passes validation', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'linear', plugin: 'linear', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      epicId: 'ENG-123',
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('linear tracker error includes example usage', async () => {
    const config: RalphConfig = {
      agent: { name: 'claude', plugin: 'claude', options: {} },
      tracker: { name: 'linear', plugin: 'linear', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      cwd: process.cwd(),
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      errorHandling: {
        strategy: 'skip',
        maxRetries: 3,
        retryDelayMs: 5000,
        continueOnNonZeroExit: false,
      },
    };

    const result = await validateConfig(config);
    expect(result.valid).toBe(false);
    // Error message should include actionable example
    expect(result.errors.some((e) => e.includes('ralph-tui run'))).toBe(true);
    expect(result.errors.some((e) => e.includes('ENG-123'))).toBe(true);
  });
});

describe('buildConfig - command shorthand', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('applies command shorthand to agent config', async () => {
    // Create project config with command shorthand
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
agent = "claude"
tracker = "beads-bv"
command = "ccr code"
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    expect(config!.agent.command).toBe('ccr code');
  });

  test('agent-level command takes precedence over top-level command', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
command = "top-level-command"
tracker = "beads-bv"

[[agents]]
name = "claude"
plugin = "claude"
command = "agent-level-command"
default = true
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    // Agent-level command should win
    expect(config!.agent.command).toBe('agent-level-command');
  });

  test('command shorthand is not applied if agent already has command', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
command = "should-not-be-used"
tracker = "beads-bv"

[[agents]]
name = "custom-claude"
plugin = "claude"
command = "my-custom-claude"
default = true
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    expect(config!.agent.command).toBe('my-custom-claude');
  });
});

describe('buildConfig - envPassthrough shorthand', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('applies top-level envPassthrough to default agent', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
agent = "claude"
tracker = "beads-bv"
envPassthrough = ["ANTHROPIC_API_KEY"]
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    expect(config!.agent.envPassthrough).toEqual(['ANTHROPIC_API_KEY']);
  });

  test('applies top-level envExclude to default agent', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
agent = "claude"
tracker = "beads-bv"
envExclude = ["*_TOKEN", "DATABASE_URL"]
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    expect(config!.agent.envExclude).toEqual(['*_TOKEN', 'DATABASE_URL']);
  });

  test('agent-level envPassthrough takes precedence over top-level', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
envPassthrough = ["SHOULD_NOT_BE_USED"]
tracker = "beads-bv"

[[agents]]
name = "claude"
plugin = "claude"
default = true
envPassthrough = ["AGENT_LEVEL_KEY"]
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    expect(config!.agent.envPassthrough).toEqual(['AGENT_LEVEL_KEY']);
  });

  test('top-level envPassthrough not applied if agent already has it set', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
envPassthrough = ["TOP_LEVEL_KEY"]
tracker = "beads-bv"

[[agents]]
name = "custom-claude"
plugin = "claude"
default = true
envPassthrough = ["AGENT_SPECIFIC_KEY"]
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    expect(config!.agent.envPassthrough).toEqual(['AGENT_SPECIFIC_KEY']);
  });

  test('applies both envExclude and envPassthrough shorthands', async () => {
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
agent = "claude"
tracker = "beads-bv"
envExclude = ["*_TOKEN"]
envPassthrough = ["MY_API_KEY"]
`,
      'utf-8'
    );

    const config = await buildConfig({ cwd: tempDir });

    expect(config).not.toBeNull();
    expect(config!.agent.envExclude).toEqual(['*_TOKEN']);
    expect(config!.agent.envPassthrough).toEqual(['MY_API_KEY']);
  });
});
