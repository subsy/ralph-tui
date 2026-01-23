/**
 * ABOUTME: Tests for Zod schemas in configuration validation.
 * Verifies schema validation, error formatting, and edge cases.
 */

import { describe, expect, test } from 'bun:test';
import {
  SubagentDetailLevelSchema,
  ErrorHandlingStrategySchema,
  ErrorHandlingConfigSchema,
  AgentOptionsSchema,
  RateLimitHandlingConfigSchema,
  NotificationSoundModeSchema,
  NotificationsConfigSchema,
  AgentPluginConfigSchema,
  TrackerOptionsSchema,
  TrackerPluginConfigSchema,
  StoredConfigSchema,
  validateStoredConfig,
  formatConfigErrors,
  type ConfigValidationError,
} from './schema.js';

describe('SubagentDetailLevelSchema', () => {
  test('accepts valid values', () => {
    expect(SubagentDetailLevelSchema.parse('off')).toBe('off');
    expect(SubagentDetailLevelSchema.parse('minimal')).toBe('minimal');
    expect(SubagentDetailLevelSchema.parse('moderate')).toBe('moderate');
    expect(SubagentDetailLevelSchema.parse('full')).toBe('full');
  });

  test('rejects invalid values', () => {
    expect(() => SubagentDetailLevelSchema.parse('invalid')).toThrow();
    expect(() => SubagentDetailLevelSchema.parse('')).toThrow();
    expect(() => SubagentDetailLevelSchema.parse(123)).toThrow();
    expect(() => SubagentDetailLevelSchema.parse(null)).toThrow();
  });
});

describe('ErrorHandlingStrategySchema', () => {
  test('accepts valid strategies', () => {
    expect(ErrorHandlingStrategySchema.parse('retry')).toBe('retry');
    expect(ErrorHandlingStrategySchema.parse('skip')).toBe('skip');
    expect(ErrorHandlingStrategySchema.parse('abort')).toBe('abort');
  });

  test('rejects invalid strategies', () => {
    expect(() => ErrorHandlingStrategySchema.parse('invalid')).toThrow();
    expect(() => ErrorHandlingStrategySchema.parse('SKIP')).toThrow();
    expect(() => ErrorHandlingStrategySchema.parse(1)).toThrow();
  });
});

describe('ErrorHandlingConfigSchema', () => {
  test('accepts valid configurations', () => {
    const result = ErrorHandlingConfigSchema.parse({
      strategy: 'retry',
      maxRetries: 5,
      retryDelayMs: 1000,
      continueOnNonZeroExit: true,
    });
    expect(result.strategy).toBe('retry');
    expect(result.maxRetries).toBe(5);
    expect(result.retryDelayMs).toBe(1000);
    expect(result.continueOnNonZeroExit).toBe(true);
  });

  test('accepts empty object (all fields optional)', () => {
    const result = ErrorHandlingConfigSchema.parse({});
    expect(result).toEqual({});
  });

  test('accepts partial configuration', () => {
    const result = ErrorHandlingConfigSchema.parse({ strategy: 'skip' });
    expect(result.strategy).toBe('skip');
    expect(result.maxRetries).toBeUndefined();
  });

  test('validates maxRetries bounds', () => {
    expect(() => ErrorHandlingConfigSchema.parse({ maxRetries: -1 })).toThrow();
    expect(() => ErrorHandlingConfigSchema.parse({ maxRetries: 11 })).toThrow();
    expect(ErrorHandlingConfigSchema.parse({ maxRetries: 0 }).maxRetries).toBe(0);
    expect(ErrorHandlingConfigSchema.parse({ maxRetries: 10 }).maxRetries).toBe(10);
  });

  test('validates retryDelayMs bounds', () => {
    expect(() => ErrorHandlingConfigSchema.parse({ retryDelayMs: -1 })).toThrow();
    expect(() => ErrorHandlingConfigSchema.parse({ retryDelayMs: 300001 })).toThrow();
    expect(ErrorHandlingConfigSchema.parse({ retryDelayMs: 0 }).retryDelayMs).toBe(0);
    expect(ErrorHandlingConfigSchema.parse({ retryDelayMs: 300000 }).retryDelayMs).toBe(300000);
  });
});

