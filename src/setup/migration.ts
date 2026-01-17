/**
 * ABOUTME: Config migration utility for ralph-tui.
 * Handles automatic upgrades when users update to new versions.
 * Ensures skills and templates are updated while preserving user customizations.
 */

import { access, constants, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  loadProjectConfigOnly,
  saveProjectConfig,
  getProjectConfigPath,
} from '../config/index.js';
import type { StoredConfig } from '../config/types.js';
import { listBundledSkills, installSkill } from './skill-installer.js';
import { getBuiltinTemplate } from '../templates/engine.js';

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
 * Compare two semver-like version strings numerically.
 * Compares each segment as integers (e.g., "2.10" > "2.9").
 * Missing segments are treated as 0.
 *
 * @param a First version string
 * @param b Second version string
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareSemverStrings(a: string, b: string): -1 | 0 | 1 {
  // Strip any pre-release/build metadata (e.g., "2.0-beta" -> "2.0")
  const cleanA = a.split(/[-+]/)[0];
  const cleanB = b.split(/[-+]/)[0];

  const partsA = cleanA.split('.').map((s) => parseInt(s, 10) || 0);
  const partsB = cleanB.split('.').map((s) => parseInt(s, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
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
 * - If template is missing → write new default template
 * - If template exists and matches current default → no update needed
 * - If template exists but differs → preserve user customization
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
    const templateDir = join(cwd, '.ralph-tui');
    const templatePath = join(templateDir, 'prompt.hbs');
    const defaultTemplate = getBuiltinTemplate('default');

    // Check if template already exists
    let existingTemplate: string | null = null;
    try {
      existingTemplate = await readFile(templatePath, 'utf-8');
    } catch {
      // Template doesn't exist
    }

    if (existingTemplate === null) {
      // No template exists - write the default template
      await mkdir(templateDir, { recursive: true });
      await writeFile(templatePath, defaultTemplate, 'utf-8');
      return true;
    }

    // Template exists - check if it matches current default
    if (existingTemplate.trim() === defaultTemplate.trim()) {
      // Already has the current default, no update needed
      log('   · Prompt template is already current');
      return false;
    }

    // Template differs from default - user has customized it, preserve
    log('   · Custom prompt template detected, preserving (run "ralph-tui template init --force" to update)');
    return false;
  } catch (error) {
    // Log error but don't fail migration
    if (!quiet) {
      console.warn(`   ⚠ Could not update template: ${error instanceof Error ? error.message : error}`);
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
