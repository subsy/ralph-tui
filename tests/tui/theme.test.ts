/**
 * ABOUTME: Tests for the TUI theme module.
 * Tests utility functions, constants, and color mappings.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  colors,
  statusIndicators,
  keyboardShortcuts,
  fullKeyboardShortcuts,
  layout,
  getTaskStatusColor,
  getTaskStatusIndicator,
  formatElapsedTime,
  mergeTheme,
  defaultThemeColors,
  defaultColors,
  initializeTheme,
  resetTheme,
  loadThemeFile,
  isValidHexColor,
  type RalphStatus,
  type TaskStatus,
  type ThemeColors,
  type PartialThemeColors,
} from '../../src/tui/theme.js';

describe('theme', () => {
  describe('colors', () => {
    test('should have background colors defined', () => {
      expect(colors.bg.primary).toBeDefined();
      expect(colors.bg.secondary).toBeDefined();
      expect(colors.bg.tertiary).toBeDefined();
      expect(colors.bg.highlight).toBeDefined();
    });

    test('should have foreground colors defined', () => {
      expect(colors.fg.primary).toBeDefined();
      expect(colors.fg.secondary).toBeDefined();
      expect(colors.fg.muted).toBeDefined();
      expect(colors.fg.dim).toBeDefined();
    });

    test('should have status colors defined', () => {
      expect(colors.status.success).toBeDefined();
      expect(colors.status.warning).toBeDefined();
      expect(colors.status.error).toBeDefined();
      expect(colors.status.info).toBeDefined();
    });

    test('should have task status colors defined', () => {
      expect(colors.task.done).toBeDefined();
      expect(colors.task.active).toBeDefined();
      expect(colors.task.actionable).toBeDefined();
      expect(colors.task.pending).toBeDefined();
      expect(colors.task.blocked).toBeDefined();
      expect(colors.task.error).toBeDefined();
      expect(colors.task.closed).toBeDefined();
    });

    test('should have accent colors defined', () => {
      expect(colors.accent.primary).toBeDefined();
      expect(colors.accent.secondary).toBeDefined();
      expect(colors.accent.tertiary).toBeDefined();
    });

    test('should have border colors defined', () => {
      expect(colors.border.normal).toBeDefined();
      expect(colors.border.active).toBeDefined();
      expect(colors.border.muted).toBeDefined();
    });

    test('should have valid hex color format', () => {
      const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
      expect(colors.bg.primary).toMatch(hexColorRegex);
      expect(colors.fg.primary).toMatch(hexColorRegex);
      expect(colors.status.success).toMatch(hexColorRegex);
    });
  });

  describe('statusIndicators', () => {
    test('should have task status indicators', () => {
      expect(statusIndicators.done).toBeDefined();
      expect(statusIndicators.active).toBeDefined();
      expect(statusIndicators.actionable).toBeDefined();
      expect(statusIndicators.pending).toBeDefined();
      expect(statusIndicators.blocked).toBeDefined();
      expect(statusIndicators.error).toBeDefined();
      expect(statusIndicators.closed).toBeDefined();
    });

    test('should have ralph status indicators', () => {
      expect(statusIndicators.running).toBeDefined();
      expect(statusIndicators.selecting).toBeDefined();
      expect(statusIndicators.executing).toBeDefined();
      expect(statusIndicators.pausing).toBeDefined();
      expect(statusIndicators.paused).toBeDefined();
      expect(statusIndicators.stopped).toBeDefined();
      expect(statusIndicators.complete).toBeDefined();
      expect(statusIndicators.idle).toBeDefined();
      expect(statusIndicators.ready).toBeDefined();
    });

    test('should use single character indicators', () => {
      // All indicators should be single characters (Unicode okay)
      Object.values(statusIndicators).forEach((indicator) => {
        expect(indicator.length).toBeLessThanOrEqual(2); // Unicode chars can be 2 code units
      });
    });
  });

  describe('keyboardShortcuts', () => {
    test('should have shortcuts defined', () => {
      expect(keyboardShortcuts.length).toBeGreaterThan(0);
    });

    test('should have key and description for each shortcut', () => {
      keyboardShortcuts.forEach((shortcut) => {
        expect(shortcut.key).toBeDefined();
        expect(shortcut.description).toBeDefined();
        expect(shortcut.key.length).toBeGreaterThan(0);
        expect(shortcut.description.length).toBeGreaterThan(0);
      });
    });

    test('should have quit shortcut', () => {
      const quitShortcut = keyboardShortcuts.find((s) => s.key === 'q');
      expect(quitShortcut).toBeDefined();
      expect(quitShortcut?.description.toLowerCase()).toContain('quit');
    });

    test('should have help shortcut', () => {
      const helpShortcut = keyboardShortcuts.find((s) => s.key === '?');
      expect(helpShortcut).toBeDefined();
    });
  });

  describe('fullKeyboardShortcuts', () => {
    test('should have more shortcuts than condensed version', () => {
      expect(fullKeyboardShortcuts.length).toBeGreaterThan(keyboardShortcuts.length);
    });

    test('should have category for each shortcut', () => {
      fullKeyboardShortcuts.forEach((shortcut) => {
        expect(shortcut.key).toBeDefined();
        expect(shortcut.description).toBeDefined();
        expect(shortcut.category).toBeDefined();
      });
    });

    test('should have common categories', () => {
      const categories = new Set(fullKeyboardShortcuts.map((s) => s.category));
      expect(categories.has('General')).toBe(true);
      expect(categories.has('Execution')).toBe(true);
    });
  });

  describe('layout', () => {
    test('should have header dimensions', () => {
      expect(layout.header.height).toBeDefined();
      expect(layout.header.height).toBeGreaterThan(0);
    });

    test('should have footer dimensions', () => {
      expect(layout.footer.height).toBeDefined();
      expect(layout.footer.height).toBeGreaterThan(0);
    });

    test('should have left panel constraints', () => {
      expect(layout.leftPanel.minWidth).toBeDefined();
      expect(layout.leftPanel.maxWidth).toBeDefined();
      expect(layout.leftPanel.defaultWidthPercent).toBeDefined();
      expect(layout.leftPanel.minWidth).toBeLessThan(layout.leftPanel.maxWidth);
    });

    test('should have right panel constraints', () => {
      expect(layout.rightPanel.minWidth).toBeDefined();
    });

    test('should have padding values', () => {
      expect(layout.padding.small).toBeDefined();
      expect(layout.padding.medium).toBeDefined();
      expect(layout.padding.small).toBeLessThan(layout.padding.medium);
    });

    test('should have progress dashboard height', () => {
      expect(layout.progressDashboard.height).toBeDefined();
      expect(layout.progressDashboard.height).toBeGreaterThan(0);
    });
  });

  describe('getTaskStatusColor', () => {
    const taskStatuses: TaskStatus[] = ['done', 'active', 'actionable', 'pending', 'blocked', 'error', 'closed'];

    test('should return valid color for all task statuses', () => {
      taskStatuses.forEach((status) => {
        const color = getTaskStatusColor(status);
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });

    test('should return green for done status', () => {
      expect(getTaskStatusColor('done')).toBe(colors.task.done);
    });

    test('should return blue for active status', () => {
      expect(getTaskStatusColor('active')).toBe(colors.task.active);
    });

    test('should return red for blocked status', () => {
      expect(getTaskStatusColor('blocked')).toBe(colors.task.blocked);
    });

    test('should return grey for pending status', () => {
      expect(getTaskStatusColor('pending')).toBe(colors.task.pending);
    });
  });

  describe('getTaskStatusIndicator', () => {
    const taskStatuses: TaskStatus[] = ['done', 'active', 'actionable', 'pending', 'blocked', 'error', 'closed'];

    test('should return indicator for all task statuses', () => {
      taskStatuses.forEach((status) => {
        const indicator = getTaskStatusIndicator(status);
        expect(indicator).toBeDefined();
        expect(indicator.length).toBeGreaterThan(0);
      });
    });

    test('should return checkmark for done status', () => {
      expect(getTaskStatusIndicator('done')).toBe(statusIndicators.done);
      expect(getTaskStatusIndicator('done')).toBe('✓');
    });

    test('should return play triangle for active status (currently running)', () => {
      expect(getTaskStatusIndicator('active')).toBe(statusIndicators.active);
      expect(getTaskStatusIndicator('active')).toBe('▶');
    });

    test('should return circle for actionable status (ready to work on)', () => {
      expect(getTaskStatusIndicator('actionable')).toBe(statusIndicators.actionable);
      expect(getTaskStatusIndicator('actionable')).toBe('○');
    });

    test('should return no-entry symbol for blocked status', () => {
      expect(getTaskStatusIndicator('blocked')).toBe(statusIndicators.blocked);
      expect(getTaskStatusIndicator('blocked')).toBe('⊘');
    });

    test('should return X for error status', () => {
      expect(getTaskStatusIndicator('error')).toBe(statusIndicators.error);
      expect(getTaskStatusIndicator('error')).toBe('✗');
    });

    test('should return checkmark for closed status (greyed)', () => {
      expect(getTaskStatusIndicator('closed')).toBe(statusIndicators.closed);
      expect(getTaskStatusIndicator('closed')).toBe('✓');
    });
  });

  describe('task status colors (Issue 180)', () => {
    test('active status should be green (same as done)', () => {
      // Active tasks (currently running) should be green, not blue
      expect(colors.task.active).toBe('#9ece6a');
      expect(colors.task.active).toBe(colors.task.done);
    });

    test('actionable status should be green', () => {
      // Actionable tasks (ready to work on) should be green
      expect(colors.task.actionable).toBe('#9ece6a');
    });

    test('blocked and error status should be red', () => {
      // Blocked and error tasks should be red
      expect(colors.task.blocked).toBe('#f7768e');
      expect(colors.task.error).toBe('#f7768e');
      expect(colors.task.blocked).toBe(colors.task.error);
    });

    test('pending status should be grey/muted', () => {
      expect(colors.task.pending).toBe('#565f89');
    });

    test('closed status should be dimmed', () => {
      expect(colors.task.closed).toBe('#414868');
    });
  });

  describe('formatElapsedTime', () => {
    test('should format seconds only', () => {
      expect(formatElapsedTime(0)).toBe('0s');
      expect(formatElapsedTime(1)).toBe('1s');
      expect(formatElapsedTime(30)).toBe('30s');
      expect(formatElapsedTime(59)).toBe('59s');
    });

    test('should format minutes and seconds', () => {
      expect(formatElapsedTime(60)).toBe('1m 0s');
      expect(formatElapsedTime(61)).toBe('1m 1s');
      expect(formatElapsedTime(90)).toBe('1m 30s');
      expect(formatElapsedTime(125)).toBe('2m 5s');
      expect(formatElapsedTime(3599)).toBe('59m 59s');
    });

    test('should format hours, minutes, and seconds', () => {
      expect(formatElapsedTime(3600)).toBe('1h 0m 0s');
      expect(formatElapsedTime(3661)).toBe('1h 1m 1s');
      expect(formatElapsedTime(7200)).toBe('2h 0m 0s');
      expect(formatElapsedTime(7325)).toBe('2h 2m 5s');
    });

    test('should handle large values', () => {
      expect(formatElapsedTime(86400)).toBe('24h 0m 0s');
      expect(formatElapsedTime(90061)).toBe('25h 1m 1s');
    });
  });

  describe('mergeTheme', () => {
    test('empty custom theme returns all default values', () => {
      const result = mergeTheme({});

      expect(result).toEqual(defaultThemeColors);
      expect(result.bg.primary).toBe('#1a1b26');
      expect(result.fg.primary).toBe('#c0caf5');
      expect(result.status.success).toBe('#9ece6a');
      expect(result.task.done).toBe('#9ece6a');
      expect(result.accent.primary).toBe('#7aa2f7');
      expect(result.border.normal).toBe('#3d4259');
    });

    test('partial category (just bg.primary) preserves other keys in that category', () => {
      const customTheme: PartialThemeColors = {
        bg: { primary: '#000000' },
      };

      const result = mergeTheme(customTheme);

      expect(result.bg.primary).toBe('#000000');
      expect(result.bg.secondary).toBe(defaultThemeColors.bg.secondary);
      expect(result.bg.tertiary).toBe(defaultThemeColors.bg.tertiary);
      expect(result.bg.highlight).toBe(defaultThemeColors.bg.highlight);
    });

    test('full category replacement works correctly', () => {
      const customBg = {
        primary: '#111111',
        secondary: '#222222',
        tertiary: '#333333',
        highlight: '#444444',
      };
      const customTheme: PartialThemeColors = { bg: customBg };

      const result = mergeTheme(customTheme);

      expect(result.bg).toEqual(customBg);
      expect(result.fg).toEqual(defaultThemeColors.fg);
    });

    test('nested merge preserves unspecified sibling keys', () => {
      const customTheme: PartialThemeColors = {
        fg: { primary: '#ffffff', muted: '#888888' },
        status: { error: '#ff0000' },
      };

      const result = mergeTheme(customTheme);

      expect(result.fg.primary).toBe('#ffffff');
      expect(result.fg.secondary).toBe(defaultThemeColors.fg.secondary);
      expect(result.fg.muted).toBe('#888888');
      expect(result.fg.dim).toBe(defaultThemeColors.fg.dim);

      expect(result.status.error).toBe('#ff0000');
      expect(result.status.success).toBe(defaultThemeColors.status.success);
      expect(result.status.warning).toBe(defaultThemeColors.status.warning);
      expect(result.status.info).toBe(defaultThemeColors.status.info);
    });

    test('return type is full ThemeColors structure with all keys defined', () => {
      const customTheme: PartialThemeColors = { accent: { primary: '#abcdef' } };

      const result = mergeTheme(customTheme);

      expect(result.bg).toBeDefined();
      expect(result.bg.primary).toBeDefined();
      expect(result.bg.secondary).toBeDefined();
      expect(result.bg.tertiary).toBeDefined();
      expect(result.bg.highlight).toBeDefined();

      expect(result.fg).toBeDefined();
      expect(result.fg.primary).toBeDefined();
      expect(result.fg.secondary).toBeDefined();
      expect(result.fg.muted).toBeDefined();
      expect(result.fg.dim).toBeDefined();

      expect(result.status).toBeDefined();
      expect(result.status.success).toBeDefined();
      expect(result.status.warning).toBeDefined();
      expect(result.status.error).toBeDefined();
      expect(result.status.info).toBeDefined();

      expect(result.task).toBeDefined();
      expect(result.task.done).toBeDefined();
      expect(result.task.active).toBeDefined();
      expect(result.task.actionable).toBeDefined();
      expect(result.task.pending).toBeDefined();
      expect(result.task.blocked).toBeDefined();
      expect(result.task.error).toBeDefined();
      expect(result.task.closed).toBeDefined();

      expect(result.accent).toBeDefined();
      expect(result.accent.primary).toBe('#abcdef');
      expect(result.accent.secondary).toBeDefined();
      expect(result.accent.tertiary).toBeDefined();

      expect(result.border).toBeDefined();
      expect(result.border.normal).toBeDefined();
      expect(result.border.active).toBeDefined();
      expect(result.border.muted).toBeDefined();
    });

    test('accepts custom defaults parameter', () => {
      const customDefaults: ThemeColors = {
        bg: { primary: '#aaa', secondary: '#bbb', tertiary: '#ccc', highlight: '#ddd' },
        fg: { primary: '#eee', secondary: '#fff', muted: '#111', dim: '#222' },
        status: { success: '#333', warning: '#444', error: '#555', info: '#666' },
        task: {
          done: '#777',
          active: '#888',
          actionable: '#999',
          pending: '#aaa',
          blocked: '#bbb',
          error: '#ccc',
          closed: '#ddd',
        },
        accent: { primary: '#eee', secondary: '#fff', tertiary: '#000' },
        border: { normal: '#111', active: '#222', muted: '#333' },
      };

      const result = mergeTheme({}, customDefaults);

      expect(result).toEqual(customDefaults);
    });

    test('merges multiple categories at once', () => {
      const customTheme: PartialThemeColors = {
        bg: { primary: '#111111' },
        fg: { primary: '#222222' },
        status: { success: '#333333' },
        task: { done: '#444444' },
        accent: { primary: '#555555' },
        border: { normal: '#666666' },
      };

      const result = mergeTheme(customTheme);

      expect(result.bg.primary).toBe('#111111');
      expect(result.fg.primary).toBe('#222222');
      expect(result.status.success).toBe('#333333');
      expect(result.task.done).toBe('#444444');
      expect(result.accent.primary).toBe('#555555');
      expect(result.border.normal).toBe('#666666');

      expect(result.bg.secondary).toBe(defaultThemeColors.bg.secondary);
      expect(result.fg.secondary).toBe(defaultThemeColors.fg.secondary);
    });
  });

  describe('defaultColors', () => {
    test('should have same values as defaultThemeColors', () => {
      expect(defaultColors).toEqual(defaultThemeColors);
    });

    test('should have Tokyo Night primary background', () => {
      expect(defaultColors.bg.primary).toBe('#1a1b26');
    });
  });

  describe('isValidHexColor', () => {
    test('returns true for valid 6-digit hex colors', () => {
      expect(isValidHexColor('#000000')).toBe(true);
      expect(isValidHexColor('#ffffff')).toBe(true);
      expect(isValidHexColor('#FFFFFF')).toBe(true);
      expect(isValidHexColor('#1a1b26')).toBe(true);
      expect(isValidHexColor('#9eCe6A')).toBe(true);
    });

    test('returns false for invalid hex colors', () => {
      expect(isValidHexColor('')).toBe(false);
      expect(isValidHexColor('000000')).toBe(false);
      expect(isValidHexColor('#fff')).toBe(false);
      expect(isValidHexColor('#fffffff')).toBe(false);
      expect(isValidHexColor('#gggggg')).toBe(false);
      expect(isValidHexColor('not-a-color')).toBe(false);
      expect(isValidHexColor('red')).toBe(false);
      expect(isValidHexColor('rgb(255,255,255)')).toBe(false);
    });
  });

  describe('loadThemeFile', () => {
    let testDir: string;
    let testThemePath: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `ralph-theme-load-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
      testThemePath = join(testDir, 'test-theme.json');
    });

    afterEach(async () => {
      try {
        await unlink(testThemePath);
      } catch {
        // File may not exist
      }
      try {
        await rmdir(testDir);
      } catch {
        // Directory may not exist
      }
    });

    test('loads valid complete theme file', async () => {
      const completeTheme: ThemeColors = {
        bg: { primary: '#111111', secondary: '#222222', tertiary: '#333333', highlight: '#444444' },
        fg: { primary: '#555555', secondary: '#666666', muted: '#777777', dim: '#888888' },
        status: { success: '#99aa00', warning: '#aabb00', error: '#bbcc00', info: '#ccdd00' },
        task: {
          done: '#dd0011',
          active: '#dd0022',
          actionable: '#dd0033',
          pending: '#dd0044',
          blocked: '#dd0055',
          error: '#dd0066',
          closed: '#dd0077',
        },
        accent: { primary: '#ee0011', secondary: '#ee0022', tertiary: '#ee0033' },
        border: { normal: '#ff0011', active: '#ff0022', muted: '#ff0033' },
      };
      await writeFile(testThemePath, JSON.stringify(completeTheme));

      const result = await loadThemeFile(testThemePath);

      expect(result).toBeDefined();
      expect(result.bg).toBeDefined();
      expect(result.fg).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.task).toBeDefined();
      expect(result.accent).toBeDefined();
      expect(result.border).toBeDefined();
      expect(result.bg.primary).toBe('#111111');
      expect(result.task.done).toBe('#dd0011');
    });

    test('loads valid partial theme file', async () => {
      const partialTheme = {
        bg: { primary: '#000000' },
        status: { error: '#ff0000' },
      };
      await writeFile(testThemePath, JSON.stringify(partialTheme));

      const result = await loadThemeFile(testThemePath);

      expect(result).toBeDefined();
      expect(result.bg).toBeDefined();
      expect(result.bg.primary).toBe('#000000');
      expect(result.status).toBeDefined();
      expect(result.status.error).toBe('#ff0000');
    });

    test('throws descriptive error for non-existent file', async () => {
      const nonExistentPath = join(testDir, 'does-not-exist.json');

      await expect(loadThemeFile(nonExistentPath)).rejects.toThrow('Theme file not found or not readable');
      await expect(loadThemeFile(nonExistentPath)).rejects.toThrow(nonExistentPath);
    });

    test('throws descriptive error for invalid JSON', async () => {
      await writeFile(testThemePath, '{ invalid json content {{{{');

      await expect(loadThemeFile(testThemePath)).rejects.toThrow('Invalid JSON');
      await expect(loadThemeFile(testThemePath)).rejects.toThrow(testThemePath);
    });

    test('throws error with key path for invalid hex color', async () => {
      const invalidTheme = {
        bg: { primary: '#000000', secondary: 'not-valid-hex' },
        fg: { primary: '#ffffff' },
      };
      await writeFile(testThemePath, JSON.stringify(invalidTheme));

      await expect(loadThemeFile(testThemePath)).rejects.toThrow('bg.secondary');
      await expect(loadThemeFile(testThemePath)).rejects.toThrow('not-valid-hex');
    });

    test('throws error with key path for deeply nested invalid color', async () => {
      const invalidTheme = {
        task: { done: '#000000', active: 'invalid', pending: '#111111' },
      };
      await writeFile(testThemePath, JSON.stringify(invalidTheme));

      await expect(loadThemeFile(testThemePath)).rejects.toThrow('task.active');
      await expect(loadThemeFile(testThemePath)).rejects.toThrow('invalid');
    });

    test('throws error when file contains array JSON', async () => {
      await writeFile(testThemePath, JSON.stringify(['array', 'not', 'object']));

      await expect(loadThemeFile(testThemePath)).rejects.toThrow('Invalid');
    });

    test('throws error when file contains null', async () => {
      await writeFile(testThemePath, JSON.stringify(null));

      await expect(loadThemeFile(testThemePath)).rejects.toThrow('must contain a JSON object');
    });

    test('throws error when file contains primitive JSON', async () => {
      await writeFile(testThemePath, JSON.stringify('just a string'));

      await expect(loadThemeFile(testThemePath)).rejects.toThrow('must contain a JSON object');
    });

    test('loads theme with relative path from cwd', async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        const relativePath = 'test-theme.json';
        const themeContent = { bg: { primary: '#abcdef' } };
        await writeFile(testThemePath, JSON.stringify(themeContent));

        const result = await loadThemeFile(relativePath);

        expect(result.bg.primary).toBe('#abcdef');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('initializeTheme', () => {
    let testDir: string;
    let testThemePath: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `ralph-theme-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
      testThemePath = join(testDir, 'test-theme.json');
      resetTheme();
    });

    afterEach(async () => {
      resetTheme();
      try {
        await unlink(testThemePath);
      } catch {
        // File may not exist
      }
      try {
        await rmdir(testDir);
      } catch {
        // Directory may not exist
      }
    });

    test('initializeTheme with no argument uses default colors', async () => {
      await initializeTheme();

      expect(colors.bg.primary).toBe(defaultColors.bg.primary);
      expect(colors.fg.primary).toBe(defaultColors.fg.primary);
      expect(colors.status.success).toBe(defaultColors.status.success);
    });

    test('initializeTheme with valid path loads and merges custom theme', async () => {
      const customTheme = {
        bg: { primary: '#000000' },
        fg: { primary: '#ffffff' },
      };
      await writeFile(testThemePath, JSON.stringify(customTheme));

      await initializeTheme(testThemePath);

      expect(colors.bg.primary).toBe('#000000');
      expect(colors.fg.primary).toBe('#ffffff');
      expect(colors.bg.secondary).toBe(defaultColors.bg.secondary);
      expect(colors.status.success).toBe(defaultColors.status.success);
    });

    test('initializeTheme with invalid path throws before modifying state', async () => {
      const originalBgPrimary = colors.bg.primary;
      const nonExistentPath = join(testDir, 'non-existent-theme.json');

      await expect(initializeTheme(nonExistentPath)).rejects.toThrow('Theme file not found');

      expect(colors.bg.primary).toBe(originalBgPrimary);
    });

    test('initializeTheme with invalid JSON throws before modifying state', async () => {
      await writeFile(testThemePath, 'not valid json {{{');
      const originalBgPrimary = colors.bg.primary;

      await expect(initializeTheme(testThemePath)).rejects.toThrow('Invalid JSON');

      expect(colors.bg.primary).toBe(originalBgPrimary);
    });

    test('initializeTheme with invalid colors throws before modifying state', async () => {
      const invalidTheme = {
        bg: { primary: 'not-a-color' },
      };
      await writeFile(testThemePath, JSON.stringify(invalidTheme));
      const originalBgPrimary = colors.bg.primary;

      await expect(initializeTheme(testThemePath)).rejects.toThrow('Invalid');

      expect(colors.bg.primary).toBe(originalBgPrimary);
    });

    test('exported colors object reflects initialized theme', async () => {
      const customTheme = {
        task: { done: '#123456', active: '#654321' },
      };
      await writeFile(testThemePath, JSON.stringify(customTheme));

      await initializeTheme(testThemePath);

      expect(colors.task.done).toBe('#123456');
      expect(colors.task.active).toBe('#654321');
    });

    test('getTaskStatusColor uses initialized theme colors', async () => {
      const customTheme = {
        task: { done: '#aabbcc' },
      };
      await writeFile(testThemePath, JSON.stringify(customTheme));

      await initializeTheme(testThemePath);

      expect(getTaskStatusColor('done')).toBe('#aabbcc');
    });

    test('resetTheme restores default colors', async () => {
      const customTheme = {
        bg: { primary: '#000000' },
      };
      await writeFile(testThemePath, JSON.stringify(customTheme));
      await initializeTheme(testThemePath);
      expect(colors.bg.primary).toBe('#000000');

      resetTheme();

      expect(colors.bg.primary).toBe(defaultColors.bg.primary);
    });
  });
});
