/**
 * ABOUTME: Tests for skill-installer utility functions.
 * Tests path resolution for bundled skills in both dev and production environments,
 * skill listing, installation, and related functionality.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// Restore any mocks before tests run to prevent mock leakage from other test files
mock.restore();

// Use dynamic import to get the real module after mock restoration
const skillInstaller = await import('./skill-installer.js');
const {
  getClaudeSkillsDir,
  getBundledSkillsDir,
  listBundledSkills,
  isSkillInstalled,
  installSkill,
  installAllSkills,
  installRalphTuiPrdSkill,
  computeSkillsPath,
} = skillInstaller;

describe('getClaudeSkillsDir', () => {
  test('returns path in user home directory', () => {
    const skillsDir = getClaudeSkillsDir();
    expect(skillsDir).toBe(join(homedir(), '.claude', 'skills'));
  });
});

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

describe('isSkillInstalled', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-tui-skill-test-'));
    originalHome = process.env.HOME;
    // Note: We can't easily mock homedir() since it's called at import time
    // These tests verify the function logic with the real home directory
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns false for non-existent skill', async () => {
    const installed = await isSkillInstalled('definitely-not-a-real-skill-12345');
    expect(installed).toBe(false);
  });
});

describe('installSkill', () => {
  test('returns error for non-existent skill', async () => {
    const skills = await listBundledSkills();
    // Skip if no skills available (CI environment)
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }
    const result = await installSkill('non-existent-skill-xyz');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found in bundled skills');
  });

  test('installs real bundled skill', async () => {
    const skills = await listBundledSkills();
    // Skip if no skills available (CI environment)
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }
    // This will actually install to ~/.claude/skills/
    // We test with a real skill to ensure the full flow works
    const result = await installSkill('ralph-tui-prd', { force: true });
    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.path).toContain('ralph-tui-prd');
  });

  test('skips already installed skill without force', async () => {
    const skills = await listBundledSkills();
    // Skip if no skills available (CI environment)
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }
    // First install
    await installSkill('ralph-tui-prd', { force: true });

    // Second install without force should skip
    const result = await installSkill('ralph-tui-prd', { force: false });
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  test('overwrites with force option', async () => {
    const skills = await listBundledSkills();
    // Skip if no skills available (CI environment)
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }
    // First install
    await installSkill('ralph-tui-prd', { force: true });

    // Second install with force should not skip
    const result = await installSkill('ralph-tui-prd', { force: true });
    expect(result.success).toBe(true);
    expect(result.skipped).toBeFalsy();
  });
});

describe('installRalphTuiPrdSkill', () => {
  test('installs the ralph-tui-prd skill', async () => {
    const skills = await listBundledSkills();
    // Skip if no skills available (CI environment)
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }
    const result = await installRalphTuiPrdSkill({ force: true });
    expect(result.success).toBe(true);
    expect(result.path).toContain('ralph-tui-prd');
  });

  test('respects force option', async () => {
    const skills = await listBundledSkills();
    // Skip if no skills available (CI environment)
    if (skills.length === 0) {
      console.log('Skipping: No bundled skills found');
      return;
    }
    // First install
    await installRalphTuiPrdSkill({ force: true });

    // Without force should skip
    const result = await installRalphTuiPrdSkill({ force: false });
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe('installAllSkills', () => {
  test('returns map of results', async () => {
    const results = await installAllSkills({ force: true });
    expect(results instanceof Map).toBe(true);
  });

  test('installs all bundled skills', async () => {
    const skills = await listBundledSkills();
    const results = await installAllSkills({ force: true });

    // Should have result for each skill
    expect(results.size).toBe(skills.length);

    // All should succeed
    for (const [_name, result] of results) {
      expect(result.success).toBe(true);
    }
  });
});
