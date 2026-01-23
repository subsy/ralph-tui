/**
 * ABOUTME: Tests for the create-prd command.
 * Tests argument parsing and help output functionality.
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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock agent instance
const createMockAgentInstance = () => ({
  meta: { id: 'claude', name: 'Claude Code' },
  detect: () => Promise.resolve({ available: true, version: '1.0.0', executablePath: '/usr/bin/mock' }),
  preflight: () => Promise.resolve({ success: true, durationMs: 100 }),
  isReady: () => Promise.resolve(true),
  initialize: () => Promise.resolve(),
  dispose: () => Promise.resolve(),
});

// Mock the agent registry
mock.module('../plugins/agents/registry.js', () => ({
  getAgentRegistry: () => ({
    getInstance: () => Promise.resolve(createMockAgentInstance()),
    hasPlugin: (name: string) => name === 'claude' || name === 'opencode',
    registerBuiltin: () => {},
    initialize: () => Promise.resolve(),
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

// Import after mocking
import { parseCreatePrdArgs, parseTrackerLabels, printCreatePrdHelp } from './create-prd.js';

// Helper to create temp directory
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-create-prd-test-'));
}

// Clean up mocks after all tests
afterAll(() => {
  mock.restore();
});

describe('parseCreatePrdArgs', () => {
  test('parses --cwd flag', () => {
    const args = parseCreatePrdArgs(['--cwd', '/test/path']);
    expect(args.cwd).toBe('/test/path');
  });

  test('parses -C shorthand for cwd', () => {
    const args = parseCreatePrdArgs(['-C', '/test/path']);
    expect(args.cwd).toBe('/test/path');
  });

  test('parses --output flag', () => {
    const args = parseCreatePrdArgs(['--output', 'my-tasks']);
    expect(args.output).toBe('my-tasks');
  });

  test('parses --agent flag', () => {
    const args = parseCreatePrdArgs(['--agent', 'opencode']);
    expect(args.agent).toBe('opencode');
  });

  test('parses --timeout flag', () => {
    const args = parseCreatePrdArgs(['--timeout', '5000']);
    expect(args.timeout).toBe(5000);
  });

  test('parses --stories flag', () => {
    const args = parseCreatePrdArgs(['--stories', '10']);
    expect(args.stories).toBe(10);
  });

  test('parses --force flag', () => {
    const args = parseCreatePrdArgs(['--force']);
    expect(args.force).toBe(true);
  });

  test('parses --prd-skill flag', () => {
    const args = parseCreatePrdArgs(['--prd-skill', 'custom-prd']);
    expect(args.prdSkill).toBe('custom-prd');
  });

  test('handles multiple flags', () => {
    const args = parseCreatePrdArgs([
      '--cwd', '/test',
      '--agent', 'claude',
      '--timeout', '3000',
      '--force',
    ]);
    expect(args.cwd).toBe('/test');
    expect(args.agent).toBe('claude');
    expect(args.timeout).toBe(3000);
    expect(args.force).toBe(true);
  });

  test('returns empty object for no args', () => {
    const args = parseCreatePrdArgs([]);
    expect(args).toEqual({});
  });
});

describe('printCreatePrdHelp', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args) => {
      capturedOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test('prints usage information', () => {
    printCreatePrdHelp();
    const output = capturedOutput.join('\n');
    expect(output).toContain('ralph-tui create-prd');
    expect(output).toContain('Usage:');
  });

  test('prints options section', () => {
    printCreatePrdHelp();
    const output = capturedOutput.join('\n');
    expect(output).toContain('Options:');
    expect(output).toContain('--cwd');
    expect(output).toContain('--agent');
    expect(output).toContain('--timeout');
  });

  test('mentions prime alias', () => {
    printCreatePrdHelp();
    const output = capturedOutput.join('\n');
    expect(output).toContain('prime');
  });
});

describe('create-prd config propagation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Note: Testing config propagation in create-prd requires the full command execution
  // which involves TUI rendering. Instead, we test the argument parsing which is
  // the entry point for config propagation.

  test('parseCreatePrdArgs does not expose envExclude (handled internally)', () => {
    // envExclude is a config option, not a CLI arg
    // This test verifies the parsing is clean
    const args = parseCreatePrdArgs(['--agent', 'claude']);
    expect(args.agent).toBe('claude');
    expect((args as Record<string, unknown>).envExclude).toBeUndefined();
  });
});

describe('parseTrackerLabels', () => {
  test('returns undefined when trackerOptions is undefined', () => {
    expect(parseTrackerLabels(undefined)).toBeUndefined();
  });

  test('returns undefined when labels key is missing', () => {
    expect(parseTrackerLabels({ epicId: 'test' })).toBeUndefined();
  });

  test('parses comma-separated string labels', () => {
    expect(parseTrackerLabels({ labels: 'ralph,frontend' })).toEqual(['ralph', 'frontend']);
  });

  test('trims whitespace from string labels', () => {
    expect(parseTrackerLabels({ labels: ' ralph , frontend , backend ' })).toEqual([
      'ralph',
      'frontend',
      'backend',
    ]);
  });

  test('filters empty entries from string labels', () => {
    expect(parseTrackerLabels({ labels: 'ralph,,frontend,' })).toEqual(['ralph', 'frontend']);
  });

  test('returns undefined for empty string', () => {
    expect(parseTrackerLabels({ labels: '' })).toBeUndefined();
  });

  test('returns undefined for whitespace-only string', () => {
    expect(parseTrackerLabels({ labels: '  ,  , ' })).toBeUndefined();
  });

  test('parses array labels', () => {
    expect(parseTrackerLabels({ labels: ['ralph', 'frontend'] })).toEqual(['ralph', 'frontend']);
  });

  test('trims whitespace from array labels', () => {
    expect(parseTrackerLabels({ labels: [' ralph ', ' frontend '] })).toEqual([
      'ralph',
      'frontend',
    ]);
  });

  test('filters non-string entries from array', () => {
    expect(parseTrackerLabels({ labels: ['ralph', 42, null, 'backend', undefined] })).toEqual([
      'ralph',
      'backend',
    ]);
  });

  test('returns undefined for empty array', () => {
    expect(parseTrackerLabels({ labels: [] })).toBeUndefined();
  });

  test('returns undefined for array of only non-strings', () => {
    expect(parseTrackerLabels({ labels: [42, null, true] })).toBeUndefined();
  });

  test('returns undefined when labels is a number', () => {
    expect(parseTrackerLabels({ labels: 123 })).toBeUndefined();
  });

  test('returns undefined when labels is a boolean', () => {
    expect(parseTrackerLabels({ labels: true })).toBeUndefined();
  });
});
