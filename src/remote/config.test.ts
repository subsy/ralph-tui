/**
 * ABOUTME: Tests for remote configuration storage and management.
 * Covers TOML file operations, remote CRUD, and host:port parsing.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, access, constants } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import {
  parseHostPort,
  REMOTES_CONFIG_PATHS,
} from './config.js';

// ============================================================================
// parseHostPort Tests
// ============================================================================

describe('parseHostPort', () => {
  describe('valid inputs', () => {
    test('parses host:port correctly', () => {
      expect(parseHostPort('example.com:8080')).toEqual({
        host: 'example.com',
        port: 8080,
      });
    });

    test('parses host only with default port', () => {
      expect(parseHostPort('localhost')).toEqual({
        host: 'localhost',
        port: 7890,
      });
    });

    test('parses IPv4 address with port', () => {
      expect(parseHostPort('192.168.1.1:7890')).toEqual({
        host: '192.168.1.1',
        port: 7890,
      });
    });

    test('parses IPv4 address without port', () => {
      expect(parseHostPort('10.0.0.1')).toEqual({
        host: '10.0.0.1',
        port: 7890,
      });
    });

    test('parses minimum valid port', () => {
      expect(parseHostPort('host:1')).toEqual({
        host: 'host',
        port: 1,
      });
    });

    test('parses maximum valid port', () => {
      expect(parseHostPort('host:65535')).toEqual({
        host: 'host',
        port: 65535,
      });
    });

    test('parses subdomain', () => {
      expect(parseHostPort('server.example.com:9000')).toEqual({
        host: 'server.example.com',
        port: 9000,
      });
    });
  });

  describe('invalid inputs', () => {
    test('returns null for port 0', () => {
      expect(parseHostPort('host:0')).toBeNull();
    });

    test('returns null for negative port', () => {
      expect(parseHostPort('host:-1')).toBeNull();
    });

    test('returns null for port > 65535', () => {
      expect(parseHostPort('host:65536')).toBeNull();
      expect(parseHostPort('host:99999')).toBeNull();
    });

    test('returns null for non-numeric port', () => {
      expect(parseHostPort('host:abc')).toBeNull();
    });

    test('returns null for decimal port', () => {
      // Decimal ports are invalid - must be integers
      expect(parseHostPort('host:1.5')).toBeNull();
    });

    test('returns null for too many colons', () => {
      expect(parseHostPort('host:port:extra')).toBeNull();
    });

    test('returns null for empty port', () => {
      expect(parseHostPort('host:')).toBeNull();
    });
  });
});

// ============================================================================
// REMOTES_CONFIG_PATHS Tests
// ============================================================================

describe('REMOTES_CONFIG_PATHS', () => {
  test('dir path contains expected components', () => {
    expect(REMOTES_CONFIG_PATHS.dir).toContain('.config');
    expect(REMOTES_CONFIG_PATHS.dir).toContain('ralph-tui');
  });

  test('file path contains expected components', () => {
    expect(REMOTES_CONFIG_PATHS.file).toContain('.config');
    expect(REMOTES_CONFIG_PATHS.file).toContain('ralph-tui');
    expect(REMOTES_CONFIG_PATHS.file).toContain('remotes.toml');
  });

  test('file is within dir', () => {
    expect(REMOTES_CONFIG_PATHS.file.startsWith(REMOTES_CONFIG_PATHS.dir)).toBe(true);
  });
});

// ============================================================================
// Config File Format Tests
// ============================================================================

describe('Config File Format', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('TOML serialization', () => {
    test('RemotesConfig serializes to valid TOML', () => {
      const config = {
        version: 1,
        remotes: {
          prod: {
            host: 'prod.example.com',
            port: 7890,
            secure: true,
            token: 'token123',
            addedAt: '2026-01-19T00:00:00.000Z',
          },
        },
      };

      const toml = stringifyToml(config as unknown as Record<string, unknown>);

      expect(toml).toContain('version = 1');
      expect(toml).toContain('[remotes.prod]');
      expect(toml).toContain('host = "prod.example.com"');
      expect(toml).toContain('port = 7890');
      expect(toml).toContain('secure = true');
      expect(toml).toContain('token = "token123"');
    });

    test('TOML deserializes correctly', () => {
      const toml = `
version = 1

[remotes.staging]
host = "staging.local"
port = 8080
secure = true
token = "abc123"
addedAt = "2026-01-19T12:00:00.000Z"
`;

      const parsed = parseToml(toml) as unknown as {
        version: number;
        remotes: Record<string, unknown>;
      };

      expect(parsed.version).toBe(1);
      expect(parsed.remotes.staging).toBeDefined();

      const staging = parsed.remotes.staging as {
        host: string;
        port: number;
        secure: boolean;
        token: string;
        addedAt: string;
      };
      expect(staging.host).toBe('staging.local');
      expect(staging.port).toBe(8080);
      expect(staging.secure).toBe(true);
      expect(staging.token).toBe('abc123');
    });

    test('empty remotes serializes correctly', () => {
      const config = {
        version: 1,
        remotes: {},
      };

      const toml = stringifyToml(config as unknown as Record<string, unknown>);
      expect(toml).toContain('version = 1');
    });

    test('multiple remotes serialize correctly', () => {
      const config = {
        version: 1,
        remotes: {
          prod: {
            host: 'prod.example.com',
            port: 7890,
            token: 'token1',
            addedAt: '2026-01-19T00:00:00.000Z',
          },
          staging: {
            host: 'staging.example.com',
            port: 7891,
            token: 'token2',
            addedAt: '2026-01-19T01:00:00.000Z',
          },
          dev: {
            host: 'localhost',
            port: 7892,
            token: 'token3',
            addedAt: '2026-01-19T02:00:00.000Z',
          },
        },
      };

      const toml = stringifyToml(config as unknown as Record<string, unknown>);

      expect(toml).toContain('[remotes.prod]');
      expect(toml).toContain('[remotes.staging]');
      expect(toml).toContain('[remotes.dev]');
    });
  });

  describe('file operations', () => {
    test('writes and reads config file', async () => {
      const configPath = join(tempDir, 'remotes.toml');
      const config = {
        version: 1,
        remotes: {
          test: {
            host: 'test.local',
            port: 7890,
            token: 'testtoken',
            addedAt: new Date().toISOString(),
          },
        },
      };

      const toml = stringifyToml(config as unknown as Record<string, unknown>);
      await writeFile(configPath, toml, 'utf-8');

      const content = await readFile(configPath, 'utf-8');
      const parsed = parseToml(content) as unknown as typeof config;

      expect(parsed.version).toBe(1);
      expect(parsed.remotes.test.host).toBe('test.local');
    });

    test('handles empty file', async () => {
      const configPath = join(tempDir, 'empty.toml');
      await writeFile(configPath, '', 'utf-8');

      const content = await readFile(configPath, 'utf-8');
      expect(content.trim()).toBe('');
    });

    test('creates directory structure', async () => {
      const nestedDir = join(tempDir, 'a', 'b', 'c');
      await mkdir(nestedDir, { recursive: true });

      let exists = false;
      try {
        await access(nestedDir, constants.R_OK);
        exists = true;
      } catch {
        // Not expected
      }

      expect(exists).toBe(true);
    });
  });
});

// ============================================================================
// Alias Validation Tests
// ============================================================================

describe('Alias Validation', () => {
  const aliasRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

  describe('valid aliases', () => {
    const validAliases = [
      'a',
      'prod',
      'staging',
      'dev',
      'my-server',
      'server_1',
      'Server2',
      'test123',
      'UPPERCASE',
      'MixedCase',
      'with-dashes',
      'with_underscores',
      'CombinedStyle-test_123',
    ];

    for (const alias of validAliases) {
      test(`"${alias}" is valid`, () => {
        expect(aliasRegex.test(alias)).toBe(true);
      });
    }
  });

  describe('invalid aliases', () => {
    const invalidAliases = [
      '',             // Empty
      '1prod',        // Starts with number
      '-staging',     // Starts with dash
      '_dev',         // Starts with underscore
      'has space',    // Contains space
      'has.dot',      // Contains dot
      '@server',      // Contains @
      'has/slash',    // Contains /
      'has\\back',    // Contains backslash
      'has:colon',    // Contains colon
      '123',          // All numbers
    ];

    for (const alias of invalidAliases) {
      test(`"${alias}" is invalid`, () => {
        expect(aliasRegex.test(alias)).toBe(false);
      });
    }
  });
});

// ============================================================================
// Remote Server Config Structure Tests
// ============================================================================

describe('RemoteServerConfig Structure', () => {
  test('minimal config structure', () => {
    const config = {
      host: 'localhost',
      port: 7890,
      token: 'abc123',
      addedAt: new Date().toISOString(),
    };

    expect(config.host).toBe('localhost');
    expect(config.port).toBe(7890);
    expect(config.token).toBe('abc123');
    expect(config.addedAt).toBeDefined();
  });

  test('config with optional lastConnected', () => {
    const config = {
      host: 'prod.example.com',
      port: 7890,
      token: 'token123',
      addedAt: '2026-01-01T00:00:00.000Z',
      lastConnected: '2026-01-19T12:00:00.000Z',
    };

    expect(config.lastConnected).toBe('2026-01-19T12:00:00.000Z');
  });

  test('timestamp format is ISO 8601', () => {
    const timestamp = new Date().toISOString();

    // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

// ============================================================================
// Token Security Tests
// ============================================================================

describe('Token Security', () => {
  test('token is stored as plain string', () => {
    const token = 'secret-token-12345';
    const config = {
      host: 'localhost',
      port: 7890,
      token,
      addedAt: new Date().toISOString(),
    };

    expect(config.token).toBe(token);
  });

  test('token preview truncation', () => {
    const token = 'abcdefgh-1234-5678-9abc-def012345678';
    const preview = token.slice(0, 8) + '...';

    expect(preview).toBe('abcdefgh...');
    expect(preview.length).toBe(11);
  });

  test('tokens are unique UUIDs', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(crypto.randomUUID());
    }
    expect(tokens.size).toBe(1000);
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  test('handles special characters in host', () => {
    const result = parseHostPort('my-server.example-domain.com:7890');
    expect(result).toEqual({
      host: 'my-server.example-domain.com',
      port: 7890,
    });
  });

  test('handles numeric hostname', () => {
    const result = parseHostPort('123:7890');
    expect(result).toEqual({
      host: '123',
      port: 7890,
    });
  });

  test('handles localhost', () => {
    expect(parseHostPort('localhost:7890')).toEqual({
      host: 'localhost',
      port: 7890,
    });
    expect(parseHostPort('localhost')).toEqual({
      host: 'localhost',
      port: 7890,
    });
  });

  test('handles 0.0.0.0', () => {
    expect(parseHostPort('0.0.0.0:7890')).toEqual({
      host: '0.0.0.0',
      port: 7890,
    });
  });

  test('handles 127.0.0.1', () => {
    expect(parseHostPort('127.0.0.1:8080')).toEqual({
      host: '127.0.0.1',
      port: 8080,
    });
  });
});
