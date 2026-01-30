/**
 * ABOUTME: Tests for the setup wizard functionality.
 * Tests config file creation, tracker selection, and instruction display.
 * Uses mocked prompts to simulate user input.
 */

import {
  describe,
  expect,
  test,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  mock,
  spyOn,
} from 'bun:test';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

// Store mock implementations that can be changed per test
let mockPromptSelect: (prompt: string, choices: unknown[], options?: unknown) => Promise<string>;
let mockPromptNumber: (prompt: string, options?: unknown) => Promise<number>;
let mockPromptBoolean: (prompt: string, options?: unknown) => Promise<boolean>;
let mockIsInteractiveTerminal: () => boolean;

// Mock skill-installer to avoid file system operations during tests
let mockBundledSkills: Array<{ name: string; description: string; path: string }> = [];
let mockInstallViaAddSkillResult = { success: true, output: '' };

// Mock tracker plugin instances for deterministic detection results.
// Beads-family trackers have detect() returning unavailable; json has no detect().
// Override mockTrackerDetectOverride per-test to change detect() behavior.
let mockTrackerDetectOverride: ((id: string) => Promise<{ available: boolean; error?: string }>) | null = null;

// Create a function to generate mock agent instances
const createMockAgentInstance = (id: string, name: string) => ({
  preflight: () => Promise.resolve({ success: true, durationMs: 100 }),
  meta: { id, name, description: `${name} AI`, version: '1.0.0' },
  detect: () => Promise.resolve({ available: true, version: '1.0.0' }),
  initialize: () => Promise.resolve(),
  dispose: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
  getSetupQuestions: () => [],
});

const createMockTrackerInstance = (id: string) => {
  const isBeadsFamily = id === 'beads' || id === 'beads-bv' || id === 'beads-rust';
  return {
    initialize: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
    isReady: () => Promise.resolve(!isBeadsFamily),
    getSetupQuestions: () => [],
    meta: { id, name: id, description: `${id} tracker`, version: '1.0.0' },
    ...(isBeadsFamily
      ? {
          detect: () => {
            if (mockTrackerDetectOverride) {
              return mockTrackerDetectOverride(id);
            }
            return Promise.resolve({
              available: false,
              error: `.beads directory not found: /tmp/.beads`,
            });
          },
        }
      : {}),
  };
};

const trackerPluginMeta = [
  { id: 'json', name: 'JSON', description: 'JSON file tracker', version: '1.0.0' },
  { id: 'beads', name: 'Beads', description: 'Beads tracker', version: '1.0.0' },
  { id: 'beads-bv', name: 'Beads + BV', description: 'Beads + BV tracker', version: '1.0.0' },
  { id: 'beads-rust', name: 'Beads Rust', description: 'Beads Rust tracker', version: '1.0.0' },
];

// Declare wizard module exports to be populated after dynamic import
let projectConfigExists: typeof import('./wizard.js').projectConfigExists;
let runSetupWizard: typeof import('./wizard.js').runSetupWizard;
let checkAndRunSetup: typeof import('./wizard.js').checkAndRunSetup;
let formatTrackerUnavailableReason: typeof import('./wizard.js').formatTrackerUnavailableReason;

// Helper to create a temp directory for each test
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-wizard-test-'));
}

