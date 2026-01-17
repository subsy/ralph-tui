/**
 * ABOUTME: Tests for the setup wizard functionality.
 * Tests config file creation, tracker selection, and instruction display.
 * Uses mocked prompts to simulate user input.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  mock,
  spyOn,
} from 'bun:test';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import { registerBuiltinTrackers } from '../plugins/trackers/builtin/index.js';

// Store mock implementations that can be changed per test
let mockPromptSelect: (prompt: string, choices: unknown[], options?: unknown) => Promise<string>;
let mockPromptNumber: (prompt: string, options?: unknown) => Promise<number>;
let mockPromptBoolean: (prompt: string, options?: unknown) => Promise<boolean>;

// Mock the prompts module before importing wizard
mock.module('./prompts.js', () => ({
  promptSelect: (...args: Parameters<typeof mockPromptSelect>) => mockPromptSelect(...args),
  promptNumber: (...args: Parameters<typeof mockPromptNumber>) => mockPromptNumber(...args),
  promptBoolean: (...args: Parameters<typeof mockPromptBoolean>) => mockPromptBoolean(...args),
  promptText: () => Promise.resolve(''),
  promptPath: () => Promise.resolve(''),
  promptQuestion: () => Promise.resolve(''),
  printSection: () => {},
  printSuccess: () => {},
  printInfo: () => {},
  printError: () => {},
}));

// Mock skill-installer to avoid file system operations during tests
mock.module('./skill-installer.js', () => ({
  listBundledSkills: () => Promise.resolve([]),
  installSkill: () => Promise.resolve({ success: true }),
  isSkillInstalled: () => Promise.resolve(false),
}));

// Import after mocking
import {
  projectConfigExists,
  runSetupWizard,
  checkAndRunSetup,
} from './wizard.js';

// Helper to create a temp directory for each test
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-wizard-test-'));
}

// Register built-in plugins before tests
beforeAll(() => {
  registerBuiltinAgents();
  registerBuiltinTrackers();
});

// Restore mocks after all tests to prevent leakage to other test files
afterAll(() => {
  mock.restore();
});

describe('projectConfigExists', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns false when no config exists', async () => {
    const exists = await projectConfigExists(tempDir);
    expect(exists).toBe(false);
  });

  test('returns true when config file exists', async () => {
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.toml'), 'agent = "claude"', 'utf-8');

    const exists = await projectConfigExists(tempDir);
    expect(exists).toBe(true);
  });

  test('returns false when directory exists but no config file', async () => {
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });

    const exists = await projectConfigExists(tempDir);
    expect(exists).toBe(false);
  });
});

describe('runSetupWizard', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let capturedOutput: string[];

  beforeEach(async () => {
    tempDir = await createTempDir();
    capturedOutput = [];

    // Spy on console.log to capture output
    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args) => {
      capturedOutput.push(args.join(' '));
    });

    // Set default mock implementations
    mockPromptSelect = () => Promise.resolve('json');
    mockPromptNumber = () => Promise.resolve(10);
    mockPromptBoolean = () => Promise.resolve(false);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
  });

  test('creates config file in .ralph-tui directory', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    const result = await runSetupWizard({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.configPath).toBe(join(tempDir, '.ralph-tui', 'config.toml'));

    // Verify file was created
    const configContent = await readFile(result.configPath!, 'utf-8');
    expect(configContent).toContain('tracker');
  });

  test('saves correct tracker and agent in config', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('beads');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };
    mockPromptNumber = () => Promise.resolve(20);
    mockPromptBoolean = () => Promise.resolve(true);

    const result = await runSetupWizard({ cwd: tempDir });

    expect(result.success).toBe(true);
    expect(result.answers?.tracker).toBe('beads');
    expect(result.answers?.agent).toBe('claude');
    expect(result.answers?.maxIterations).toBe(20);
    expect(result.answers?.autoCommit).toBe(true);

    // Parse the saved TOML and verify structure
    const configContent = await readFile(result.configPath!, 'utf-8');
    const parsed = parseToml(configContent);
    expect(parsed.tracker).toBe('beads');
    expect(parsed.agent).toBe('claude');
    expect(parsed.maxIterations).toBe(20);
    expect(parsed.autoCommit).toBe(true);
  });

  test('shows PRD-specific instructions for json tracker', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Check that PRD instructions were printed
    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui create-prd');
    expect(output).toContain('ralph-tui run --prd');
  });

  test('shows standard instructions for beads tracker', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('beads');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Check that standard instructions were printed (not PRD-specific)
    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui run');
    expect(output).not.toContain('ralph-tui run --prd');
  });

  test('shows standard instructions for beads-bv tracker', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('beads-bv');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Check that standard instructions were printed
    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui run');
    expect(output).not.toContain('ralph-tui run --prd');
  });

  test('fails when config exists without force flag', async () => {
    // Create existing config
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.toml'), 'agent = "claude"', 'utf-8');

    const result = await runSetupWizard({ cwd: tempDir });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(result.error).toContain('--force');
  });

  test('overwrites config when force flag is set', async () => {
    // Create existing config
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.toml'), 'agent = "old-agent"', 'utf-8');

    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    const result = await runSetupWizard({ cwd: tempDir, force: true });

    expect(result.success).toBe(true);

    // Verify new config was written
    const configContent = await readFile(result.configPath!, 'utf-8');
    expect(configContent).toContain('claude');
    expect(configContent).not.toContain('old-agent');
  });

  test('config file has header comment', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    const result = await runSetupWizard({ cwd: tempDir });

    const configContent = await readFile(result.configPath!, 'utf-8');
    expect(configContent).toContain('# Ralph TUI Configuration');
    expect(configContent).toContain('# Generated by setup wizard');
  });
});

describe('checkAndRunSetup', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await createTempDir();

    // Set default mock implementations
    mockPromptSelect = () => Promise.resolve('json');
    mockPromptNumber = () => Promise.resolve(10);
    mockPromptBoolean = () => Promise.resolve(false);

    // Suppress console output
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  test('returns null when config already exists', async () => {
    // Create existing config
    const configDir = join(tempDir, '.ralph-tui');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.toml'), 'agent = "claude"', 'utf-8');

    const result = await checkAndRunSetup({ cwd: tempDir });

    expect(result).toBeNull();
  });

  test('returns null when skipSetup is true', async () => {
    const result = await checkAndRunSetup({ cwd: tempDir, skipSetup: true });

    expect(result).toBeNull();
  });

  test('runs wizard when no config exists', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    const result = await checkAndRunSetup({ cwd: tempDir });

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);

    // Verify config was created
    const exists = await projectConfigExists(tempDir);
    expect(exists).toBe(true);
  });
});

describe('wizard output messages', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let capturedOutput: string[];

  beforeEach(async () => {
    tempDir = await createTempDir();
    capturedOutput = [];

    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args) => {
      capturedOutput.push(args.join(' '));
    });

    mockPromptSelect = () => Promise.resolve('json');
    mockPromptNumber = () => Promise.resolve(10);
    mockPromptBoolean = () => Promise.resolve(false);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
  });

  test('prints welcome banner', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    const output = capturedOutput.join('\n');
    expect(output).toContain('Ralph TUI Setup Wizard');
  });

  test('mentions config show command', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui config show');
  });
});
