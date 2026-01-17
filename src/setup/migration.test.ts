/**
 * ABOUTME: Tests for the config migration module.
 * Tests automatic upgrade functionality when users update to new versions.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
} from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  needsMigration,
  migrateConfig,
  checkAndMigrate,
  CURRENT_CONFIG_VERSION,
} from './migration.js';
import type { StoredConfig } from '../config/types.js';

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

  test('is 2.0 for this release', () => {
    expect(CURRENT_CONFIG_VERSION).toBe('2.0');
  });
});
