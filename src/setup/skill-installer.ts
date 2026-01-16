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
 * Get the path to the bundled skills in the ralph-tui package.
 */
export function getBundledSkillsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // Running from dist/cli.js (bundled)
  if (currentDir.endsWith('dist') || currentDir.includes('/dist/')) {
    return join(currentDir, 'skills');
  }

  // Running from src/ (development)
  return join(currentDir, '..', '..', 'skills');
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
