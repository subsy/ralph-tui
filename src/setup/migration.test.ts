/**
 * ABOUTME: Tests for the config migration module.
 * Tests automatic upgrade functionality when users update to new versions.
 *
 * NOTE: This test file uses beforeAll mocks to avoid Bun's mock.module leakage issue.
 * See progress.md "Bun Mock Module Pattern (CRITICAL)" for details.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  beforeAll,
  afterEach,
  afterAll,
  spyOn,
  mock,
} from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StoredConfig } from '../config/types.js';

// Dynamic imports - populated in beforeAll after mocks are set up
let needsMigration: typeof import('./migration.js').needsMigration;
let migrateConfig: typeof import('./migration.js').migrateConfig;
let checkAndMigrate: typeof import('./migration.js').checkAndMigrate;
let compareSemverStrings: typeof import('./migration.js').compareSemverStrings;
let CURRENT_CONFIG_VERSION: string;

// Helper to create a temp directory for each test
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-migration-test-'));
}

// Helper to write a TOML config file
async function writeConfig(dir: string, config: Record<string, unknown>): Promise<void> {
  const configDir = join(dir, '.ralph-tui');
  await mkdir(configDir, { recursive: true });

  // Simple TOML serialization for test purposes
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

// Helper to read and parse a TOML config file
async function readConfig(dir: string): Promise<Record<string, string>> {
  const content = await readFile(join(dir, '.ralph-tui', 'config.toml'), 'utf-8');
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)\s*=\s*"?([^"]*)"?$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }

  return result;
}

// Set up mocks and import module before all tests
beforeAll(async () => {
  // CRITICAL: Mock ../config/index.js with the REAL implementations.
  // migration-install.test.ts mocks this at module level with hardcoded values,
  // which pollutes the cache. We need to re-export the real functions.
  // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
  const realConfig = await import('../config/index.js?test-reload') as typeof import('../config/index.js');
  mock.module('../config/index.js', () => ({
    loadProjectConfigOnly: realConfig.loadProjectConfigOnly,
    saveProjectConfig: realConfig.saveProjectConfig,
    getProjectConfigPath: realConfig.getProjectConfigPath,
  }));

  // Mock skill-installer to avoid actually spawning processes during migration
  mock.module('./skill-installer.js', () => ({
    installViaAddSkill: () => Promise.resolve({ success: true, output: '' }),
    resolveAddSkillAgentId: (id: string) => (id === 'claude' ? 'claude-code' : id),
  }));

  // Mock template engine to avoid file system operations
  mock.module('../templates/engine.js', () => ({
    installBuiltinTemplates: () => ({
      success: true,
      templatesDir: '/mock/templates',
      results: [],
    }),
    installGlobalTemplatesIfMissing: () => false,
  }));

  // Mock agent registry to provide controlled test environment
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
        detect: () => Promise.resolve({ available: true }),
        dispose: () => Promise.resolve(),
      }),
    }),
  }));

  // Dynamic import after mocks are set up
  // Use ?test-reload to force a fresh module instance, avoiding pollution from
  // migration-install.test.ts which uses module-level mock.module()
  // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
  const migrationModule = await import('./migration.js?test-reload') as typeof import('./migration.js');
  needsMigration = migrationModule.needsMigration;
  migrateConfig = migrationModule.migrateConfig;
  checkAndMigrate = migrationModule.checkAndMigrate;
  compareSemverStrings = migrationModule.compareSemverStrings;
  CURRENT_CONFIG_VERSION = migrationModule.CURRENT_CONFIG_VERSION;
});

afterAll(() => {
  mock.restore();
});

describe('needsMigration', () => {
  test('returns true when configVersion is missing', () => {
    const config: StoredConfig = {
      agent: 'claude',
    };

    expect(needsMigration(config)).toBe(true);
  });

  test('returns true when configVersion is older than current', () => {
    const config: StoredConfig = {
      configVersion: '1.0',
      agent: 'claude',
    };

    expect(needsMigration(config)).toBe(true);
  });

  test('returns false when configVersion equals current', () => {
    const config: StoredConfig = {
      configVersion: CURRENT_CONFIG_VERSION,
      agent: 'claude',
    };

    expect(needsMigration(config)).toBe(false);
  });

  test('returns false when configVersion is newer than current', () => {
    const config: StoredConfig = {
      configVersion: '99.0',
      agent: 'claude',
    };

    expect(needsMigration(config)).toBe(false);
  });
});

describe('migrateConfig', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  test('does not migrate when config already has current version', async () => {
    await writeConfig(tempDir, {
      configVersion: CURRENT_CONFIG_VERSION,
      agent: 'claude',
    });

    const result = await migrateConfig(tempDir, { quiet: true });

    expect(result.migrated).toBe(false);
    expect(result.previousVersion).toBe(CURRENT_CONFIG_VERSION);
  });

  test('migrates config without version and updates configVersion', async () => {
    await writeConfig(tempDir, {
      agent: 'claude',
      tracker: 'beads',
    });

    const result = await migrateConfig(tempDir, { quiet: true });

    expect(result.migrated).toBe(true);
    expect(result.previousVersion).toBeUndefined();
    expect(result.newVersion).toBe(CURRENT_CONFIG_VERSION);

    // Verify config was updated
    const updatedConfig = await readConfig(tempDir);
    expect(updatedConfig.configVersion).toBe(CURRENT_CONFIG_VERSION);
  });

  test('migrates config with old version', async () => {
    await writeConfig(tempDir, {
      configVersion: '1.0',
      agent: 'claude',
    });

    const result = await migrateConfig(tempDir, { quiet: true });

    expect(result.migrated).toBe(true);
    expect(result.previousVersion).toBe('1.0');
    expect(result.newVersion).toBe(CURRENT_CONFIG_VERSION);
  });

  test('preserves existing config values during migration', async () => {
    await writeConfig(tempDir, {
      agent: 'opencode',
      tracker: 'json',
      maxIterations: 20,
    });

    await migrateConfig(tempDir, { quiet: true });

    const updatedConfig = await readConfig(tempDir);
    expect(updatedConfig.agent).toBe('opencode');
    expect(updatedConfig.tracker).toBe('json');
    expect(updatedConfig.maxIterations).toBe('20');
  });

  test('returns error when config directory does not exist', async () => {
    const nonExistentDir = join(tempDir, 'does-not-exist');

    const result = await migrateConfig(nonExistentDir, { quiet: true });

    // Should not migrate when no config exists
    expect(result.migrated).toBe(false);
  });

  test('reports skills that were updated', async () => {
    await writeConfig(tempDir, {
      agent: 'claude',
    });

    const result = await migrateConfig(tempDir, { quiet: true });

    expect(result.migrated).toBe(true);
    // Skills array should be defined (may be empty if no bundled skills)
    expect(Array.isArray(result.skillsUpdated)).toBe(true);
  });
});

describe('checkAndMigrate', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns null when no config exists', async () => {
    const result = await checkAndMigrate(tempDir, { quiet: true });

    expect(result).toBeNull();
  });

  test('returns null when config is current', async () => {
    await writeConfig(tempDir, {
      configVersion: CURRENT_CONFIG_VERSION,
      agent: 'claude',
    });

    const result = await checkAndMigrate(tempDir, { quiet: true });

    expect(result).toBeNull();
  });

  test('returns migration result when config needs update', async () => {
    await writeConfig(tempDir, {
      agent: 'claude',
    });

    const result = await checkAndMigrate(tempDir, { quiet: true });

    expect(result).not.toBeNull();
    expect(result?.migrated).toBe(true);
  });
});

describe('CURRENT_CONFIG_VERSION', () => {
  test('is a valid semver-like string', () => {
    expect(CURRENT_CONFIG_VERSION).toMatch(/^\d+\.\d+$/);
  });

  test('is 2.1 for this release (multi-agent skills)', () => {
    expect(CURRENT_CONFIG_VERSION).toBe('2.1');
  });
});

describe('compareSemverStrings', () => {
  test('returns 0 for equal versions', () => {
    expect(compareSemverStrings('2.0', '2.0')).toBe(0);
    expect(compareSemverStrings('1.0.0', '1.0.0')).toBe(0);
  });

  test('returns -1 when first version is less', () => {
    expect(compareSemverStrings('1.0', '2.0')).toBe(-1);
    expect(compareSemverStrings('2.0', '2.1')).toBe(-1);
    expect(compareSemverStrings('1.9', '2.0')).toBe(-1);
  });

  test('returns 1 when first version is greater', () => {
    expect(compareSemverStrings('2.0', '1.0')).toBe(1);
    expect(compareSemverStrings('2.1', '2.0')).toBe(1);
    expect(compareSemverStrings('2.0', '1.9')).toBe(1);
  });

  test('handles numeric comparison correctly (2.10 > 2.9)', () => {
    expect(compareSemverStrings('2.10', '2.9')).toBe(1);
    expect(compareSemverStrings('2.9', '2.10')).toBe(-1);
    expect(compareSemverStrings('1.100', '1.99')).toBe(1);
  });

  test('treats missing segments as 0', () => {
    expect(compareSemverStrings('2', '2.0')).toBe(0);
    expect(compareSemverStrings('2.0', '2.0.0')).toBe(0);
    expect(compareSemverStrings('2', '2.1')).toBe(-1);
  });

  test('strips pre-release and build metadata', () => {
    expect(compareSemverStrings('2.0-beta', '2.0')).toBe(0);
    expect(compareSemverStrings('2.0+build123', '2.0')).toBe(0);
    expect(compareSemverStrings('2.0-alpha', '2.0-beta')).toBe(0);
  });
});