describe('AgentOptionsSchema', () => {
  test('accepts any record of unknown values', () => {
    const result = AgentOptionsSchema.parse({
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      nested: { foo: 'bar' },
      array: [1, 2, 3],
    });
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.temperature).toBe(0.7);
  });

  test('accepts empty object', () => {
    expect(AgentOptionsSchema.parse({})).toEqual({});
  });

  test('rejects non-object types', () => {
    expect(() => AgentOptionsSchema.parse('string')).toThrow();
    expect(() => AgentOptionsSchema.parse(123)).toThrow();
    expect(() => AgentOptionsSchema.parse(null)).toThrow();
  });
});

describe('RateLimitHandlingConfigSchema', () => {
  test('accepts valid configuration', () => {
    const result = RateLimitHandlingConfigSchema.parse({
      enabled: true,
      maxRetries: 5,
      baseBackoffMs: 10000,
      recoverPrimaryBetweenIterations: false,
    });
    expect(result.enabled).toBe(true);
    expect(result.maxRetries).toBe(5);
    expect(result.baseBackoffMs).toBe(10000);
    expect(result.recoverPrimaryBetweenIterations).toBe(false);
  });

  test('accepts empty object', () => {
    expect(RateLimitHandlingConfigSchema.parse({})).toEqual({});
  });

  test('validates numeric bounds', () => {
    expect(() => RateLimitHandlingConfigSchema.parse({ maxRetries: -1 })).toThrow();
    expect(() => RateLimitHandlingConfigSchema.parse({ maxRetries: 11 })).toThrow();
    expect(() => RateLimitHandlingConfigSchema.parse({ baseBackoffMs: -1 })).toThrow();
  });
});

describe('NotificationSoundModeSchema', () => {
  test('accepts valid sound modes', () => {
    expect(NotificationSoundModeSchema.parse('off')).toBe('off');
    expect(NotificationSoundModeSchema.parse('system')).toBe('system');
    expect(NotificationSoundModeSchema.parse('ralph')).toBe('ralph');
  });

  test('rejects invalid modes', () => {
    expect(() => NotificationSoundModeSchema.parse('invalid')).toThrow();
    expect(() => NotificationSoundModeSchema.parse('')).toThrow();
  });
});

describe('NotificationsConfigSchema', () => {
  test('accepts valid configuration', () => {
    const result = NotificationsConfigSchema.parse({
      enabled: true,
      sound: 'ralph',
    });
    expect(result.enabled).toBe(true);
    expect(result.sound).toBe('ralph');
  });

  test('accepts empty object', () => {
    expect(NotificationsConfigSchema.parse({})).toEqual({});
  });
});

describe('AgentPluginConfigSchema', () => {
  test('accepts valid minimal configuration', () => {
    const result = AgentPluginConfigSchema.parse({
      name: 'my-agent',
      plugin: 'claude',
    });
    expect(result.name).toBe('my-agent');
    expect(result.plugin).toBe('claude');
    expect(result.options).toEqual({});
  });

  test('accepts full configuration', () => {
    const result = AgentPluginConfigSchema.parse({
      name: 'custom-agent',
      plugin: 'droid',
      default: true,
      command: 'custom-command',
      defaultFlags: ['--verbose', '--json'],
      timeout: 60000,
      options: { model: 'custom' },
      fallbackAgents: ['claude', 'codex'],
      rateLimitHandling: {
        enabled: true,
        maxRetries: 5,
      },
    });
    expect(result.name).toBe('custom-agent');
    expect(result.plugin).toBe('droid');
    expect(result.default).toBe(true);
    expect(result.command).toBe('custom-command');
    expect(result.defaultFlags).toEqual(['--verbose', '--json']);
    expect(result.timeout).toBe(60000);
    expect(result.fallbackAgents).toEqual(['claude', 'codex']);
  });

  test('requires name field', () => {
    expect(() => AgentPluginConfigSchema.parse({ plugin: 'claude' })).toThrow();
  });

  test('requires plugin field', () => {
    expect(() => AgentPluginConfigSchema.parse({ name: 'test' })).toThrow();
  });

  test('rejects empty name', () => {
    expect(() => AgentPluginConfigSchema.parse({ name: '', plugin: 'claude' })).toThrow();
  });

  test('rejects empty plugin', () => {
    expect(() => AgentPluginConfigSchema.parse({ name: 'test', plugin: '' })).toThrow();
  });

  test('validates timeout as non-negative integer', () => {
    expect(() => AgentPluginConfigSchema.parse({ name: 'test', plugin: 'claude', timeout: -1 })).toThrow();
    expect(() => AgentPluginConfigSchema.parse({ name: 'test', plugin: 'claude', timeout: 1.5 })).toThrow();
  });

  test('validates fallbackAgents contains non-empty strings', () => {
    expect(() => AgentPluginConfigSchema.parse({
      name: 'test',
      plugin: 'claude',
      fallbackAgents: [''],
    })).toThrow();
  });
});

