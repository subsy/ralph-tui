/**
 * ABOUTME: Skill installation utility for ralph-tui.
 * Provides functions to install skills to the user's ~/.claude/skills/ directory.
 * Skills are bundled with ralph-tui and can be installed during setup.
 */

import { readFile, writeFile, mkdir, access, constants, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Result of a skill installation attempt.
 */
export interface SkillInstallResult {
  /** Whether the installation was successful */
  success: boolean;

  /** Path where the skill was installed */
  path?: string;

  /** Error message if installation failed */
  error?: string;

  /** Whether the skill already existed and was skipped */
  skipped?: boolean;
}

/**
 * Information about an available skill.
 */
export interface SkillInfo {
  /** Skill name/ID */
  name: string;

  /** Skill description */
  description: string;

  /** Path to the skill in the ralph-tui package */
  sourcePath: string;
}

/**
 * Get the path to the user's Claude Code skills directory.
 */
export function getClaudeSkillsDir(): string {
  return join(homedir(), '.claude', 'skills');
}

/**
 * Compute the skills path based on the current directory.
 * This is extracted as a pure function to enable testing.
 *
 * @param currentDir - The directory where the code is running from
 * @returns The computed path to the skills directory
 */
export function computeSkillsPath(currentDir: string): string {
  // When bundled by bun, all code is in dist/cli.js (single file bundle).
  // In that case, skills/ is a sibling directory at dist/skills/.
  // In development, this file is at src/setup/skill-installer.ts,
  // and skills/ is at the project root (up 2 levels).

  const bundledPath = join(currentDir, 'skills');
  const devPath = join(currentDir, '..', '..', 'skills');

  // Return the bundled path if we're in dist/
  // Use endsWith('dist') for exact match at end, or includes('/dist/') for dist as path segment
  // This avoids false matches like '/distribution/' or '/my-dist/'
  if (currentDir.endsWith('dist') || currentDir.includes('/dist/')) {
    return bundledPath;
  }

  return devPath;
}

/**
 * Get the path to the bundled skills in the ralph-tui package.
 * This function handles both development (running from src/) and production
 * (running from bundled dist/) environments.
 */
export function getBundledSkillsDir(): string {
  // In ESM, we need to derive the path from import.meta.url
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return computeSkillsPath(currentDir);
}

/**
 * List all bundled skills available for installation.
 */
export async function listBundledSkills(): Promise<SkillInfo[]> {
  const skillsDir = getBundledSkillsDir();
  const skills: SkillInfo[] = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(skillsDir, entry.name);
        const skillMdPath = join(skillPath, 'SKILL.md');

        try {
          await access(skillMdPath, constants.F_OK);
          const content = await readFile(skillMdPath, 'utf-8');

          // Extract description from YAML frontmatter
          const descMatch = content.match(/description:\s*["']?([^"'\n]+)["']?/);
          const description = descMatch?.[1] || 'No description available';

          skills.push({
            name: entry.name,
            description,
            sourcePath: skillPath,
          });
        } catch {
          // SKILL.md doesn't exist, skip this directory
        }
      }
    }
  } catch {
    // Skills directory doesn't exist or is inaccessible
  }

  return skills;
}

/**
 * Check if a skill is already installed.
 */
export async function isSkillInstalled(skillName: string): Promise<boolean> {
  const targetPath = join(getClaudeSkillsDir(), skillName);

  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a bundled skill to the user's Claude Code skills directory.
 */
export async function installSkill(
  skillName: string,
  options: {
    force?: boolean;
  } = {}
): Promise<SkillInstallResult> {
  const sourcePath = join(getBundledSkillsDir(), skillName);
  const targetPath = join(getClaudeSkillsDir(), skillName);

  try {
    // Check if source exists
    const sourceSkillMd = join(sourcePath, 'SKILL.md');
    try {
      await access(sourceSkillMd, constants.F_OK);
    } catch {
      return {
        success: false,
        error: `Skill '${skillName}' not found in bundled skills`,
      };
    }

    // Check if already installed
    if (!options.force && (await isSkillInstalled(skillName))) {
      return {
        success: true,
        path: targetPath,
        skipped: true,
      };
    }

    // Ensure target directory exists
    await mkdir(targetPath, { recursive: true });

    // Read source SKILL.md
    const skillContent = await readFile(sourceSkillMd, 'utf-8');

    // Write to target
    const targetSkillMd = join(targetPath, 'SKILL.md');
    await writeFile(targetSkillMd, skillContent, 'utf-8');

    return {
      success: true,
      path: targetPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install the ralph-tui-prd skill specifically.
 */
export async function installRalphTuiPrdSkill(
  options: {
    force?: boolean;
  } = {}
): Promise<SkillInstallResult> {
  return installSkill('ralph-tui-prd', options);
}

/**
 * Install all bundled skills.
 */
export async function installAllSkills(
  options: {
    force?: boolean;
  } = {}
): Promise<Map<string, SkillInstallResult>> {
  const results = new Map<string, SkillInstallResult>();
  const skills = await listBundledSkills();

  for (const skill of skills) {
    const result = await installSkill(skill.name, options);
    results.set(skill.name, result);
  }

  return results;
}
