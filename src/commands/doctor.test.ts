/**
 * ABOUTME: Tests for the doctor command.
 * Tests diagnostic functionality including detection and preflight checks.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  afterAll,
  mock,
  spyOn,
} from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Types for mock results
interface MockDetectResult {
  available: boolean;
  version?: string;
  executablePath?: string;
  error?: string;
}

interface MockPreflightResult {
  success: boolean;
  durationMs?: number;
  error?: string;
}

// Store mock implementations that can be changed per test
let mockDetectResult: MockDetectResult = { available: true, version: '1.0.0', executablePath: '/usr/bin/mock' };
let mockPreflightResult: MockPreflightResult = { success: true, durationMs: 100 };

// Capture the last config passed to getInstance for verification
let lastGetInstanceConfig: unknown = null;

// Mock agent instance
const createMockAgentInstance = () => ({
  meta: { id: 'claude', name: 'Claude Code' },
  detect: () => Promise.resolve(mockDetectResult),
  preflight: () => Promise.resolve(mockPreflightResult),
  initialize: () => Promise.resolve(),
  dispose: () => Promise.resolve(),
});

// Mock the agent registry
mock.module('../plugins/agents/registry.js', () => ({
  getAgentRegistry: () => ({
    getInstance: (config: unknown) => {
      lastGetInstanceConfig = config;
      return Promise.resolve(createMockAgentInstance());
    },
    hasPlugin: (name: string) => name === 'claude' || name === 'opencode',
    registerBuiltin: () => {},
    getRegisteredPlugins: () => [
      { id: 'claude', name: 'Claude Code', description: 'Claude AI', version: '1.0.0' },
      { id: 'opencode', name: 'OpenCode', description: 'OpenCode AI', version: '1.0.0' },
    ],
  }),
}));

// Mock registerBuiltinAgents
mock.module('../plugins/agents/builtin/index.js', () => ({
  registerBuiltinAgents: () => {},
}));

// NOTE: We don't mock config/index.js because:
// 1. It causes mock pollution that breaks other tests
// 2. The doctor command defaults to 'claude' when no config exists
// 3. Tests pass --cwd to temp directories which have no config

// Import after mocking
import { executeDoctorCommand, printDoctorHelp } from './doctor.js';
import type { DoctorResult } from './doctor.js';

// Helper to create temp directory
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-doctor-test-'));
}

// Clean up mocks after all tests to prevent leakage to other test files
afterAll(() => {
  mock.restore();
});

describe('doctor command', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let capturedOutput: string[];
  let capturedErrors: string[];
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    capturedOutput = [];
    capturedErrors = [];

    // Reset mock values
    mockDetectResult = { available: true, version: '1.0.0', executablePath: '/usr/bin/mock' };
    mockPreflightResult = { success: true, durationMs: 100 };

    // Spy on console
    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args) => {
      capturedOutput.push(args.join(' '));
    });
    consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args) => {
      capturedErrors.push(args.join(' '));
    });

    // Mock process.exit to prevent test from exiting
    processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('printDoctorHelp', () => {
    test('prints help message with usage information', () => {
      printDoctorHelp();

      const output = capturedOutput.join('\n');
      expect(output).toContain('ralph-tui doctor');
      expect(output).toContain('Usage:');
      expect(output).toContain('--agent');
      expect(output).toContain('--json');
      expect(output).toContain('--cwd');
    });

    test('includes common issues section', () => {
      printDoctorHelp();

      const output = capturedOutput.join('\n');
      expect(output).toContain('Common Issues');
      expect(output).toContain('OpenCode');
      expect(output).toContain('Claude');
    });

    test('includes exit codes section', () => {
      printDoctorHelp();

      const output = capturedOutput.join('\n');
      expect(output).toContain('Exit Codes');
      expect(output).toContain('0');
      expect(output).toContain('healthy');
    });
  });

  describe('executeDoctorCommand', () => {
    test('shows help when --help flag is provided', async () => {
      await executeDoctorCommand(['--help']);

      const output = capturedOutput.join('\n');
      expect(output).toContain('ralph-tui doctor');
      expect(output).toContain('Usage:');
    });

    test('shows help when -h flag is provided', async () => {
      await executeDoctorCommand(['-h']);

      const output = capturedOutput.join('\n');
      expect(output).toContain('ralph-tui doctor');
    });

    test('outputs JSON when --json flag is provided', async () => {
      try {
        await executeDoctorCommand(['--json', '--cwd', tempDir]);
      } catch {
        // Expected - process.exit is called
      }

      // Find the JSON output line (should be the last non-empty line)
      const outputLines = capturedOutput.filter(line => line.trim().length > 0);
      const jsonLine = outputLines.find(line => line.startsWith('{'));
      expect(jsonLine).toBeDefined();

      const result = JSON.parse(jsonLine!) as DoctorResult;
      expect(result.healthy).toBe(true);
      expect(result.agent).toBeDefined();
    });

    test('reports healthy status when agent passes all checks', async () => {
      try {
        await executeDoctorCommand(['--json', '--cwd', tempDir]);
      } catch {
        // Expected
      }

      const jsonLine = capturedOutput.find(line => line.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const result = JSON.parse(jsonLine!) as DoctorResult;

      expect(result.healthy).toBe(true);
      expect(result.detection.available).toBe(true);
      expect(result.preflight?.success).toBe(true);
      expect(result.message).toContain('healthy');
    });

    test('reports unhealthy when detection fails', async () => {
      mockDetectResult = { available: false, error: 'CLI not found' };

      try {
        await executeDoctorCommand(['--json', '--cwd', tempDir]);
      } catch {
        // Expected
      }

      const jsonLine = capturedOutput.find(line => line.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const result = JSON.parse(jsonLine!) as DoctorResult;

      expect(result.healthy).toBe(false);
      expect(result.detection.available).toBe(false);
    });

    test('reports unhealthy when preflight fails', async () => {
      mockPreflightResult = { success: false, error: 'No API key configured' };

      try {
        await executeDoctorCommand(['--json', '--cwd', tempDir]);
      } catch {
        // Expected
      }

      const jsonLine = capturedOutput.find(line => line.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const result = JSON.parse(jsonLine!) as DoctorResult;

      expect(result.healthy).toBe(false);
      expect(result.preflight?.success).toBe(false);
    });

    test('uses custom cwd when --cwd is provided', async () => {
      const customDir = await createTempDir();
      try {
        await executeDoctorCommand(['--json', '--cwd', customDir]);
      } catch {
        // Expected
      } finally {
        await rm(customDir, { recursive: true, force: true });
      }

      // Test passes if no error about directory
      const output = capturedOutput.join('\n');
      expect(output).toBeTruthy();
    });

    test('human-readable output includes status section', async () => {
      try {
        await executeDoctorCommand(['--cwd', tempDir]);
      } catch {
        // Expected
      }

      const output = capturedOutput.join('\n');
      expect(output).toContain('HEALTHY');
      expect(output).toContain('Detection');
      expect(output).toContain('Preflight');
    });

    test('human-readable output shows agent name', async () => {
      try {
        await executeDoctorCommand(['--cwd', tempDir]);
      } catch {
        // Expected
      }

      const output = capturedOutput.join('\n');
      expect(output).toContain('Claude Code');
    });

    test('exits with code 0 for healthy agent', async () => {
      try {
        await executeDoctorCommand(['--json', '--cwd', tempDir]);
      } catch {
        // Expected
      }

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    test('exits with code 1 for unhealthy agent', async () => {
      mockDetectResult = { available: false, error: 'Not found' };

      try {
        await executeDoctorCommand(['--json', '--cwd', tempDir]);
      } catch {
        // Expected
      }

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});

describe('doctor result structure', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let output: string[];
  let originalCwd: string;
  let tempDir: string;

  beforeEach(async () => {
    // Save original cwd and create isolated temp directory
    originalCwd = process.cwd();
    tempDir = await createTempDir();
    process.chdir(tempDir);

    mockDetectResult = { available: true, version: '2.0.0', executablePath: '/custom/path' };
    mockPreflightResult = { success: true, durationMs: 250 };
    output = [];

    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.join(' '));
    });
    processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();

    // Restore original cwd and clean up temp directory
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  test('includes version in detection result', async () => {
    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected
    }

    const jsonLine = output.find(line => line.startsWith('{'));
    expect(jsonLine).toBeDefined();
    const result = JSON.parse(jsonLine!) as DoctorResult;
    expect(result.detection.version).toBe('2.0.0');
  });

  test('includes executable path in detection result', async () => {
    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected
    }

    const jsonLine = output.find(line => line.startsWith('{'));
    expect(jsonLine).toBeDefined();
    const result = JSON.parse(jsonLine!) as DoctorResult;
    expect(result.detection.executablePath).toBe('/custom/path');
  });

  test('includes duration in preflight result', async () => {
    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected
    }

    const jsonLine = output.find(line => line.startsWith('{'));
    expect(jsonLine).toBeDefined();
    const result = JSON.parse(jsonLine!) as DoctorResult;
    expect(result.preflight?.durationMs).toBe(250);
  });
});

// Helper to write TOML config
async function writeTomlConfig(path: string, config: Record<string, unknown>): Promise<void> {
  const { stringify } = await import('smol-toml');
  const content = stringify(config);
  await writeFile(path, content, 'utf-8');
}

describe('doctor config propagation', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lastGetInstanceConfig = null;
    mockDetectResult = { available: true, version: '1.0.0', executablePath: '/usr/bin/mock' };
    mockPreflightResult = { success: true, durationMs: 100 };

    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('passes envExclude from config to agent getInstance', async () => {
    // Create project config with envExclude
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      agent: 'claude',
      envExclude: ['ANTHROPIC_API_KEY', '*_SECRET'],
    });

    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected - process.exit is called
    }

    // Verify envExclude was passed to getInstance
    expect(lastGetInstanceConfig).toBeDefined();
    const config = lastGetInstanceConfig as Record<string, unknown>;
    expect(config.envExclude).toEqual(['ANTHROPIC_API_KEY', '*_SECRET']);
  });

  test('passes command from config to agent getInstance', async () => {
    // Create project config with command
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      agent: 'claude',
      command: 'custom-claude',
    });

    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected - process.exit is called
    }

    // Verify command was passed to getInstance
    expect(lastGetInstanceConfig).toBeDefined();
    const config = lastGetInstanceConfig as Record<string, unknown>;
    expect(config.command).toBe('custom-claude');
  });

  test('handles config without envExclude', async () => {
    // Create project config without envExclude
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeTomlConfig(join(projectConfigDir, 'config.toml'), {
      agent: 'claude',
    });

    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected - process.exit is called
    }

    // Verify getInstance was called (envExclude will be undefined)
    expect(lastGetInstanceConfig).toBeDefined();
    const config = lastGetInstanceConfig as Record<string, unknown>;
    expect(config.envExclude).toBeUndefined();
  });

  test('uses agent from [[agents]] array with default=true and custom command', async () => {
    // Create project config with agents array containing a default agent with custom command
    // This tests that getDefaultAgentConfig properly resolves agents from the array
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
tracker = "beads-bv"

[[agents]]
name = "claude-custom"
plugin = "claude"
default = true
command = "claude-glm"
envPassthrough = ["CUSTOM_VAR"]
`,
      'utf-8'
    );

    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected - process.exit is called
    }

    // Verify the full agent config from the array was passed to getInstance
    expect(lastGetInstanceConfig).toBeDefined();
    const config = lastGetInstanceConfig as Record<string, unknown>;
    expect(config.name).toBe('claude-custom');
    expect(config.plugin).toBe('claude');
    expect(config.command).toBe('claude-glm');
    expect(config.envPassthrough).toEqual(['CUSTOM_VAR']);
  });

  test('agent-level command in [[agents]] takes precedence over top-level command', async () => {
    // Test that agent-specific command overrides top-level command shorthand
    const projectConfigDir = join(tempDir, '.ralph-tui');
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, 'config.toml'),
      `
command = "top-level-command"
tracker = "beads-bv"

[[agents]]
name = "custom-agent"
plugin = "claude"
command = "agent-level-command"
default = true
`,
      'utf-8'
    );

    try {
      await executeDoctorCommand(['--json', '--cwd', tempDir]);
    } catch {
      // Expected - process.exit is called
    }

    // Agent-level command should win
    expect(lastGetInstanceConfig).toBeDefined();
    const config = lastGetInstanceConfig as Record<string, unknown>;
    expect(config.command).toBe('agent-level-command');
  });
});
