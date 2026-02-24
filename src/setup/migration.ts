/**
 * ABOUTME: Config migration utility for ralph-tui.
 * Handles automatic upgrades when users update to new versions.
 * Ensures skills and templates are updated while preserving user customizations.
 * Supports multi-agent skill installation (Claude Code, OpenCode, Factory Droid).
 */

import { access, constants } from 'node:fs/promises';

import { compareSemverStrings } from '../utils/semver.js';
import {
  loadProjectConfigOnly,
  saveProjectConfig,
  getProjectConfigPath,
} from '../config/index.js';
import type { StoredConfig } from '../config/types.js';
import {
  installViaAddSkill,
  resolveAddSkillAgentId,
} from './skill-installer.js';
import { installBuiltinTemplates } from '../templates/engine.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';

/**
 * Current config version. Bump this when making breaking changes
 * that require migration.
 *
 * Version history:
 * - 2.0: Initial versioned config (skills in ~/.claude/skills/)
 * - 2.1: Multi-agent skill installation (skills for all detected agents)
 */
export const CURRENT_CONFIG_VERSION = '2.1';

/**
 * Result of a migration attempt.
 */
export interface MigrationResult {
  /** Whether migration was performed */
  migrated: boolean;

  /** Previous config version (undefined if no version was set) */
  previousVersion?: string;

  /** New config version after migration */
  newVersion: string;

  /** Skills that were installed/updated */
  skillsUpdated: string[];

  /** Whether templates were updated */
  templatesUpdated: boolean;

  /** Any warnings during migration */
  warnings: string[];

  /** Error message if migration failed */
  error?: string;
}

/**
 * Check if config needs migration.
 * @param config The stored config to check
 * @returns true if migration is needed
 */
export function needsMigration(config: StoredConfig): boolean {
  const version = config.configVersion;

  // No version = pre-2.0 config, needs migration
  if (!version) {
    return true;
  }

  // Compare versions numerically (handles "2.10" vs "2.9" correctly)
  return compareSemverStrings(version, CURRENT_CONFIG_VERSION) < 0;
}

/**
 * Perform automatic migration of config and related files.
 * This is called on startup if the config version is outdated.
 *
 * @param cwd Working directory
 * @param options Migration options
 * @returns Migration result
 */
