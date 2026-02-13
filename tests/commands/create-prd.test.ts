/**
 * ABOUTME: Tests for the create-prd command.
 * Tests argument parsing, bundled skill loading, and PRD creation flow.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  loadBundledPrdSkill,
  parseCreatePrdArgs,
  printCreatePrdHelp,
} from '../../src/commands/create-prd-utils.js';

describe('create-prd command', () => {
  describe('printCreatePrdHelp', () => {
    test('prints help text to console', () => {
      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (msg: string) => logs.push(msg);
      
      printCreatePrdHelp();
      
      console.log = originalLog;
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain('create-prd');
      expect(logs[0]).toContain('--output');
      expect(logs[0]).toContain('--agent');
    });
  });

  describe('parseCreatePrdArgs', () => {
    test('parses --output with path', () => {
      const result = parseCreatePrdArgs(['--output', './docs']);
      expect(result.output).toBe('./docs');
    });

    test('parses -o shorthand', () => {
      const result = parseCreatePrdArgs(['-o', './custom']);
      expect(result.output).toBe('./custom');
    });

    test('parses --agent with name', () => {
      const result = parseCreatePrdArgs(['--agent', 'kiro']);
      expect(result.agent).toBe('kiro');
    });

    test('parses -a shorthand', () => {
      const result = parseCreatePrdArgs(['-a', 'claude']);
      expect(result.agent).toBe('claude');
    });

    test('parses --stories with count', () => {
      const result = parseCreatePrdArgs(['--stories', '10']);
      expect(result.stories).toBe(10);
    });

    test('parses -n shorthand for stories', () => {
      const result = parseCreatePrdArgs(['-n', '5']);
      expect(result.stories).toBe(5);
    });

    test('ignores invalid stories value', () => {
      const result = parseCreatePrdArgs(['--stories', 'invalid']);
      expect(result.stories).toBeUndefined();
    });

    test('parses --timeout with value', () => {
      const result = parseCreatePrdArgs(['--timeout', '300000']);
      expect(result.timeout).toBe(300000);
    });

    test('parses --timeout 0 for no timeout', () => {
      const result = parseCreatePrdArgs(['--timeout', '0']);
      expect(result.timeout).toBe(0);
    });

    test('parses -t shorthand', () => {
      const result = parseCreatePrdArgs(['-t', '60000']);
      expect(result.timeout).toBe(60000);
    });

    test('parses --prd-skill with name', () => {
      const result = parseCreatePrdArgs(['--prd-skill', 'my-custom-skill']);
      expect(result.prdSkill).toBe('my-custom-skill');
    });

    test('parses --force flag', () => {
      const result = parseCreatePrdArgs(['--force']);
      expect(result.force).toBe(true);
    });

    test('parses -f shorthand', () => {
      const result = parseCreatePrdArgs(['-f']);
      expect(result.force).toBe(true);
    });

    test('parses --cwd with path', () => {
      const result = parseCreatePrdArgs(['--cwd', '/custom/path']);
      expect(result.cwd).toBe('/custom/path');
    });

    test('parses -C shorthand', () => {
      const result = parseCreatePrdArgs(['-C', '/another/path']);
      expect(result.cwd).toBe('/another/path');
    });

    test('parses multiple options together', () => {
      const result = parseCreatePrdArgs([
        '--agent', 'kiro',
        '--output', './tasks',
        '--timeout', '0',
        '--force',
      ]);
      expect(result.agent).toBe('kiro');
      expect(result.output).toBe('./tasks');
      expect(result.timeout).toBe(0);
      expect(result.force).toBe(true);
    });

    test('returns empty object for no args', () => {
      const result = parseCreatePrdArgs([]);
      expect(result).toEqual({});
    });

    test('ignores invalid timeout value', () => {
      const result = parseCreatePrdArgs(['--timeout', 'invalid']);
      expect(result.timeout).toBeUndefined();
    });
  });

  describe('loadBundledPrdSkill', () => {
    let tempDir: string;
    let originalHome: string | undefined;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'ralph-test-'));
      originalHome = process.env.HOME;
      process.env.HOME = tempDir;
    });

    afterEach(async () => {
      process.env.HOME = originalHome;
      await rm(tempDir, { recursive: true, force: true });
    });

    test('loads skill from personal skills directory', async () => {
      // Create mock skill directory structure
      const skillsDir = join(tempDir, '.kiro', 'skills', 'ralph-tui-prd');
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, 'SKILL.md'),
        '---\nname: ralph-tui-prd\n---\n# Test Skill Content'
      );

      // Create mock agent with skillsPaths
      const mockAgent = {
        meta: {
          id: 'kiro',
          name: 'Kiro CLI',
          skillsPaths: {
            personal: '~/.kiro/skills',
            repo: '.kiro/skills',
          },
        },
      };

      const result = await loadBundledPrdSkill(mockAgent as any);
      expect(result).toContain('# Test Skill Content');
    });

    test('returns undefined when skill not found', async () => {
      const mockAgent = {
        meta: {
          id: 'kiro',
          name: 'Kiro CLI',
          skillsPaths: {
            personal: '~/.kiro/skills',
            repo: '.kiro/skills',
          },
        },
      };

      const result = await loadBundledPrdSkill(mockAgent as any);
      expect(result).toBeUndefined();
    });

    test('returns undefined when agent has no skillsPaths', async () => {
      const mockAgent = {
        meta: {
          id: 'claude',
          name: 'Claude Code',
        },
      };

      const result = await loadBundledPrdSkill(mockAgent as any);
      expect(result).toBeUndefined();
    });

    test('prefers personal skills over repo skills', async () => {
      // Create both personal and repo skill directories
      const personalSkillsDir = join(tempDir, '.kiro', 'skills', 'ralph-tui-prd');
      await mkdir(personalSkillsDir, { recursive: true });
      await writeFile(
        join(personalSkillsDir, 'SKILL.md'),
        '# Personal Skill'
      );

      const repoSkillsDir = join(tempDir, 'project', '.kiro', 'skills', 'ralph-tui-prd');
      await mkdir(repoSkillsDir, { recursive: true });
      await writeFile(
        join(repoSkillsDir, 'SKILL.md'),
        '# Repo Skill'
      );

      const mockAgent = {
        meta: {
          id: 'kiro',
          name: 'Kiro CLI',
          skillsPaths: {
            personal: '~/.kiro/skills',
            repo: '.kiro/skills',
          },
        },
      };

      const result = await loadBundledPrdSkill(mockAgent as any);
      expect(result).toContain('# Personal Skill');
    });

    test('falls back to repo skills when personal not found', async () => {
      // Create only repo skill directory (no personal)
      const repoSkillsDir = join(tempDir, 'project', '.kiro', 'skills', 'ralph-tui-prd');
      await mkdir(repoSkillsDir, { recursive: true });
      await writeFile(
        join(repoSkillsDir, 'SKILL.md'),
        '# Repo Skill Content'
      );

      // Change to the project directory so repo path resolves
      const originalCwd = process.cwd();
      process.chdir(join(tempDir, 'project'));

      const mockAgent = {
        meta: {
          id: 'kiro',
          name: 'Kiro CLI',
          skillsPaths: {
            personal: join(tempDir, 'nonexistent', 'skills'),
            repo: '.kiro/skills',
          },
        },
      };

      const result = await loadBundledPrdSkill(mockAgent as any);
      process.chdir(originalCwd);
      
      expect(result).toContain('# Repo Skill Content');
    });
  });
});