describe('TrackerOptionsSchema', () => {
  test('accepts any record of unknown values', () => {
    const result = TrackerOptionsSchema.parse({
      path: '/some/path',
      enabled: true,
    });
    expect(result.path).toBe('/some/path');
    expect(result.enabled).toBe(true);
  });
});

describe('TrackerPluginConfigSchema', () => {
  test('accepts valid minimal configuration', () => {
    const result = TrackerPluginConfigSchema.parse({
      name: 'my-tracker',
      plugin: 'beads-bv',
    });
    expect(result.name).toBe('my-tracker');
    expect(result.plugin).toBe('beads-bv');
    expect(result.options).toEqual({});
  });

  test('accepts full configuration', () => {
    const result = TrackerPluginConfigSchema.parse({
      name: 'custom-tracker',
      plugin: 'json',
      default: true,
      options: { path: '/prd.json' },
    });
    expect(result.name).toBe('custom-tracker');
    expect(result.plugin).toBe('json');
    expect(result.default).toBe(true);
    expect(result.options).toEqual({ path: '/prd.json' });
  });

  test('requires name and plugin fields', () => {
    expect(() => TrackerPluginConfigSchema.parse({ plugin: 'json' })).toThrow();
    expect(() => TrackerPluginConfigSchema.parse({ name: 'test' })).toThrow();
  });
});

describe('StoredConfigSchema', () => {
  test('accepts empty configuration', () => {
    const result = StoredConfigSchema.parse({});
    expect(result).toEqual({});
  });

  test('accepts complete configuration', () => {
    const result = StoredConfigSchema.parse({
      defaultAgent: 'claude',
      defaultTracker: 'beads-bv',
      maxIterations: 20,
      iterationDelay: 2000,
      preflightTimeoutMs: 180000,
      outputDir: './output',
      autoCommit: true,
      agents: [
        { name: 'claude', plugin: 'claude' },
        { name: 'droid', plugin: 'droid' },
      ],
      trackers: [
        { name: 'beads', plugin: 'beads-bv' },
      ],
      agent: 'claude',
      agentOptions: { model: 'claude-sonnet-4-20250514' },
      tracker: 'beads-bv',
      trackerOptions: { epicId: 'test-epic' },
      errorHandling: { strategy: 'retry', maxRetries: 5 },
      fallbackAgents: ['droid'],
      rateLimitHandling: { enabled: true },
      prompt_template: './prompts/custom.md',
      skills_dir: './skills',
      subagentTracingDetail: 'moderate',
      notifications: { enabled: true, sound: 'ralph' },
    });
    expect(result.defaultAgent).toBe('claude');
    expect(result.maxIterations).toBe(20);
    expect(result.agents).toHaveLength(2);
  });

  test('validates maxIterations bounds', () => {
    expect(() => StoredConfigSchema.parse({ maxIterations: -1 })).toThrow();
    expect(() => StoredConfigSchema.parse({ maxIterations: 1001 })).toThrow();
    expect(StoredConfigSchema.parse({ maxIterations: 0 }).maxIterations).toBe(0);
    expect(StoredConfigSchema.parse({ maxIterations: 1000 }).maxIterations).toBe(1000);
  });

  test('validates iterationDelay bounds', () => {
    expect(() => StoredConfigSchema.parse({ iterationDelay: -1 })).toThrow();
    expect(() => StoredConfigSchema.parse({ iterationDelay: 300001 })).toThrow();
  });

  test('validates preflightTimeoutMs as non-negative integer', () => {
    expect(() => StoredConfigSchema.parse({ preflightTimeoutMs: -1 })).toThrow();
    expect(() => StoredConfigSchema.parse({ preflightTimeoutMs: 1.5 })).toThrow();
    expect(StoredConfigSchema.parse({ preflightTimeoutMs: 0 }).preflightTimeoutMs).toBe(0);
    expect(StoredConfigSchema.parse({ preflightTimeoutMs: 30000 }).preflightTimeoutMs).toBe(30000);
  });

  test('rejects unknown fields (strict mode)', () => {
    expect(() => StoredConfigSchema.parse({ unknownField: 'value' })).toThrow();
  });

  test('validates nested agent configurations', () => {
    expect(() => StoredConfigSchema.parse({
      agents: [{ name: '', plugin: 'claude' }],
    })).toThrow();
  });

  test('validates nested tracker configurations', () => {
    expect(() => StoredConfigSchema.parse({
      trackers: [{ name: 'test', plugin: '' }],
    })).toThrow();
  });
});

