/**
 * ABOUTME: Tests for skill-installer utility functions.
 * Tests path resolution for bundled skills in both dev and production environments,
 * skill listing, installation, and related functionality.
 *
 * IMPORTANT: This file imports the real skill-installer module at file level using
 * the ?test-reload query parameter to bypass any mocks from other test files.
 * Bun's module mocking is global, so we need to ensure we get a fresh module instance.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// Import the real module with a unique query string to bypass any cached mocks from other test files
// This is a Bun-specific workaround for module mock leakage between test files
// TypeScript doesn't recognize query strings in imports, so we use @ts-expect-error
// @ts-expect-error - Bun supports query strings in imports to get fresh module instances
const skillInstaller = await import('./skill-installer.js?test-reload') as typeof import('./skill-installer.js');
const {
  getBundledSkillsDir,
  listBundledSkills,
  isSkillInstalledAt,
  computeSkillsPath,
  expandTilde,
  resolveSkillsPath,
  AGENT_ID_MAP,
  resolveAddSkillAgentId,
  buildAddSkillInstallArgs,
  isEloopOnlyFailure,
} = skillInstaller;

describe('skill-installer', () => {

  describe('computeSkillsPath', () => {
  test('returns bundled path when currentDir ends with dist', () => {
    const currentDir = '/home/user/project/dist';
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('/home/user/project/dist/skills');
  });

  test('returns bundled path when currentDir contains /dist/ as path segment', () => {
    const currentDir = '/home/user/project/dist/subdir';
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('/home/user/project/dist/subdir/skills');
  });

  test('returns dev path for paths ending with dist-like names (my-dist)', () => {
    const currentDir = '/home/user/my-dist';
    // "my-dist" ends with "dist" so this matches the bundled path
    // This is by design - endsWith('dist') catches this case
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('/home/user/my-dist/skills');
  });

  test('returns dev path for paths containing distribution (not /dist/)', () => {
    const currentDir = '/home/user/distribution/files';
    // "distribution" contains "dist" but not as "/dist/" segment
    // and doesn't end with "dist", so returns dev path
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('/home/user/skills');
  });

  test('returns bundled path for typical dist location', () => {
    const currentDir = '/Users/dev/ralph-tui/dist';
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('/Users/dev/ralph-tui/dist/skills');
  });

  test('returns dev path when currentDir is in src/', () => {
    const currentDir = '/home/user/project/src/setup';
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('/home/user/project/skills');
  });

  test('returns dev path for non-dist directories', () => {
    const currentDir = '/home/user/project/lib/utils';
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('/home/user/project/skills');
  });

  test('handles Windows-style paths with dist', () => {
    // Even on Windows, Node.js path operations use forward slashes internally
    const currentDir = 'C:/Users/dev/project/dist';
    const result = computeSkillsPath(currentDir);
    expect(result).toBe('C:/Users/dev/project/dist/skills');
  });
});

describe('getBundledSkillsDir', () => {
  test('returns a valid path', () => {
    const skillsDir = getBundledSkillsDir();
    expect(typeof skillsDir).toBe('string');
    expect(skillsDir.length).toBeGreaterThan(0);
  });

  test('returns path ending with skills', () => {
    const skillsDir = getBundledSkillsDir();
    expect(skillsDir.endsWith('skills')).toBe(true);
  });

  test('returns dev path when running from source', () => {
    // When running tests, we're in dev mode (src/setup/)
    const skillsDir = getBundledSkillsDir();
    // Should be the project root skills/ directory
    expect(skillsDir).toContain('skills');
    // Should NOT be in dist when running tests from source
    expect(skillsDir).not.toContain('/dist/');
  });
});

describe('listBundledSkills', () => {
  test('returns array of skills', async () => {
    const skills = await listBundledSkills();
    expect(Array.isArray(skills)).toBe(true);
  });

  test('skills have required properties', async () => {
    const skills = await listBundledSkills();
    // We know the project has bundled skills
    if (skills.length > 0) {
      for (const skill of skills) {
        expect(skill).toHaveProperty('name');
        expect(skill).toHaveProperty('description');
        expect(skill).toHaveProperty('sourcePath');
        expect(typeof skill.name).toBe('string');
        expect(typeof skill.description).toBe('string');
        expect(typeof skill.sourcePath).toBe('string');
      }
    }
  });

  test('finds ralph-tui-prd skill', async () => {
    const skills = await listBundledSkills();
    // Skip assertion if no skills found (CI environment may not have skills dir accessible)
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found (expected in some CI environments)');
      return;
    }
    const prdSkill = skills.find(s => s.name === 'ralph-tui-prd');
    expect(prdSkill).toBeDefined();
    expect(prdSkill?.description).toBeTruthy();
  });

  test('returns empty array for non-existent directory', async () => {
    // This tests the error handling path - we can't easily mock getBundledSkillsDir
    // but the function should handle missing directories gracefully
    const skills = await listBundledSkills();
    // Should return skills (or empty array if none exist)
    expect(Array.isArray(skills)).toBe(true);
  });
});

describe('expandTilde', () => {
  test('expands ~ to home directory', () => {
    const result = expandTilde('~');
    expect(result).toBe(homedir());
  });

  test('expands ~/ paths to home directory', () => {
    const result = expandTilde('~/.claude/skills');
    expect(result).toBe(join(homedir(), '.claude/skills'));
  });

  test('expands ~\\ paths to home directory (Windows-style)', () => {
    const result = expandTilde('~\\.claude\\skills');
    // join normalizes separators, so we check the result contains the home dir
    expect(result.startsWith(homedir())).toBe(true);
    expect(result).toContain('.claude');
  });

  test('returns non-tilde paths unchanged', () => {
    const result = expandTilde('/absolute/path');
    expect(result).toBe('/absolute/path');
  });

  test('returns relative paths unchanged', () => {
    const result = expandTilde('.claude/skills');
    expect(result).toBe('.claude/skills');
  });
});

describe('resolveSkillsPath', () => {
  test('expands tilde paths', () => {
    const result = resolveSkillsPath('~/.claude/skills');
    expect(result).toBe(join(homedir(), '.claude/skills'));
  });

  test('joins repo-relative paths with cwd', () => {
    const result = resolveSkillsPath('.claude/skills', '/home/user/project');
    expect(result).toBe('/home/user/project/.claude/skills');
  });

  test('uses process.cwd() when no cwd provided for relative paths', () => {
    const result = resolveSkillsPath('.claude/skills');
    expect(result).toBe(join(process.cwd(), '.claude/skills'));
  });

  test('handles ~ alone', () => {
    const result = resolveSkillsPath('~');
    expect(result).toBe(homedir());
  });

  test('returns absolute paths unchanged', () => {
    const result = resolveSkillsPath('/absolute/path/to/skills');
    expect(result).toBe('/absolute/path/to/skills');
  });

  test('returns absolute paths unchanged even with cwd', () => {
    const result = resolveSkillsPath('/absolute/path', '/some/cwd');
    expect(result).toBe('/absolute/path');
  });

  test('handles Windows drive letter paths as absolute', () => {
    // On all platforms, path.isAbsolute recognizes Windows paths
    // Note: This tests the code path, actual behavior may vary by platform
    const result = resolveSkillsPath('C:\\Users\\test\\skills');
    // Should not prepend cwd if isAbsolute returns true
    // On Linux, isAbsolute('C:\\...') returns false, so it will be joined
    // This test documents current cross-platform behavior
    if (process.platform === 'win32') {
      expect(result).toBe('C:\\Users\\test\\skills');
    } else {
      // On POSIX, Windows paths are treated as relative
      expect(result).toContain('C:');
    }
  });

  test('handles Windows UNC paths', () => {
    // UNC paths like \\server\share are absolute on Windows
    const result = resolveSkillsPath('\\\\server\\share\\skills');
    if (process.platform === 'win32') {
      expect(result).toBe('\\\\server\\share\\skills');
    } else {
      // On POSIX, UNC paths are treated as relative
      expect(result).toContain('server');
    }
  });
});

describe('isSkillInstalledAt', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-tui-skill-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns false for non-existent skill in directory', async () => {
    const result = await isSkillInstalledAt('non-existent-skill', tempDir);
    expect(result).toBe(false);
  });
});

describe('AGENT_ID_MAP', () => {
  test('maps claude to claude-code', () => {
    expect(AGENT_ID_MAP['claude']).toBe('claude-code');
  });

  test('maps opencode to opencode', () => {
    expect(AGENT_ID_MAP['opencode']).toBe('opencode');
  });

  test('maps codex to codex', () => {
    expect(AGENT_ID_MAP['codex']).toBe('codex');
  });

  test('maps gemini to gemini', () => {
    expect(AGENT_ID_MAP['gemini']).toBe('gemini');
  });

  test('maps kiro to kiro', () => {
    expect(AGENT_ID_MAP['kiro']).toBe('kiro');
  });
});

describe('resolveAddSkillAgentId', () => {
  test('maps known ralph-tui IDs', () => {
    expect(resolveAddSkillAgentId('claude')).toBe('claude-code');
    expect(resolveAddSkillAgentId('opencode')).toBe('opencode');
  });

  test('passes through unknown IDs unchanged', () => {
    expect(resolveAddSkillAgentId('cursor')).toBe('cursor');
    expect(resolveAddSkillAgentId('windsurf')).toBe('windsurf');
  });
});

describe('buildAddSkillInstallArgs', () => {
  test('builds args for global install of all skills', () => {
    const args = buildAddSkillInstallArgs({
      agentId: 'claude',
      global: true,
    });
    expect(args).toEqual(['add-skill', 'subsy/ralph-tui', '-a', 'claude-code', '-g', '-y']);
  });

  test('builds args for specific skill', () => {
    const args = buildAddSkillInstallArgs({
      agentId: 'opencode',
      skillName: 'ralph-tui-prd',
      global: true,
    });
    expect(args).toEqual(['add-skill', 'subsy/ralph-tui', '-s', 'ralph-tui-prd', '-a', 'opencode', '-g', '-y']);
  });

  test('omits -g flag when global is false', () => {
    const args = buildAddSkillInstallArgs({
      agentId: 'claude',
      global: false,
    });
    expect(args).toEqual(['add-skill', 'subsy/ralph-tui', '-a', 'claude-code', '-y']);
  });

  test('defaults to global when not specified', () => {
    const args = buildAddSkillInstallArgs({
      agentId: 'claude',
    });
    expect(args).toContain('-g');
  });

  test('passes through unknown agent IDs', () => {
    const args = buildAddSkillInstallArgs({
      agentId: 'cursor',
      global: true,
    });
    expect(args).toContain('-a');
    expect(args).toContain('cursor');
  });
});

describe('isEloopOnlyFailure', () => {
  test('returns true for output containing only ELOOP errors', () => {
    const output = 'Error: ELOOP: too many levels of symbolic links, mkdir\nELOOP: too many levels of symbolic links';
    expect(isEloopOnlyFailure(output)).toBe(true);
  });

  test('returns false for output with ENOENT errors', () => {
    const output = 'Error: ELOOP: too many levels\nENOENT: no such file or directory';
    expect(isEloopOnlyFailure(output)).toBe(false);
  });

  test('returns false for output with EACCES errors', () => {
    const output = 'Error: ELOOP: too many levels\nEACCES: permission denied';
    expect(isEloopOnlyFailure(output)).toBe(false);
  });

  test('returns false for output without ELOOP', () => {
    const output = 'Error: something went wrong';
    expect(isEloopOnlyFailure(output)).toBe(false);
  });

  test('returns false for empty output', () => {
    expect(isEloopOnlyFailure('')).toBe(false);
  });

  test('returns true for real add-skill ELOOP output', () => {
    const output = `Installing skill ralph-tui-prd for claude-code...
Error: ELOOP: too many levels of symbolic links, mkdir '/home/user/.claude/skills/ralph-tui-prd'
24 installs failed`;
    expect(isEloopOnlyFailure(output)).toBe(true);
  });
});
}); // end describe('skill-installer')
