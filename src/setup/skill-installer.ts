/**
 * ABOUTME: Skill installation utility for ralph-tui.
 * Provides functions to list bundled skills, check installation status,
 * and install skills via Vercel's add-skill CLI.
 */

import { spawn } from 'node:child_process';
import { readFile, access, constants, readdir } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Mapping from ralph-tui agent IDs to add-skill agent IDs.
 */
export const AGENT_ID_MAP: Record<string, string> = {
  claude: 'claude-code',
  opencode: 'opencode',
  codex: 'codex',
  gemini: 'gemini',
  kiro: 'kiro',
  cursor: 'cursor',
  'github-copilot': 'github-copilot',
};

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
 * Options for installing skills via add-skill CLI.
 */
export interface AddSkillInstallOptions {
  /** Ralph-tui agent ID (e.g., 'claude', 'opencode') */
  agentId: string;
  /** Specific skill to install (if not set, installs all) */
  skillName?: string;
  /** Install globally (default: true) */
  global?: boolean;
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
 * Resolve the add-skill agent ID from a ralph-tui agent ID.
 * Returns the original ID if no mapping exists (add-skill may support it directly).
 */
export function resolveAddSkillAgentId(ralphTuiId: string): string {
  return AGENT_ID_MAP[ralphTuiId] ?? ralphTuiId;
}

/**
 * Build the bunx add-skill command arguments from install options.
 */
export function buildAddSkillInstallArgs(options: AddSkillInstallOptions): string[] {
  const args = ['add-skill', 'subsy/ralph-tui'];

  // Skill selection
  if (options.skillName) {
    args.push('-s', options.skillName);
  }

  // Agent targeting
  const addSkillId = resolveAddSkillAgentId(options.agentId);
  args.push('-a', addSkillId);

  // Global vs local
  if (options.global !== false) {
    args.push('-g');
  }

  // Non-interactive
  args.push('-y');

  return args;
}

/**
 * Check if a non-zero exit from add-skill is due only to ELOOP errors.
 * ELOOP errors are harmless when agent skill directories are symlinked
 * to a shared location (e.g., ~/.agents/skills/). The skill is still
 * accessible via the symlink even though mkdir fails inside it.
 */
export function isEloopOnlyFailure(output: string): boolean {
  return output.includes('ELOOP') &&
    !output.includes('ENOENT') && !output.includes('EACCES');
}

/**
 * Install skills for an agent via Vercel's add-skill CLI.
 * Spawns bunx add-skill as a subprocess with piped output.
 *
 * @returns Object with success boolean and captured output
 */
export async function installViaAddSkill(options: AddSkillInstallOptions): Promise<{
  success: boolean;
  output: string;
}> {
  const args = buildAddSkillInstallArgs(options);

  return new Promise((resolve) => {
    const child = spawn('bunx', args, {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        output: `Failed to run add-skill: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      const eloopOnly = code !== 0 && isEloopOnlyFailure(output);
      resolve({
        success: code === 0 || eloopOnly,
        output,
      });
    });
  });
}

/**
 * Get the installation status of skills for an agent.
 *
 * @param skillsPaths - Object with personal and repo path strings
 * @param cwd - Working directory for repo-relative paths
 */
export async function getSkillStatusForAgent(
  skillsPaths: { personal: string; repo: string },
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
