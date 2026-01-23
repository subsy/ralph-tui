/**
 * ABOUTME: Skill installation utility for ralph-tui.
 * Provides functions to install skills to agent-specific skills directories.
 * Skills are bundled with ralph-tui and can be installed during setup.
 * Supports multiple agents (Claude Code, OpenCode, Factory Droid) via plugin-defined paths.
 */

import { readFile, writeFile, mkdir, access, constants, readdir } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AgentSkillsPaths } from '../plugins/agents/types.js';

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
 * Result of installing a skill to a specific target (personal or repo).
 */
export interface SkillTargetResult {
  /** Target type ('personal' or 'repo') */
  target: 'personal' | 'repo';

  /** The installation result */
  result: SkillInstallResult;
}

/**
 * Result of installing skills for a specific agent.
 */
export interface AgentSkillInstallResult {
  /** Agent plugin ID */
  agentId: string;

  /** Agent display name */
  agentName: string;

  /** Results for each skill installed, with per-target results */
  skills: Map<string, SkillTargetResult[]>;

  /** Whether any skills were successfully installed */
  hasInstalls: boolean;

  /** Whether all skills were skipped (already installed) */
  allSkipped: boolean;
}

/**
 * Expand ~ in paths to the user's home directory.
 * Supports both POSIX (~/) and Windows (~\) style paths.
 */
export function expandTilde(path: string): string {
  // Handle ~/ (POSIX) and ~\ (Windows)
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2));
  }
  if (path === '~') {
    return homedir();
  }
  return path;
}

/**
 * Resolve the absolute path for a skills directory.
 * Handles ~ expansion and can resolve repo-relative paths.
 * Supports both POSIX and Windows absolute paths (including drive letters and UNC paths).
 *
 * @param skillsPath - Path from AgentSkillsPaths (personal or repo)
 * @param cwd - Current working directory for repo-relative paths
 */
export function resolveSkillsPath(skillsPath: string, cwd?: string): string {
  // Expand ~ for personal paths (handles both ~/ and ~\)
  if (skillsPath.startsWith('~')) {
    return expandTilde(skillsPath);
  }
  // Already absolute paths are returned as-is (POSIX, Windows drive letters, UNC paths)
  if (isAbsolute(skillsPath)) {
    return skillsPath;
  }
  // Repo-relative paths need a working directory
  if (cwd) {
    return join(cwd, skillsPath);
  }
  return join(process.cwd(), skillsPath);
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
 * Check if a skill is installed at a specific path.
 */
export async function isSkillInstalledAt(skillName: string, targetDir: string): Promise<boolean> {
  const targetPath = join(targetDir, skillName);

  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a bundled skill to a specific target directory.
 *
 * @param skillName - Name of the bundled skill to install
 * @param targetDir - Absolute path to the skills directory
 * @param options - Installation options
 */
export async function installSkillTo(
  skillName: string,
  targetDir: string,
  options: {
    force?: boolean;
  } = {}
): Promise<SkillInstallResult> {
  const sourcePath = join(getBundledSkillsDir(), skillName);
  const targetPath = join(targetDir, skillName);

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
    if (!options.force && (await isSkillInstalledAt(skillName, targetDir))) {
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
 * Install skills for an agent using its plugin-defined paths.
 *
 * @param agentId - Agent plugin ID (e.g., 'claude', 'opencode', 'droid')
 * @param agentName - Agent display name for reporting
 * @param skillsPaths - Agent's skill paths from plugin.meta.skillsPaths
 * @param options - Installation options
 */
export async function installSkillsForAgent(
  agentId: string,
  agentName: string,
  skillsPaths: AgentSkillsPaths,
  options: {
    force?: boolean;
    /** Install to personal (global) directory. Default: true */
    personal?: boolean;
    /** Install to repo-local directory */
    repo?: boolean;
    /** Working directory for repo-relative paths */
    cwd?: string;
    /** Specific skill to install (if not set, installs all) */
    skillName?: string;
  } = {}
): Promise<AgentSkillInstallResult> {
  const { force = false, personal = true, repo = false, cwd, skillName } = options;
  const allResults = new Map<string, SkillTargetResult[]>();

  // Build list of targets with their resolved paths and labels
  const targets: Array<{ label: 'personal' | 'repo'; dir: string }> = [];
  if (personal) {
    targets.push({ label: 'personal', dir: resolveSkillsPath(skillsPaths.personal) });
  }
  if (repo) {
    targets.push({ label: 'repo', dir: resolveSkillsPath(skillsPaths.repo, cwd) });
  }

  // Get skills to install
  const bundledSkills = await listBundledSkills();
  const skillsToInstall = skillName
    ? bundledSkills.filter(s => s.name === skillName)
    : bundledSkills;

  // Install to each target directory, preserving per-target results
  for (const skill of skillsToInstall) {
    const skillResults: SkillTargetResult[] = [];
    for (const target of targets) {
      const result = await installSkillTo(skill.name, target.dir, { force });
      skillResults.push({ target: target.label, result });
    }
    allResults.set(skill.name, skillResults);
  }

  // Compute summary flags by checking all target results
  let hasInstalls = false;
  let allSkipped = true;

  for (const targetResults of allResults.values()) {
    for (const { result } of targetResults) {
      if (result.success && !result.skipped) {
        hasInstalls = true;
        allSkipped = false;
      } else if (!result.success) {
        allSkipped = false;
      }
    }
  }

  return {
    agentId,
    agentName,
    skills: allResults,
    hasInstalls,
    allSkipped,
  };
}

/**
 * Get the installation status of skills for an agent.
 *
 * @param skillsPaths - Agent's skill paths from plugin.meta.skillsPaths
 * @param cwd - Working directory for repo-relative paths
 */
export async function getSkillStatusForAgent(
  skillsPaths: AgentSkillsPaths,
  cwd?: string
): Promise<Map<string, { personal: boolean; repo: boolean }>> {
  const status = new Map<string, { personal: boolean; repo: boolean }>();
  const bundledSkills = await listBundledSkills();

  const personalDir = resolveSkillsPath(skillsPaths.personal);
  const repoDir = resolveSkillsPath(skillsPaths.repo, cwd);

  for (const skill of bundledSkills) {
    const personalInstalled = await isSkillInstalledAt(skill.name, personalDir);
    const repoInstalled = await isSkillInstalledAt(skill.name, repoDir);
    status.set(skill.name, { personal: personalInstalled, repo: repoInstalled });
  }

  return status;
}
