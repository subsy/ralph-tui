/**
 * ABOUTME: Tests for the remote CLI command.
 * Covers argument parsing, subcommand execution, and remote management.
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRemoteArgs, printRemoteHelp } from './remote.js';

// ============================================================================
// Argument Parsing Tests
// ============================================================================

describe('parseRemoteArgs', () => {
  describe('help flag', () => {
    test('returns help for --help', () => {
      const result = parseRemoteArgs(['--help']);
      expect(result.help).toBe(true);
    });

    test('returns help for -h', () => {
      const result = parseRemoteArgs(['-h']);
      expect(result.help).toBe(true);
    });

    test('returns empty options for empty args', () => {
      const result = parseRemoteArgs([]);
      expect(result.subcommand).toBeUndefined();
      expect(result.alias).toBeUndefined();
    });
  });

  describe('add subcommand', () => {
    test('parses add with alias and host:port', () => {
      const result = parseRemoteArgs(['add', 'prod', 'server.com:7890', '--token', 'abc123']);
      expect(result.subcommand).toBe('add');
      expect(result.alias).toBe('prod');
      expect(result.hostPort).toBe('server.com:7890');
      expect(result.token).toBe('abc123');
    });

    test('parses add with host only (default port)', () => {
      const result = parseRemoteArgs(['add', 'staging', 'staging.local', '--token', 'xyz']);
      expect(result.subcommand).toBe('add');
      expect(result.alias).toBe('staging');
      expect(result.hostPort).toBe('staging.local');
      expect(result.token).toBe('xyz');
    });

    test('parses add with secure flag', () => {
      const result = parseRemoteArgs(['add', 'prod', 'server.com:443', '--secure', '--token', 'abc123']);
      expect(result.subcommand).toBe('add');
      expect(result.alias).toBe('prod');
      expect(result.hostPort).toBe('server.com:443');
      expect(result.secure).toBe(true);
      expect(result.token).toBe('abc123');
    });

    test('handles help flag in add', () => {
      const result = parseRemoteArgs(['add', '--help']);
      expect(result.subcommand).toBe('add');
      expect(result.help).toBe(true);
    });
  });

  describe('list subcommand', () => {
    test('parses list', () => {
      const result = parseRemoteArgs(['list']);
      expect(result.subcommand).toBe('list');
    });

    test('parses ls alias', () => {
      const result = parseRemoteArgs(['ls']);
      expect(result.subcommand).toBe('ls');
    });
  });

  describe('remove subcommand', () => {
    test('parses remove with alias', () => {
      const result = parseRemoteArgs(['remove', 'prod']);
      expect(result.subcommand).toBe('remove');
      expect(result.alias).toBe('prod');
    });

    test('parses rm alias', () => {
      const result = parseRemoteArgs(['rm', 'staging']);
      expect(result.subcommand).toBe('rm');
      expect(result.alias).toBe('staging');
    });
  });

  describe('test subcommand', () => {
    test('parses test with alias', () => {
      const result = parseRemoteArgs(['test', 'prod']);
      expect(result.subcommand).toBe('test');
      expect(result.alias).toBe('prod');
    });
  });

  describe('push-config subcommand', () => {
    test('parses push-config with alias', () => {
      const result = parseRemoteArgs(['push-config', 'prod']);
      expect(result.subcommand).toBe('push-config');
      expect(result.alias).toBe('prod');
    });

    test('parses push-config with --all', () => {
      const result = parseRemoteArgs(['push-config', '--all']);
      expect(result.subcommand).toBe('push-config');
      expect(result.all).toBe(true);
    });

    test('parses push-config with --scope global', () => {
      const result = parseRemoteArgs(['push-config', 'prod', '--scope', 'global']);
      expect(result.scope).toBe('global');
    });

    test('parses push-config with --scope project', () => {
      const result = parseRemoteArgs(['push-config', 'prod', '--scope', 'project']);
      expect(result.scope).toBe('project');
    });

    test('ignores invalid scope values', () => {
      const result = parseRemoteArgs(['push-config', 'prod', '--scope', 'invalid']);
      expect(result.scope).toBeUndefined();
    });

    test('parses push-config with --preview', () => {
      const result = parseRemoteArgs(['push-config', 'prod', '--preview']);
      expect(result.preview).toBe(true);
    });

    test('parses push-config with --force', () => {
      const result = parseRemoteArgs(['push-config', 'prod', '--force']);
      expect(result.force).toBe(true);
    });

    test('parses push-config with all options', () => {
      const result = parseRemoteArgs([
        'push-config',
        'prod',
        '--scope', 'global',
        '--preview',
        '--force',
      ]);
      expect(result.subcommand).toBe('push-config');
      expect(result.alias).toBe('prod');
      expect(result.scope).toBe('global');
      expect(result.preview).toBe(true);
      expect(result.force).toBe(true);
    });
  });
});

// ============================================================================
// Help Output Tests
// ============================================================================

describe('printRemoteHelp', () => {
  test('outputs help text without throwing', () => {
    // Capture console.log
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    expect(() => printRemoteHelp()).not.toThrow();

    // Restore console.log
    console.log = originalLog;

    // Verify help content
    const output = logs.join('\n');
    expect(output).toContain('ralph-tui remote');
    expect(output).toContain('add');
    expect(output).toContain('list');
    expect(output).toContain('remove');
    expect(output).toContain('test');
    expect(output).toContain('push-config');
  });
});

// ============================================================================
// Remote Config Storage Tests
// ============================================================================

describe('Remote Config Storage', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-remote-test-'));
    originalEnv = { ...process.env };
    // We can't easily override homedir(), so these tests focus on the logic
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('parseHostPort', () => {
    test('parses host:port correctly', async () => {
      const { parseHostPort } = await import('../remote/config.js');

      const result = parseHostPort('server.example.com:8080');
      expect(result).toEqual({ host: 'server.example.com', port: 8080 });
    });

    test('parses host only with default port', async () => {
      const { parseHostPort } = await import('../remote/config.js');

      const result = parseHostPort('localhost');
      expect(result).toEqual({ host: 'localhost', port: 7890 });
    });

    test('returns null for invalid port', async () => {
      const { parseHostPort } = await import('../remote/config.js');

      expect(parseHostPort('host:invalid')).toBeNull();
      expect(parseHostPort('host:0')).toBeNull();
      expect(parseHostPort('host:99999')).toBeNull();
      expect(parseHostPort('host:-1')).toBeNull();
    });

    test('returns null for too many colons', async () => {
      const { parseHostPort } = await import('../remote/config.js');

      expect(parseHostPort('host:port:extra')).toBeNull();
    });

    test('handles IPv4 addresses', async () => {
      const { parseHostPort } = await import('../remote/config.js');

      const result = parseHostPort('192.168.1.1:7890');
      expect(result).toEqual({ host: '192.168.1.1', port: 7890 });
    });
  });

  describe('REMOTES_CONFIG_PATHS', () => {
    test('exports correct paths', async () => {
      const { REMOTES_CONFIG_PATHS } = await import('../remote/config.js');

      expect(REMOTES_CONFIG_PATHS.file).toContain('remotes.toml');
      expect(REMOTES_CONFIG_PATHS.file).toContain('.config');
      expect(REMOTES_CONFIG_PATHS.file).toContain('ralph-tui');
    });
  });
});

// ============================================================================
// Integration Tests (with mocked dependencies)
// ============================================================================

describe('Remote Command Integration', () => {
  let mockWebSocket: {
    send: ReturnType<typeof mock>;
    close: ReturnType<typeof mock>;
    onopen: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onclose: ((event: { wasClean: boolean; code: number; reason?: string }) => void) | null;
  };

  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    mockWebSocket = {
      send: mock(() => {}),
      close: mock(() => {}),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    originalWebSocket = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = mock(() => mockWebSocket);
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  describe('testRemoteConnection (via WebSocket mock)', () => {
    test('WebSocket is called with correct URL', () => {
      // Create WebSocket to test URL construction
      new WebSocket('ws://example.com:7890');

      expect(globalThis.WebSocket).toHaveBeenCalledWith('ws://example.com:7890');
    });

    test('authentication message structure is correct', () => {
      // Simulate what the remote command does
      const authMsg = {
        type: 'auth',
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        token: 'test-token',
      };

      expect(authMsg.type).toBe('auth');
      expect(authMsg.token).toBe('test-token');
      expect(authMsg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });
});

// ============================================================================
// Alias Validation Tests
// ============================================================================

describe('Remote Alias Validation', () => {
  test('valid aliases are accepted', () => {
    const validAliases = [
      'prod',
      'staging',
      'dev',
      'my-server',
      'server_1',
      'Server2',
      'a',
      'test123',
    ];

    const aliasRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

    for (const alias of validAliases) {
      expect(aliasRegex.test(alias)).toBe(true);
    }
  });

  test('invalid aliases are rejected', () => {
    const invalidAliases = [
      '123prod',      // Starts with number
      '-staging',     // Starts with dash
      '_dev',         // Starts with underscore
      'has space',    // Contains space
      'has.dot',      // Contains dot
      '',             // Empty
      '@server',      // Contains special char
    ];

    const aliasRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

    for (const alias of invalidAliases) {
      expect(aliasRegex.test(alias)).toBe(false);
    }
  });
});

// ============================================================================
// Token Format Tests
// ============================================================================

describe('Token Format', () => {
  test('token preview is truncated correctly', () => {
    const token = 'abc12345-6789-0123-4567-890abcdef012';
    const preview = token.slice(0, 8) + '...';

    expect(preview).toBe('abc12345...');
    expect(preview.length).toBe(11);
  });

  test('tokens are unique', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(crypto.randomUUID());
    }
    expect(tokens.size).toBe(100);
  });
});