export async function migrateConfig(
  cwd: string,
  options: {
    /** Force update skills even if they exist */
    forceSkills?: boolean;
    /** Quiet mode - suppress console output */
    quiet?: boolean;
  } = {}
): Promise<MigrationResult> {
  const log = options.quiet ? () => {} : console.log.bind(console);
  const result: MigrationResult = {
    migrated: false,
    newVersion: CURRENT_CONFIG_VERSION,
    skillsUpdated: [],
    templatesUpdated: false,
    warnings: [],
  };

  try {
    // First check if config file actually exists
    const projectConfigPath = getProjectConfigPath(cwd);
    try {
      await access(projectConfigPath, constants.F_OK);
    } catch {
      // No config file exists, nothing to migrate
      return result;
    }

    // Load only project config (not merged with global) to avoid persisting global settings
    const config = await loadProjectConfigOnly(cwd);
    result.previousVersion = config.configVersion;

    // Check if migration is needed
    if (!needsMigration(config)) {
      return result;
    }

    log('');
    log('📦 Upgrading ralph-tui configuration...');

    // 1. Install/update bundled skills for all detected agents via add-skill
    log('   Installing bundled skills for detected agents...');

    // Register built-in agents and get those with skill support
    registerBuiltinAgents();
    const registry = getAgentRegistry();
    const plugins = registry.getRegisteredPlugins();

    // Get agents that support skills and are available
    for (const meta of plugins) {
      if (!meta.skillsPaths) continue;

      // Check if agent is installed
      const instance = registry.createInstance(meta.id);
      if (!instance) continue;

      let available = false;
      try {
        const detectResult = await instance.detect();
        available = detectResult.available;
      } catch {
        available = false;
      } finally {
        await instance.dispose();
      }

      if (!available) {
        log(`   · Skipping ${meta.name} (not installed)`);
        continue;
      }

      // Install all skills for this agent via add-skill
      log(`   Installing skills for ${meta.name}...`);
      const addSkillResult = await installViaAddSkill({
        agentId: meta.id,
        global: true,
      });

      if (addSkillResult.success) {
        result.skillsUpdated.push(`${meta.id}:all`);
        log(`     ✓ Skills installed for ${meta.name} (${resolveAddSkillAgentId(meta.id)})`);
      } else {
        result.warnings.push(`Failed to install skills for ${meta.name}: ${addSkillResult.output}`);
        log(`     ✗ Failed for ${meta.name}`);
      }
    }

    // 2. Install builtin templates to global config directory
    // Templates are only installed if they don't already exist (preserves customizations)
    const templateUpdated = installGlobalTemplatesIfMissing(options.quiet);
    result.templatesUpdated = templateUpdated;

    // 3. Update config version
    const configPath = getProjectConfigPath(cwd);
    let configExists = false;
    try {
      await access(configPath, constants.F_OK);
      configExists = true;
    } catch {
      // Config doesn't exist
    }

    if (configExists) {
      // Update the config with new version
      const updatedConfig: StoredConfig = {
        ...config,
        configVersion: CURRENT_CONFIG_VERSION,
      };
      await saveProjectConfig(updatedConfig, cwd);
      log('   ✓ Updated config version');
    }

    result.migrated = true;
    log('');
    log(`✅ Upgraded to config version ${CURRENT_CONFIG_VERSION}`);

    if (result.warnings.length > 0) {
      log('');
      log('⚠️  Warnings:');
      for (const warning of result.warnings) {
        log(`   • ${warning}`);
      }
    }

    log('');

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

/**
 * Install builtin templates to the global config directory (~/.config/ralph-tui/templates/).
 * Templates are only written if they don't already exist (preserves user customizations).
 * Project-level templates (.ralph-tui/templates/) take precedence over global templates.
 *
 * @param quiet Suppress output
 * @returns true if any templates were installed
 */
function installGlobalTemplatesIfMissing(quiet?: boolean): boolean {
  const log = quiet ? () => {} : console.log.bind(console);

  try {
    // Install builtin templates to global location (skip existing)
    const result = installBuiltinTemplates(false);

    if (!result.success) {
      const errors = result.results.filter((r) => r.error);
      if (errors.length > 0) {
        log(`   ⚠ Some templates failed to install: ${errors.map((e) => e.error).join(', ')}`);
      }
      return false;
    }

    const installed = result.results.filter((r) => r.created);
    const skipped = result.results.filter((r) => r.skipped);

    if (installed.length > 0) {
      log(`   ✓ Installed ${installed.length} template(s) to ${result.templatesDir}`);
      return true;
    }

    if (skipped.length > 0) {
      log(`   · Templates already installed (${skipped.length} skipped)`);
    }

    return false;
  } catch (error) {
    // Log error but don't fail migration
    if (!quiet) {
      console.warn(`   ⚠ Could not install templates: ${error instanceof Error ? error.message : error}`);
    }
    return false;
  }
}

/**
 * Check if migration is needed and run it if so.
 * This is the main entry point called from the run command.
 *
 * @param cwd Working directory
 * @param options Options
 * @returns Migration result or null if no migration needed
 */
export async function checkAndMigrate(
  cwd: string,
  options: {
    quiet?: boolean;
  } = {}
): Promise<MigrationResult | null> {
  try {
    // First check if a project config actually exists
    const configPath = getProjectConfigPath(cwd);
    try {
      await access(configPath, constants.F_OK);
    } catch {
      // No config file exists, nothing to migrate
      return null;
    }

    const config = await loadProjectConfigOnly(cwd);

    if (!needsMigration(config)) {
      return null;
    }

    return await migrateConfig(cwd, options);
  } catch {
    // If we can't load config, there's nothing to migrate
    return null;
  }
}