describe('validateStoredConfig', () => {
  test('returns success for valid config', () => {
    const result = validateStoredConfig({
      maxIterations: 10,
      agent: 'claude',
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.maxIterations).toBe(10);
    expect(result.errors).toBeUndefined();
  });

  test('returns errors for invalid config', () => {
    const result = validateStoredConfig({
      maxIterations: -5,
    });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.data).toBeUndefined();
  });

  test('formats error paths correctly', () => {
    const result = validateStoredConfig({
      agents: [{ name: '', plugin: 'claude' }],
    });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    const pathError = result.errors!.find((e) => e.path.includes('agents'));
    expect(pathError).toBeDefined();
  });

  test('handles root-level errors', () => {
    const result = validateStoredConfig({
      unknownField: 'value',
    });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });

  test('handles non-object input', () => {
    const result = validateStoredConfig('not an object');
    expect(result.success).toBe(false);
  });

  test('handles null input', () => {
    const result = validateStoredConfig(null);
    expect(result.success).toBe(false);
  });
});

describe('StoredConfigSchema command field', () => {
  test('accepts valid command paths', () => {
    const result = StoredConfigSchema.parse({
      command: 'ccr code',
    });
    expect(result.command).toBe('ccr code');
  });

  test('accepts absolute paths', () => {
    const result = StoredConfigSchema.parse({
      command: '/opt/bin/my-claude',
    });
    expect(result.command).toBe('/opt/bin/my-claude');
  });

  test('accepts paths with arguments', () => {
    const result = StoredConfigSchema.parse({
      command: 'ccr code --verbose',
    });
    expect(result.command).toBe('ccr code --verbose');
  });

  test('rejects commands with semicolons (command chaining)', () => {
    expect(() =>
      StoredConfigSchema.parse({
        command: 'ccr; rm -rf /',
      })
    ).toThrow(/shell metacharacters/);
  });

  test('rejects commands with ampersands (background execution)', () => {
    expect(() =>
      StoredConfigSchema.parse({
        command: 'ccr & malicious',
      })
    ).toThrow(/shell metacharacters/);
  });

  test('rejects commands with pipes (command piping)', () => {
    expect(() =>
      StoredConfigSchema.parse({
        command: 'ccr | tee /etc/passwd',
      })
    ).toThrow(/shell metacharacters/);
  });

  test('rejects commands with backticks (command substitution)', () => {
    expect(() =>
      StoredConfigSchema.parse({
        command: 'ccr `whoami`',
      })
    ).toThrow(/shell metacharacters/);
  });

  test('rejects commands with dollar signs (variable expansion)', () => {
    expect(() =>
      StoredConfigSchema.parse({
        command: 'ccr $HOME',
      })
    ).toThrow(/shell metacharacters/);
  });

  test('rejects commands with parentheses (subshells)', () => {
    expect(() =>
      StoredConfigSchema.parse({
        command: 'ccr $(cat /etc/passwd)',
      })
    ).toThrow(/shell metacharacters/);
  });

  test('allows dashes, underscores, and slashes in paths', () => {
    const result = StoredConfigSchema.parse({
      command: '/usr/local/bin/my-agent_v2',
    });
    expect(result.command).toBe('/usr/local/bin/my-agent_v2');
  });
});

describe('formatConfigErrors', () => {
  test('formats single error', () => {
    const errors: ConfigValidationError[] = [
      { path: 'maxIterations', message: 'Must be a positive number' },
    ];
    const formatted = formatConfigErrors(errors, '/path/to/config.toml');
    expect(formatted).toContain('Configuration error in /path/to/config.toml');
    expect(formatted).toContain('maxIterations');
    expect(formatted).toContain('Must be a positive number');
  });

  test('formats multiple errors', () => {
    const errors: ConfigValidationError[] = [
      { path: 'maxIterations', message: 'Must be a positive number' },
      { path: 'agents.0.name', message: 'Name is required' },
      { path: '(root)', message: 'Unknown field' },
    ];
    const formatted = formatConfigErrors(errors, '/config.toml');
    expect(formatted).toContain('maxIterations');
    expect(formatted).toContain('agents.0.name');
    expect(formatted).toContain('(root)');
  });

  test('handles empty error array', () => {
    const formatted = formatConfigErrors([], '/config.toml');
    expect(formatted).toContain('Configuration error in /config.toml');
  });
});