describe('wizard', () => {
  // Set up all mocks in beforeAll and dynamically import the module under test
  // This follows the Bun Mock Module Pattern to prevent mock leakage to other test files
  beforeAll(async () => {
    // Mock the prompts module
    mock.module('./prompts.js', () => ({
      promptSelect: (...args: Parameters<typeof mockPromptSelect>) => mockPromptSelect(...args),
      promptNumber: (...args: Parameters<typeof mockPromptNumber>) => mockPromptNumber(...args),
      promptBoolean: (...args: Parameters<typeof mockPromptBoolean>) => mockPromptBoolean(...args),
      promptText: () => Promise.resolve(''),
      promptPath: () => Promise.resolve(''),
      promptQuestion: () => Promise.resolve(''),
      printSection: (...args: unknown[]) => { console.log(...args); },
      printSuccess: (...args: unknown[]) => { console.log(...args); },
      printInfo: (...args: unknown[]) => { console.log(...args); },
      printError: (...args: unknown[]) => { console.log(...args); },
      isInteractiveTerminal: () => mockIsInteractiveTerminal(),
    }));

    // Mock skill-installer with all exports that might be used by dependent modules
    mock.module('./skill-installer.js', () => ({
      listBundledSkills: () => Promise.resolve(mockBundledSkills),
      isSkillInstalledAt: () => Promise.resolve(false),
      resolveSkillsPath: (p: string) => p.replace(/^~/, '/home/test'),
      installViaAddSkill: () => Promise.resolve(mockInstallViaAddSkillResult),
      resolveAddSkillAgentId: (id: string) => (id === 'claude' ? 'claude-code' : id),
      buildAddSkillInstallArgs: () => [],
      expandTilde: (p: string) => p.replace(/^~/, '/home/test'),
      computeSkillsPath: (dir: string) => `${dir}/skills`,
      getBundledSkillsDir: () => '/mock/skills',
      isEloopOnlyFailure: () => false,
      getSkillStatusForAgent: () => Promise.resolve({ installed: [], available: [] }),
      AGENT_ID_MAP: { claude: 'claude-code', opencode: 'opencode' },
    }));

    // Mock tracker registry
    mock.module('../plugins/trackers/registry.js', () => ({
      getTrackerRegistry: () => ({
        initialize: () => Promise.resolve(),
        getRegisteredPlugins: () => trackerPluginMeta,
        createInstance: (id: string) => createMockTrackerInstance(id),
        hasPlugin: (name: string) => trackerPluginMeta.some((p) => p.id === name),
        registerBuiltin: () => {},
      }),
    }));

    // Mock registerBuiltinTrackers to no-op since registry is fully mocked
    mock.module('../plugins/trackers/builtin/index.js', () => ({
      registerBuiltinTrackers: () => {},
    }));

    // Mock the agent registry to return our mock instance
    mock.module('../plugins/agents/registry.js', () => ({
      getAgentRegistry: () => ({
        getInstance: () => Promise.resolve(createMockAgentInstance('claude', 'Claude Code')),
        initialize: () => Promise.resolve(),
        getRegisteredPlugins: () => [
          { id: 'claude', name: 'Claude Code', description: 'Claude AI', version: '1.0.0' },
          { id: 'opencode', name: 'OpenCode', description: 'OpenCode AI', version: '1.0.0' },
          { id: 'droid', name: 'Droid', description: 'Factory Droid', version: '1.0.0' },
        ],
        getPluginMeta: (id: string) => ({
          id,
          name: id === 'claude' ? 'Claude Code' : id,
          description: `${id} AI`,
          version: '1.0.0',
          defaultCommand: id,
          supportsStreaming: true,
          supportsInterrupt: true,
          supportsFileContext: true,
          supportsSubagentTracing: true,
          skillsPaths: {
            personal: `~/.${id}/skills`,
            repo: `.${id}/skills`,
          },
        }),
        createInstance: (id: string) => createMockAgentInstance(id, id),
        hasPlugin: (name: string) => ['claude', 'opencode', 'droid'].includes(name),
        registerBuiltin: () => {},
      }),
      registerAgentPlugin: () => {},
    }));

    // Dynamically import the module under test after mocks are set up
    const wizardModule = await import('./wizard.js');
    projectConfigExists = wizardModule.projectConfigExists;
    runSetupWizard = wizardModule.runSetupWizard;
    checkAndRunSetup = wizardModule.checkAndRunSetup;
    formatTrackerUnavailableReason = wizardModule.formatTrackerUnavailableReason;
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
    mockIsInteractiveTerminal = () => true;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
  });

  test('fails with helpful message when not in interactive terminal', async () => {
    // Simulate non-TTY environment (like running in container or piped input)
    mockIsInteractiveTerminal = () => false;

    const result = await runSetupWizard({ cwd: tempDir });

    expect(result.success).toBe(false);
    expect(result.error).toContain('interactive terminal');
    expect(result.error).toContain('TTY');
    expect(result.error).toContain('.ralph-tui/config.toml');
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

  test('shows epic-specific instructions for beads tracker', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('beads');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Check that beads-specific epic instructions were printed
    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui run');
    expect(output).toContain('--epic');
    expect(output).toContain('Interactive epic selection');
    expect(output).toContain('ralph-tui convert --to beads');
    expect(output).not.toContain('ralph-tui run --prd');
  });

  test('shows epic-specific instructions for beads-bv tracker', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('beads-bv');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Check that beads-specific instructions were printed
    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui run');
    expect(output).toContain('--epic');
    expect(output).toContain('ralph-tui convert --to beads');
    expect(output).not.toContain('ralph-tui run --prd');
  });

  test('shows epic-specific instructions for beads-rust tracker', async () => {
    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('beads-rust');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Check that beads-specific instructions were printed
    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui run');
    expect(output).toContain('--epic');
    expect(output).toContain('ralph-tui convert --to beads');
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
    mockIsInteractiveTerminal = () => true;

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
    mockBundledSkills = [];
    mockInstallViaAddSkillResult = { success: true, output: '' };

    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args) => {
      capturedOutput.push(args.join(' '));
    });

    mockPromptSelect = () => Promise.resolve('json');
    mockPromptNumber = () => Promise.resolve(10);
    mockPromptBoolean = () => Promise.resolve(false);
    mockIsInteractiveTerminal = () => true;
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

  test('installs skills via installViaAddSkill on success', async () => {
    mockBundledSkills = [
      { name: 'ralph-tui-prd', description: 'PRD generator', path: '/skills/ralph-tui-prd' },
    ];
    mockInstallViaAddSkillResult = { success: true, output: '' };

    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };
    mockPromptBoolean = () => Promise.resolve(true);

    await runSetupWizard({ cwd: tempDir });

    const output = capturedOutput.join('\n');
    expect(output).toContain('Installed');
    expect(output).toContain('ralph-tui-prd');
  });

  test('shows error when installViaAddSkill fails', async () => {
    mockBundledSkills = [
      { name: 'ralph-tui-prd', description: 'PRD generator', path: '/skills/ralph-tui-prd' },
    ];
    mockInstallViaAddSkillResult = { success: false, output: 'ENOENT: not found' };

    mockPromptSelect = (prompt) => {
      if (prompt.includes('tracker')) return Promise.resolve('json');
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };
    mockPromptBoolean = () => Promise.resolve(true);

    await runSetupWizard({ cwd: tempDir });

    const output = capturedOutput.join('\n');
    expect(output).toContain('Failed');
    expect(output).toContain('ENOENT');
  });
});

