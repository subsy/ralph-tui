/**
 * ABOUTME: Tests for the runVersion method's conditional shell behavior.
 * Verifies that shell: true is only used on Windows (process.platform === 'win32'),
 * and that paths with spaces are properly quoted for Windows shell execution (issue #206).
 *
 * IMPORTANT: The mock is set up in beforeAll (not at module level) to prevent
 * polluting other test files. The module under test is dynamically imported
 * after the mock is applied.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

// Track all spawn calls for verification
interface SpawnCall {
  cmd: string;
  args: string[];
  options?: { shell?: boolean };
}
let spawnCalls: SpawnCall[] = [];
let mockSpawnCallIndex = 0;

// Configurable responses for different spawn calls
interface SpawnResponse {
  stdout: string;
  exitCode: number;
}
let spawnResponses: SpawnResponse[] = [];

function createMockChildProcess(callIndex: number) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};

  // Get response for this call
  const response = spawnResponses[callIndex] ?? { stdout: '', exitCode: 0 };

  // Emit data and close asynchronously
  setTimeout(() => {
    if (response.stdout) {
      proc.stdout.emit('data', Buffer.from(response.stdout));
    }
    proc.emit('close', response.exitCode);
  }, 0);

  return proc;
}

// Declare the types for the imports
let ClaudeAgentPlugin: typeof import('../../../src/plugins/agents/builtin/claude.js').ClaudeAgentPlugin;
let OpenCodeAgentPlugin: typeof import('../../../src/plugins/agents/builtin/opencode.js').OpenCodeAgentPlugin;
let quoteForWindowsShell: typeof import('../../../src/plugins/agents/base.js').quoteForWindowsShell;

describe('runVersion conditional shell behavior (PR #187)', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeAll(async () => {
    // Mock child_process.spawn to capture all calls
    mock.module('node:child_process', () => ({
      spawn: (cmd: string, args: string[], options?: { shell?: boolean }) => {
        const callIndex = mockSpawnCallIndex++;
        spawnCalls.push({ cmd, args, options });
        return createMockChildProcess(callIndex);
      },
    }));

    // Dynamically import after mocking
    const claudeModule = await import('../../../src/plugins/agents/builtin/claude.js');
    ClaudeAgentPlugin = claudeModule.ClaudeAgentPlugin;

    const opencodeModule = await import('../../../src/plugins/agents/builtin/opencode.js');
    OpenCodeAgentPlugin = opencodeModule.OpenCodeAgentPlugin;

    const baseModule = await import('../../../src/plugins/agents/base.js');
    quoteForWindowsShell = baseModule.quoteForWindowsShell;
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    // Reset state before each test
    spawnCalls = [];
    mockSpawnCallIndex = 0;
    // Default responses: first call is findCommandPath (which), second is runVersion
    spawnResponses = [
      { stdout: '/usr/local/bin/claude', exitCode: 0 }, // findCommandPath
      { stdout: 'claude 1.0.5', exitCode: 0 }, // runVersion
    ];

    // Store original platform descriptor
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    // Restore original platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  describe('ClaudeAgentPlugin', () => {
    test('uses shell: false on Linux platform', async () => {
      // Mock platform as linux
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const plugin = new ClaudeAgentPlugin();
      await plugin.initialize({});

      // detect() calls findCommandPath then runVersion
      await plugin.detect();

      // First call is findCommandPath (which), second is runVersion
      expect(spawnCalls.length).toBe(2);

      // Verify the runVersion call (second call)
      const runVersionCall = spawnCalls[1];
      expect(runVersionCall.args).toContain('--version');
      expect(runVersionCall.options?.shell).toBe(false);

      await plugin.dispose();
    });

    test('uses shell: false on macOS platform', async () => {
      // Mock platform as darwin (macOS)
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      const plugin = new ClaudeAgentPlugin();
      await plugin.initialize({});

      await plugin.detect();

      expect(spawnCalls.length).toBe(2);
      const runVersionCall = spawnCalls[1];
      expect(runVersionCall.args).toContain('--version');
      expect(runVersionCall.options?.shell).toBe(false);

      await plugin.dispose();
    });

    test('uses shell: true on Windows platform', async () => {
      // Mock platform as win32
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      // On Windows, findCommandPath uses 'where' with shell: true
      spawnResponses = [
        { stdout: 'C:\\Program Files\\claude\\claude.exe', exitCode: 0 },
        { stdout: 'claude 1.0.5', exitCode: 0 },
      ];

      const plugin = new ClaudeAgentPlugin();
      await plugin.initialize({});

      await plugin.detect();

      expect(spawnCalls.length).toBe(2);

      // Verify the runVersion call (second call) uses shell: true on Windows
      const runVersionCall = spawnCalls[1];
      expect(runVersionCall.args).toContain('--version');
      expect(runVersionCall.options?.shell).toBe(true);

      // Verify path with spaces is quoted for Windows shell (issue #206)
      expect(runVersionCall.cmd).toBe('"C:\\Program Files\\claude\\claude.exe"');

      await plugin.dispose();
    });

    test('does not quote paths without spaces on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      spawnResponses = [
        { stdout: 'C:\\claude\\claude.exe', exitCode: 0 },
        { stdout: 'claude 1.0.5', exitCode: 0 },
      ];

      const plugin = new ClaudeAgentPlugin();
      await plugin.initialize({});

      await plugin.detect();

      expect(spawnCalls.length).toBe(2);
      const runVersionCall = spawnCalls[1];
      // No quotes needed when path has no spaces
      expect(runVersionCall.cmd).toBe('C:\\claude\\claude.exe');

      await plugin.dispose();
    });

    test('detect returns version when binary found and version check succeeds', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      spawnResponses = [
        { stdout: '/usr/local/bin/claude', exitCode: 0 },
        { stdout: 'claude 2.1.0', exitCode: 0 },
      ];

      const plugin = new ClaudeAgentPlugin();
      await plugin.initialize({});

      const result = await plugin.detect();

      expect(result.available).toBe(true);
      expect(result.version).toBe('2.1.0');

      await plugin.dispose();
    });

    test('detect returns error when version check fails with non-zero exit', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      spawnResponses = [
        { stdout: '/usr/local/bin/claude', exitCode: 0 },
        { stdout: '', exitCode: 1 }, // Version check fails
      ];

      const plugin = new ClaudeAgentPlugin();
      await plugin.initialize({});

      const result = await plugin.detect();

      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();

      await plugin.dispose();
    });

    test('detect returns not available when binary not found', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      spawnResponses = [
        { stdout: '', exitCode: 1 }, // findCommandPath fails
      ];

      const plugin = new ClaudeAgentPlugin();
      await plugin.initialize({});

      const result = await plugin.detect();

      expect(result.available).toBe(false);
      expect(result.error).toContain('not found');

      await plugin.dispose();
    });
  });

  describe('OpenCodeAgentPlugin', () => {
    beforeEach(() => {
      // Reset spawn responses for opencode
      spawnResponses = [
        { stdout: '/usr/local/bin/opencode', exitCode: 0 },
        { stdout: 'opencode 0.5.2', exitCode: 0 },
      ];
    });

    test('uses shell: false on Linux platform', async () => {
      // Mock platform as linux
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      await plugin.detect();

      expect(spawnCalls.length).toBe(2);

      // Verify the runVersion call (second call)
      const runVersionCall = spawnCalls[1];
      expect(runVersionCall.args).toContain('--version');
      expect(runVersionCall.options?.shell).toBe(false);

      await plugin.dispose();
    });

    test('uses shell: false on macOS platform', async () => {
      // Mock platform as darwin (macOS)
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      const plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      await plugin.detect();

      expect(spawnCalls.length).toBe(2);
      const runVersionCall = spawnCalls[1];
      expect(runVersionCall.args).toContain('--version');
      expect(runVersionCall.options?.shell).toBe(false);

      await plugin.dispose();
    });

    test('uses shell: true on Windows platform', async () => {
      // Mock platform as win32
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      spawnResponses = [
        { stdout: 'C:\\Program Files\\opencode\\opencode.exe', exitCode: 0 },
        { stdout: 'opencode 0.5.2', exitCode: 0 },
      ];

      const plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      await plugin.detect();

      expect(spawnCalls.length).toBe(2);

      // Verify the runVersion call (second call) uses shell: true on Windows
      const runVersionCall = spawnCalls[1];
      expect(runVersionCall.args).toContain('--version');
      expect(runVersionCall.options?.shell).toBe(true);

      // Verify path with spaces is quoted for Windows shell (issue #206)
      expect(runVersionCall.cmd).toBe('"C:\\Program Files\\opencode\\opencode.exe"');

      await plugin.dispose();
    });

    test('does not quote paths without spaces on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      spawnResponses = [
        { stdout: 'C:\\opencode\\opencode.exe', exitCode: 0 },
        { stdout: 'opencode 0.5.2', exitCode: 0 },
      ];

      const plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      await plugin.detect();

      expect(spawnCalls.length).toBe(2);
      const runVersionCall = spawnCalls[1];
      // No quotes needed when path has no spaces
      expect(runVersionCall.cmd).toBe('C:\\opencode\\opencode.exe');

      await plugin.dispose();
    });

    test('detect returns version when binary found and version check succeeds', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      spawnResponses = [
        { stdout: '/usr/local/bin/opencode', exitCode: 0 },
        { stdout: 'opencode 0.5.2', exitCode: 0 },
      ];

      const plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      const result = await plugin.detect();

      expect(result.available).toBe(true);
      expect(result.version).toBe('0.5.2');

      await plugin.dispose();
    });

    test('detect returns error when version check fails with non-zero exit', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      spawnResponses = [
        { stdout: '/usr/local/bin/opencode', exitCode: 0 },
        { stdout: '', exitCode: 1 }, // Version check fails
      ];

      const plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      const result = await plugin.detect();

      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();

      await plugin.dispose();
    });

    test('detect returns not available when binary not found', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      spawnResponses = [
        { stdout: '', exitCode: 1 }, // findCommandPath fails
      ];

      const plugin = new OpenCodeAgentPlugin();
      await plugin.initialize({});

      const result = await plugin.detect();

      expect(result.available).toBe(false);
      expect(result.error).toContain('not found');

      await plugin.dispose();
    });
  });
});

describe('quoteForWindowsShell (issue #206)', () => {
  beforeAll(async () => {
    // Make sure quoteForWindowsShell is available
    if (!quoteForWindowsShell) {
      const baseModule = await import('../../../src/plugins/agents/base.js');
      quoteForWindowsShell = baseModule.quoteForWindowsShell;
    }
  });

  test('quotes paths containing spaces', () => {
    expect(quoteForWindowsShell('C:\\Program Files\\nodejs\\opencode.cmd')).toBe(
      '"C:\\Program Files\\nodejs\\opencode.cmd"'
    );
  });

  test('does not quote paths without spaces', () => {
    expect(quoteForWindowsShell('C:\\nodejs\\opencode.cmd')).toBe(
      'C:\\nodejs\\opencode.cmd'
    );
  });

  test('does not double-quote already-quoted paths', () => {
    expect(quoteForWindowsShell('"C:\\Program Files\\opencode.cmd"')).toBe(
      '"C:\\Program Files\\opencode.cmd"'
    );
  });

  test('handles simple command names without modification', () => {
    expect(quoteForWindowsShell('opencode')).toBe('opencode');
  });

  test('handles empty string', () => {
    expect(quoteForWindowsShell('')).toBe('');
  });

  test('quotes Unix paths with spaces', () => {
    expect(quoteForWindowsShell('/usr/local/my programs/bin/tool')).toBe(
      '"/usr/local/my programs/bin/tool"'
    );
  });
});
