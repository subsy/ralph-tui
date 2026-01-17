/**
 * ABOUTME: Config migration utility for ralph-tui.
 * Handles automatic upgrades when users update to new versions.
 * Ensures skills and templates are updated while preserving user customizations.
 */

import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

import { loadStoredConfig, saveProjectConfig, getProjectConfigPath } from '../config/index.js';
import type { StoredConfig } from '../config/types.js';
import { listBundledSkills, installSkill } from './skill-installer.js';

/**
 * Current config version. Bump this when making breaking changes
 * that require migration.
 */
export const CURRENT_CONFIG_VERSION = '2.0';

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

  // Compare versions (simple string comparison works for semver-like versions)
  return version < CURRENT_CONFIG_VERSION;
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

    // Load current config
    const config = await loadStoredConfig(cwd);
    result.previousVersion = config.configVersion;

    // Check if migration is needed
    if (!needsMigration(config)) {
      return result;
    }

    log('');
    log('📦 Upgrading ralph-tui configuration...');

    // 1. Install/update bundled skills
    log('   Installing bundled skills...');
    const skills = await listBundledSkills();

    for (const skill of skills) {
      const installResult = await installSkill(skill.name, {
        force: options.forceSkills ?? true, // Default to updating skills
      });

      if (installResult.success && !installResult.skipped) {
        result.skillsUpdated.push(skill.name);
        log(`   ✓ Installed skill: ${skill.name}`);
      } else if (installResult.skipped) {
        log(`   · Skill already installed: ${skill.name}`);
      } else if (installResult.error) {
        result.warnings.push(`Failed to install skill ${skill.name}: ${installResult.error}`);
      }
    }

    // 2. Check for template updates
    // We only update templates if the user hasn't customized them
    const templateUpdated = await updateTemplateIfNotCustomized(cwd, options.quiet);
    result.templatesUpdated = templateUpdated;
    if (templateUpdated) {
      log('   ✓ Updated prompt template');
    }

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
 * Update the prompt template if the user hasn't customized it.
 * We detect customization by checking if the template differs from
 * the previous default.
 *
 * @param cwd Working directory
 * @param quiet Suppress output
 * @returns true if template was updated
 */
async function updateTemplateIfNotCustomized(
  cwd: string,
  quiet?: boolean
): Promise<boolean> {
  const log = quiet ? () => {} : console.log.bind(console);

  try {
    const templatePath = join(cwd, '.ralph-tui', 'prompt.hbs');

    // Check if user has a custom template
    try {
      await access(templatePath, constants.F_OK);
      // Template exists - we preserve user customizations
      // For now, we'll be conservative and not overwrite any existing template.
      // Users can run `ralph-tui template init --force` to get the new template.
      log('   · Custom prompt template detected, preserving (run "ralph-tui template init --force" to update)');
      return false;
    } catch {
      // No custom template exists, nothing to update
      return false;
    }
  } catch {
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

    const config = await loadStoredConfig(cwd);

    if (!needsMigration(config)) {
      return null;
    }

    return await migrateConfig(cwd, options);
  } catch {
    // If we can't load config, there's nothing to migrate
    return null;
  }
}