describe('tracker detection and unavailability', () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let capturedOutput: string[];
  let capturedTrackerChoices: Array<{ value: string; label: string; description: string }>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    capturedOutput = [];
    capturedTrackerChoices = [];
    mockTrackerDetectOverride = null;

    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args) => {
      capturedOutput.push(args.join(' '));
    });

    mockPromptNumber = () => Promise.resolve(10);
    mockPromptBoolean = () => Promise.resolve(false);
    mockIsInteractiveTerminal = () => true;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
  });

  test('marks beads trackers as unavailable when .beads dir and CLI missing', async () => {
    // Capture the tracker choices passed to promptSelect
    mockPromptSelect = (prompt: string, choices: unknown[]) => {
      if (prompt.includes('tracker')) {
        capturedTrackerChoices = choices as typeof capturedTrackerChoices;
        return Promise.resolve('json');
      }
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // In test environment without .beads dir or CLIs, beads trackers should be unavailable
    const beadsChoice = capturedTrackerChoices.find((c) => c.value === 'beads');
    expect(beadsChoice).toBeDefined();
    expect(beadsChoice!.label).toContain('unavailable');

    const beadsBvChoice = capturedTrackerChoices.find((c) => c.value === 'beads-bv');
    expect(beadsBvChoice).toBeDefined();
    expect(beadsBvChoice!.label).toContain('unavailable');

    const beadsRustChoice = capturedTrackerChoices.find((c) => c.value === 'beads-rust');
    expect(beadsRustChoice).toBeDefined();
    expect(beadsRustChoice!.label).toContain('unavailable');
  });

  test('marks json tracker as available', async () => {
    mockPromptSelect = (prompt: string, choices: unknown[]) => {
      if (prompt.includes('tracker')) {
        capturedTrackerChoices = choices as typeof capturedTrackerChoices;
        return Promise.resolve('json');
      }
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    const jsonChoice = capturedTrackerChoices.find((c) => c.value === 'json');
    expect(jsonChoice).toBeDefined();
    expect(jsonChoice!.label).not.toContain('unavailable');
  });

  test('shows helpful reason for unavailable beads trackers', async () => {
    mockPromptSelect = (prompt: string, choices: unknown[]) => {
      if (prompt.includes('tracker')) {
        capturedTrackerChoices = choices as typeof capturedTrackerChoices;
        return Promise.resolve('json');
      }
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Check that unavailable tracker descriptions contain helpful reasons
    const beadsChoice = capturedTrackerChoices.find((c) => c.value === 'beads');
    expect(beadsChoice).toBeDefined();
    // Should mention either missing directory or missing CLI
    const desc = beadsChoice!.description;
    const hasHelpfulReason =
      desc.includes('.beads') ||
      desc.includes('CLI not found') ||
      desc.includes('not found') ||
      desc.includes('init');
    expect(hasHelpfulReason).toBe(true);
  });

  test('shows beads-rust unavailable reason mentioning br CLI', async () => {
    mockPromptSelect = (prompt: string, choices: unknown[]) => {
      if (prompt.includes('tracker')) {
        capturedTrackerChoices = choices as typeof capturedTrackerChoices;
        return Promise.resolve('json');
      }
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // beads-rust description should mention "br" CLI specifically (not "bd")
    const beadsRustChoice = capturedTrackerChoices.find((c) => c.value === 'beads-rust');
    expect(beadsRustChoice).toBeDefined();
    const desc = beadsRustChoice!.description;
    // If the error is about missing directory, it'll say ".beads"
    // If the error is about missing CLI, it should say "br" not "bd"
    if (desc.includes('CLI not found')) {
      expect(desc).toContain('br');
    } else {
      // Directory not found case - also valid
      expect(desc.includes('.beads') || desc.includes('init')).toBe(true);
    }
  });

  test('handles detect() throwing an error gracefully', async () => {
    // Override detect to throw an error for beads trackers
    mockTrackerDetectOverride = () => {
      throw new Error('Unexpected detection failure');
    };

    mockPromptSelect = (prompt: string, choices: unknown[]) => {
      if (prompt.includes('tracker')) {
        capturedTrackerChoices = choices as typeof capturedTrackerChoices;
        return Promise.resolve('json');
      }
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Beads trackers should still be unavailable (error caught)
    const beadsChoice = capturedTrackerChoices.find((c) => c.value === 'beads');
    expect(beadsChoice).toBeDefined();
    expect(beadsChoice!.label).toContain('unavailable');

    // JSON should still be available (no detect() method, so no error)
    const jsonChoice = capturedTrackerChoices.find((c) => c.value === 'json');
    expect(jsonChoice).toBeDefined();
    expect(jsonChoice!.label).not.toContain('unavailable');

    // Reset override
    mockTrackerDetectOverride = null;
  });

  test('defaults to first available tracker (json) when beads unavailable', async () => {
    let trackerDefault: string | undefined;
    mockPromptSelect = (prompt: string, _choices: unknown[], options?: unknown) => {
      if (prompt.includes('tracker')) {
        trackerDefault = (options as { default?: string })?.default;
        return Promise.resolve('json');
      }
      if (prompt.includes('agent')) return Promise.resolve('claude');
      return Promise.resolve('');
    };

    await runSetupWizard({ cwd: tempDir });

    // Default should be json since beads trackers are unavailable
    expect(trackerDefault).toBe('json');
  });
});

describe('formatTrackerUnavailableReason', () => {
  test('returns directory guidance when error mentions directory not found', () => {
    const result = formatTrackerUnavailableReason({
      id: 'beads',
      name: 'Beads',
      description: 'Beads tracker',
      available: false,
      error: 'Beads directory not found: /tmp/.beads',
    });
    expect(result).toContain('.beads');
    expect(result).toContain('bd init');
    expect(result).toContain('br init');
  });

  test('returns bd CLI guidance for beads tracker when binary not available', () => {
    const result = formatTrackerUnavailableReason({
      id: 'beads',
      name: 'Beads',
      description: 'Beads tracker',
      available: false,
      error: 'bd binary not available: spawn bd ENOENT',
    });
    expect(result).toContain('bd CLI not found');
  });

  test('returns bd CLI guidance for beads-bv tracker when binary not available', () => {
    const result = formatTrackerUnavailableReason({
      id: 'beads-bv',
      name: 'Beads + BV',
      description: 'Beads + bv tracker',
      available: false,
      error: 'bd binary not available: command not found',
    });
    expect(result).toContain('bd CLI not found');
  });

  test('returns br CLI guidance for beads-rust tracker when binary not available', () => {
    const result = formatTrackerUnavailableReason({
      id: 'beads-rust',
      name: 'Beads Rust',
      description: 'Beads Rust tracker',
      available: false,
      error: 'br binary not available: spawn br ENOENT',
    });
    expect(result).toContain('br CLI not found');
  });

  test('returns raw error when error does not match known patterns', () => {
    const result = formatTrackerUnavailableReason({
      id: 'beads',
      name: 'Beads',
      description: 'Beads tracker',
      available: false,
      error: 'Some unexpected error occurred',
    });
    expect(result).toBe('Some unexpected error occurred');
  });

  test('returns description fallback when no error provided', () => {
    const result = formatTrackerUnavailableReason({
      id: 'beads',
      name: 'Beads',
      description: 'Beads tracker',
      available: false,
    });
    expect(result).toContain('Beads tracker');
    expect(result).toContain('not detected');
  });

  test('skips beads heuristics for non-beads trackers and returns raw error', () => {
    // A non-beads tracker with a "directory not found" error should NOT get beads-specific guidance
    const result = formatTrackerUnavailableReason({
      id: 'custom-tracker',
      name: 'Custom',
      description: 'Custom tracker',
      available: false,
      error: 'directory not found at /some/path',
    });
    // Should return raw error, not beads-specific ".beads directory" guidance
    expect(result).toBe('directory not found at /some/path');
    expect(result).not.toContain('bd init');
    expect(result).not.toContain('br init');
  });

  test('skips beads heuristics for non-beads tracker with "not available" error', () => {
    const result = formatTrackerUnavailableReason({
      id: 'custom-tracker',
      name: 'Custom',
      description: 'Custom tracker',
      available: false,
      error: 'binary not available: some-binary',
    });
    // Should return raw error, not beads-specific CLI guidance
    expect(result).toBe('binary not available: some-binary');
    expect(result).not.toContain('CLI not found');
  });
});
}); // end describe('wizard')
