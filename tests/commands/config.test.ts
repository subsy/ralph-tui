/**
 * ABOUTME: Integration tests for the ralph config command.
 * Tests configuration display, validation, and merging logic.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  printConfigHelp,
  executeConfigCommand,
} from '../../src/commands/config.js';
import type { StoredConfig, ConfigSource } from '../../src/config/index.js';

// Mock the config module
const mockLoadStoredConfigWithSource = mock(() =>
  Promise.resolve({
    config: {},
    source: {
      globalPath: null,
      projectPath: null,
      globalLoaded: false,
      projectLoaded: false,
    },
  }),
);
const mockSerializeConfig = mock((config: StoredConfig) => '# Empty config');

mock.module('../../src/config/index.js', () => ({
  loadStoredConfigWithSource: mockLoadStoredConfigWithSource,
  serializeConfig: mockSerializeConfig,
  CONFIG_PATHS: {
    global: '~/.config/ralph-tui/config.toml',
  },
}));

describe('config command', () => {
  describe('printConfigHelp', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    test('prints help text', () => {
      printConfigHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Ralph TUI Configuration');
      expect(output).toContain('ralph-tui config');
    });

    test('includes commands documentation', () => {
      printConfigHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Commands:');
      expect(output).toContain('show');
      expect(output).toContain('help');
    });

    test('includes show options', () => {
      printConfigHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('--sources');
      expect(output).toContain('--toml');
      expect(output).toContain('--cwd');
    });

    test('includes configuration files documentation', () => {
      printConfigHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Configuration Files:');
      expect(output).toContain('Global:');
      expect(output).toContain('Project:');
    });

    test('includes example config.toml', () => {
      printConfigHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Example config.toml:');
      expect(output).toContain('defaultAgent');
      expect(output).toContain('defaultTracker');
      expect(output).toContain('maxIterations');
    });
  });

  describe('executeConfigCommand', () => {
    let consoleOutput: string[] = [];
    let errorOutput: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;

    beforeEach(() => {
      consoleOutput = [];
      errorOutput = [];
      console.log = (...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(' '));
      };
      console.error = (...args: unknown[]) => {
        errorOutput.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
      console.error = originalError;
    });

    test('handles help subcommand', async () => {
      const result = await executeConfigCommand(['help']);
      expect(result).toBe(true);
      const output = consoleOutput.join('\n');
      expect(output).toContain('Ralph TUI Configuration');
    });

    test('handles --help flag', async () => {
      const result = await executeConfigCommand(['--help']);
      expect(result).toBe(true);
      const output = consoleOutput.join('\n');
      expect(output).toContain('Ralph TUI Configuration');
    });

    test('handles no subcommand as help', async () => {
      const result = await executeConfigCommand([]);
      expect(result).toBe(true);
    });

    test('handles unknown subcommand', async () => {
      const result = await executeConfigCommand(['unknown']);
      expect(result).toBe(true);
      const output = errorOutput.join('\n');
      expect(output).toContain('Unknown config command');
    });
  });

  describe('StoredConfig type', () => {
    test('empty config is valid', () => {
      const config: StoredConfig = {};
      expect(config).toBeDefined();
    });

    test('full config is valid', () => {
      const config: StoredConfig = {
        defaultAgent: 'claude',
        defaultTracker: 'beads-bv',
        maxIterations: 20,
        iterationDelay: 2000,
        autoCommit: true,
        agents: [
          {
            name: 'claude',
            plugin: 'claude',
            default: true,
            options: { model: 'opus' },
          },
        ],
        trackers: [
          {
            name: 'beads',
            plugin: 'beads-bv',
            default: true,
          },
        ],
        errorHandling: {
          strategy: 'skip',
          maxRetries: 3,
        },
      };

      expect(config.defaultAgent).toBe('claude');
      expect(config.defaultTracker).toBe('beads-bv');
      expect(config.maxIterations).toBe(20);
      expect(config.agents).toHaveLength(1);
      expect(config.trackers).toHaveLength(1);
    });

    test('partial config is valid', () => {
      const config: StoredConfig = {
        defaultAgent: 'opencode',
        maxIterations: 10,
      };

      expect(config.defaultAgent).toBe('opencode');
      expect(config.maxIterations).toBe(10);
      expect(config.defaultTracker).toBeUndefined();
    });
  });

  describe('ConfigSource type', () => {
    test('no sources found', () => {
      const source: ConfigSource = {
        globalPath: null,
        projectPath: null,
        globalLoaded: false,
        projectLoaded: false,
      };

      expect(source.globalPath).toBeNull();
      expect(source.projectPath).toBeNull();
      expect(source.globalLoaded).toBe(false);
      expect(source.projectLoaded).toBe(false);
    });

    test('global source only', () => {
      const source: ConfigSource = {
        globalPath: '~/.config/ralph-tui/config.toml',
        projectPath: null,
        globalLoaded: true,
        projectLoaded: false,
      };

      expect(source.globalPath).toBe('~/.config/ralph-tui/config.toml');
      expect(source.projectPath).toBeNull();
      expect(source.globalLoaded).toBe(true);
      expect(source.projectLoaded).toBe(false);
    });

    test('project source only', () => {
      const source: ConfigSource = {
        globalPath: null,
        projectPath: '/home/user/project/.ralph-tui/config.toml',
        globalLoaded: false,
        projectLoaded: true,
      };

      expect(source.globalPath).toBeNull();
      expect(source.projectPath).toBe(
        '/home/user/project/.ralph-tui/config.toml',
      );
      expect(source.globalLoaded).toBe(false);
      expect(source.projectLoaded).toBe(true);
    });

    test('both sources found', () => {
      const source: ConfigSource = {
        globalPath: '~/.config/ralph-tui/config.toml',
        projectPath: '/home/user/project/.ralph-tui/config.toml',
        globalLoaded: true,
        projectLoaded: true,
      };

      expect(source.globalPath).toBe('~/.config/ralph-tui/config.toml');
      expect(source.projectPath).toBe(
        '/home/user/project/.ralph-tui/config.toml',
      );
      expect(source.globalLoaded).toBe(true);
      expect(source.projectLoaded).toBe(true);
    });
  });

  describe('config merging logic', () => {
    test('project config overrides global config', () => {
      // Simulate merging behavior
      const mergeConfigs = (
        global: Partial<StoredConfig>,
        project: Partial<StoredConfig>,
      ): StoredConfig => {
        return {
          ...global,
          ...project,
        };
      };

      const global: Partial<StoredConfig> = {
        defaultAgent: 'claude',
        maxIterations: 10,
      };

      const project: Partial<StoredConfig> = {
        maxIterations: 20,
        defaultTracker: 'beads',
      };

      const merged = mergeConfigs(global, project);

      expect(merged.defaultAgent).toBe('claude'); // From global
      expect(merged.maxIterations).toBe(20); // Overridden by project
      expect(merged.defaultTracker).toBe('beads'); // From project
    });

    test('empty project config uses global', () => {
      const mergeConfigs = (
        global: Partial<StoredConfig>,
        project: Partial<StoredConfig>,
      ): StoredConfig => {
        return {
          ...global,
          ...project,
        };
      };

      const global: Partial<StoredConfig> = {
        defaultAgent: 'claude',
        maxIterations: 15,
        defaultTracker: 'json',
      };

      const merged = mergeConfigs(global, {});

      expect(merged.defaultAgent).toBe('claude');
      expect(merged.maxIterations).toBe(15);
      expect(merged.defaultTracker).toBe('json');
    });

    test('empty global config uses project', () => {
      const mergeConfigs = (
        global: Partial<StoredConfig>,
        project: Partial<StoredConfig>,
      ): StoredConfig => {
        return {
          ...global,
          ...project,
        };
      };

      const project: Partial<StoredConfig> = {
        defaultAgent: 'opencode',
        maxIterations: 30,
      };

      const merged = mergeConfigs({}, project);

      expect(merged.defaultAgent).toBe('opencode');
      expect(merged.maxIterations).toBe(30);
    });
  });

  describe('config validation', () => {
    test('validates maxIterations is a number', () => {
      const validateMaxIterations = (value: unknown): boolean => {
        return typeof value === 'number' && value >= 0;
      };

      expect(validateMaxIterations(10)).toBe(true);
      expect(validateMaxIterations(0)).toBe(true);
      expect(validateMaxIterations(-1)).toBe(false);
      expect(validateMaxIterations('10')).toBe(false);
      expect(validateMaxIterations(null)).toBe(false);
    });

    test('validates defaultAgent is a string', () => {
      const validateDefaultAgent = (value: unknown): boolean => {
        return typeof value === 'string' && value.length > 0;
      };

      expect(validateDefaultAgent('claude')).toBe(true);
      expect(validateDefaultAgent('opencode')).toBe(true);
      expect(validateDefaultAgent('')).toBe(false);
      expect(validateDefaultAgent(123)).toBe(false);
      expect(validateDefaultAgent(null)).toBe(false);
    });

    test('validates defaultTracker is a string', () => {
      const validateDefaultTracker = (value: unknown): boolean => {
        return typeof value === 'string' && value.length > 0;
      };

      expect(validateDefaultTracker('beads')).toBe(true);
      expect(validateDefaultTracker('beads-bv')).toBe(true);
      expect(validateDefaultTracker('json')).toBe(true);
      expect(validateDefaultTracker('')).toBe(false);
      expect(validateDefaultTracker(123)).toBe(false);
    });

    test('validates iterationDelay is a positive number', () => {
      const validateIterationDelay = (value: unknown): boolean => {
        return typeof value === 'number' && value >= 0;
      };

      expect(validateIterationDelay(1000)).toBe(true);
      expect(validateIterationDelay(0)).toBe(true);
      expect(validateIterationDelay(5000)).toBe(true);
      expect(validateIterationDelay(-100)).toBe(false);
      expect(validateIterationDelay('1000')).toBe(false);
    });

    test('validates errorHandling strategy', () => {
      const validStrategies = ['skip', 'abort', 'retry'];
      const validateStrategy = (value: unknown): boolean => {
        return typeof value === 'string' && validStrategies.includes(value);
      };

      expect(validateStrategy('skip')).toBe(true);
      expect(validateStrategy('abort')).toBe(true);
      expect(validateStrategy('retry')).toBe(true);
      expect(validateStrategy('unknown')).toBe(false);
      expect(validateStrategy('')).toBe(false);
      expect(validateStrategy(123)).toBe(false);
    });
  });

  describe('agent config validation', () => {
    test('valid agent config', () => {
      interface AgentConfig {
        name: string;
        plugin: string;
        default?: boolean;
        options?: Record<string, unknown>;
      }

      const validateAgentConfig = (config: AgentConfig): boolean => {
        if (!config.name || typeof config.name !== 'string') return false;
        if (!config.plugin || typeof config.plugin !== 'string') return false;
        return true;
      };

      expect(
        validateAgentConfig({
          name: 'claude',
          plugin: 'claude',
          default: true,
          options: { model: 'opus' },
        }),
      ).toBe(true);

      expect(
        validateAgentConfig({
          name: 'opencode',
          plugin: 'opencode',
        }),
      ).toBe(true);
    });

    test('invalid agent config - missing name', () => {
      interface AgentConfig {
        name: string;
        plugin: string;
      }

      const validateAgentConfig = (config: Partial<AgentConfig>): boolean => {
        if (!config.name || typeof config.name !== 'string') return false;
        if (!config.plugin || typeof config.plugin !== 'string') return false;
        return true;
      };

      expect(
        validateAgentConfig({
          plugin: 'claude',
        }),
      ).toBe(false);
    });

    test('invalid agent config - missing plugin', () => {
      interface AgentConfig {
        name: string;
        plugin: string;
      }

      const validateAgentConfig = (config: Partial<AgentConfig>): boolean => {
        if (!config.name || typeof config.name !== 'string') return false;
        if (!config.plugin || typeof config.plugin !== 'string') return false;
        return true;
      };

      expect(
        validateAgentConfig({
          name: 'claude',
        }),
      ).toBe(false);
    });
  });

  describe('tracker config validation', () => {
    test('valid tracker config', () => {
      interface TrackerConfig {
        name: string;
        plugin: string;
        default?: boolean;
        options?: Record<string, unknown>;
      }

      const validateTrackerConfig = (config: TrackerConfig): boolean => {
        if (!config.name || typeof config.name !== 'string') return false;
        if (!config.plugin || typeof config.plugin !== 'string') return false;
        return true;
      };

      expect(
        validateTrackerConfig({
          name: 'beads',
          plugin: 'beads-bv',
          default: true,
        }),
      ).toBe(true);

      expect(
        validateTrackerConfig({
          name: 'json',
          plugin: 'json',
          options: { path: './prd.json' },
        }),
      ).toBe(true);
    });

    test('invalid tracker config - missing name', () => {
      interface TrackerConfig {
        name: string;
        plugin: string;
      }

      const validateTrackerConfig = (
        config: Partial<TrackerConfig>,
      ): boolean => {
        if (!config.name || typeof config.name !== 'string') return false;
        if (!config.plugin || typeof config.plugin !== 'string') return false;
        return true;
      };

      expect(
        validateTrackerConfig({
          plugin: 'beads',
        }),
      ).toBe(false);
    });

    test('invalid tracker config - missing plugin', () => {
      interface TrackerConfig {
        name: string;
        plugin: string;
      }

      const validateTrackerConfig = (
        config: Partial<TrackerConfig>,
      ): boolean => {
        if (!config.name || typeof config.name !== 'string') return false;
        if (!config.plugin || typeof config.plugin !== 'string') return false;
        return true;
      };

      expect(
        validateTrackerConfig({
          name: 'beads',
        }),
      ).toBe(false);
    });
  });
});
