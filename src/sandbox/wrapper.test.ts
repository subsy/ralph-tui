/**
 * ABOUTME: Tests for SandboxWrapper class.
 * Verifies command wrapping for bwrap and sandbox-exec backends.
 */

import { describe, expect, test, beforeEach, spyOn } from 'bun:test';
import { SandboxWrapper } from './wrapper.js';
import type { SandboxConfig } from './types.js';
import type { AgentSandboxRequirements } from '../plugins/agents/types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { PathLike } from 'node:fs';

// Helper to create minimal requirements
function createRequirements(
  overrides: Partial<AgentSandboxRequirements> = {}
): AgentSandboxRequirements {
  return {
    binaryPaths: [],
    runtimePaths: [],
    authPaths: [],
    requiresNetwork: true,
    ...overrides,
  };
}

describe('SandboxWrapper', () => {
  describe('wrapCommand', () => {
    test('returns command unchanged when enabled is false', () => {
      const config: SandboxConfig = { enabled: false, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapCommand('echo', ['hello']);

      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello']);
    });

    test('returns command unchanged when mode is off', () => {
      const config: SandboxConfig = { enabled: true, mode: 'off' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapCommand('echo', ['hello']);

      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello']);
    });

    test('returns command unchanged for auto mode (not resolved)', () => {
      // Auto mode should be resolved to concrete mode before runtime,
      // but if it reaches wrapCommand, it should pass through defensively
      const config: SandboxConfig = { enabled: true, mode: 'auto' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapCommand('echo', ['hello']);

      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello']);
    });

    test('wraps with bwrap when mode is bwrap', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapCommand('echo', ['hello']);

      expect(result.command).toBe('bwrap');
      expect(result.args).toContain('echo');
      expect(result.args).toContain('hello');
    });

    test('wraps with sandbox-exec when mode is sandbox-exec', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapCommand('echo', ['hello']);

      expect(result.command).toBe('sandbox-exec');
      expect(result.args[0]).toBe('-p');
      // args[1] is the profile
      expect(result.args[2]).toBe('echo');
      expect(result.args[3]).toBe('hello');
    });
  });

  describe('wrapWithBwrap', () => {
    let existsSyncSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      // Mock existsSync to return true for common paths
      existsSyncSpy = spyOn(fs, 'existsSync').mockImplementation((p: PathLike) => {
        const pathStr = String(p);
        // Return true for system dirs and working directory
        return (
          pathStr.startsWith('/usr') ||
          pathStr.startsWith('/bin') ||
          pathStr.startsWith('/lib') ||
          pathStr.startsWith('/etc') ||
          pathStr.startsWith('/sbin') ||
          pathStr === process.cwd() ||
          pathStr.includes('/home')
        );
      });
    });

    test('includes die-with-parent flag', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', []);

      expect(result.args).toContain('--die-with-parent');
    });

    test('includes dev and proc mounts', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', []);

      expect(result.args).toContain('--dev');
      expect(result.args).toContain('/dev');
      expect(result.args).toContain('--proc');
      expect(result.args).toContain('/proc');
    });

    test('adds --unshare-net when network is false', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap', network: false };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', []);

      expect(result.args).toContain('--unshare-net');
    });

    test('does not add --unshare-net when network is true', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap', network: true };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', []);

      expect(result.args).not.toContain('--unshare-net');
    });

    test('mounts system directories as read-only', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', []);

      // Check for --ro-bind flags for system dirs
      expect(result.args).toContain('--ro-bind');
      expect(result.args).toContain('/usr');
    });

    test('mounts working directory as read-write', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());
      const cwd = process.cwd();

      const result = wrapper.wrapWithBwrap('test', [], { cwd });

      // Working dir should use --bind (read-write), not --ro-bind
      const bindIndex = result.args.indexOf('--bind');
      expect(bindIndex).toBeGreaterThan(-1);
    });

    test('uses custom cwd when provided', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', [], { cwd: '/tmp/test' });

      expect(result.args).toContain('--chdir');
      // The chdir should be the resolved path
      const chdirIndex = result.args.indexOf('--chdir');
      expect(result.args[chdirIndex + 1]).toBe('/tmp/test');
    });

    test('ends with -- command and args', () => {
      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('mycommand', ['arg1', 'arg2']);

      const separatorIndex = result.args.indexOf('--');
      expect(separatorIndex).toBeGreaterThan(-1);
      expect(result.args[separatorIndex + 1]).toBe('mycommand');
      expect(result.args[separatorIndex + 2]).toBe('arg1');
      expect(result.args[separatorIndex + 3]).toBe('arg2');
    });

    test('mounts allowPaths as read-write', () => {
      existsSyncSpy.mockImplementation((p: PathLike) => String(p) === '/custom/path' || String(p) === process.cwd());

      const config: SandboxConfig = {
        enabled: true,
        mode: 'bwrap',
        allowPaths: ['/custom/path'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', []);

      // allowPaths should be mounted with --bind
      expect(result.args).toContain('--bind');
      expect(result.args).toContain('/custom/path');
    });

    test('mounts authPaths as read-write for OAuth token refresh', () => {
      existsSyncSpy.mockImplementation((p: PathLike) => String(p) === '/home/user/.claude' || String(p) === process.cwd());

      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const requirements = createRequirements({
        authPaths: ['/home/user/.claude'],
      });
      const wrapper = new SandboxWrapper(config, requirements);

      const result = wrapper.wrapWithBwrap('test', []);

      expect(result.args).toContain('--bind');
      expect(result.args).toContain('/home/user/.claude');
    });

    test('mounts binaryPaths as read-only', () => {
      existsSyncSpy.mockImplementation((p: PathLike) => String(p) === '/opt/bin' || String(p) === process.cwd());

      const config: SandboxConfig = { enabled: true, mode: 'bwrap' };
      const requirements = createRequirements({
        binaryPaths: ['/opt/bin'],
      });
      const wrapper = new SandboxWrapper(config, requirements);

      const result = wrapper.wrapWithBwrap('test', []);

      expect(result.args).toContain('--ro-bind');
      expect(result.args).toContain('/opt/bin');
    });

    test('removes path from readOnlyPaths if it is in readWritePaths', () => {
      // If a path is in both allowPaths (read-write) and readOnlyPaths,
      // it should only be mounted once as read-write
      existsSyncSpy.mockImplementation((p: PathLike) => String(p) === '/shared/path' || String(p) === process.cwd());

      const config: SandboxConfig = {
        enabled: true,
        mode: 'bwrap',
        allowPaths: ['/shared/path'],
        readOnlyPaths: ['/shared/path'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithBwrap('test', []);

      // Count --bind flags followed by /shared/path (bwrap uses --bind <src> <dst>)
      // The path appears twice per binding (source and destination), so we check
      // that it's mounted with --bind (read-write), not --ro-bind (read-only)
      const firstIndex = result.args.indexOf('/shared/path');
      expect(firstIndex).toBeGreaterThan(-1);

      // Should be mounted as read-write (--bind), not read-only (--ro-bind)
      // The flag appears before the path: --bind /path /path
      expect(result.args[firstIndex - 1]).toBe('--bind');

      // Verify it's NOT also mounted with --ro-bind
      let roBindCount = 0;
      for (let i = 0; i < result.args.length; i++) {
        if (result.args[i] === '--ro-bind' && result.args[i + 1] === '/shared/path') {
          roBindCount++;
        }
      }
      expect(roBindCount).toBe(0);
    });
  });

  describe('wrapWithSandboxExec', () => {
    beforeEach(() => {
      spyOn(fs, 'existsSync').mockImplementation((p: PathLike) => {
        const pathStr = String(p);
        return (
          pathStr.startsWith('/usr') ||
          pathStr.startsWith('/bin') ||
          pathStr.startsWith('/System') ||
          pathStr.startsWith('/Library') ||
          pathStr.startsWith('/Applications') ||
          pathStr === process.cwd()
        );
      });
    });

    test('returns sandbox-exec as command', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);

      expect(result.command).toBe('sandbox-exec');
    });

    test('passes profile inline with -p flag', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);

      expect(result.args[0]).toBe('-p');
      expect(typeof result.args[1]).toBe('string');
      expect(result.args[1]).toContain('(version 1)');
    });

    test('generates valid Seatbelt profile', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('(version 1)');
      expect(profile).toContain('(deny default)');
      expect(profile).toContain('(allow process-exec)');
      expect(profile).toContain('(allow process-fork)');
    });

    test('includes network access when network is not false', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec', network: true };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('(allow network*)');
    });

    test('excludes network access when network is false', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec', network: false };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).not.toContain('(allow network*)');
    });

    test('includes working directory as read-write', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec' };
      const wrapper = new SandboxWrapper(config, createRequirements());
      const cwd = process.cwd();

      const result = wrapper.wrapWithSandboxExec('test', [], { cwd });
      const profile = result.args[1];

      expect(profile).toContain('file-read* file-write*');
      expect(profile).toContain('; Working directory');
    });

    test('includes auth paths as read-write', () => {
      spyOn(fs, 'existsSync').mockImplementation((p: PathLike) => String(p) === '/Users/test/.claude' || String(p) === process.cwd());

      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec' };
      const requirements = createRequirements({
        authPaths: ['/Users/test/.claude'],
      });
      const wrapper = new SandboxWrapper(config, requirements);

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('; Auth paths (read-write for token refresh)');
      expect(profile).toContain('/Users/test/.claude');
    });

    test('appends command and args after profile', () => {
      const config: SandboxConfig = { enabled: true, mode: 'sandbox-exec' };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('mycommand', ['arg1', 'arg2']);

      expect(result.args[0]).toBe('-p');
      // args[1] is the profile
      expect(result.args[2]).toBe('mycommand');
      expect(result.args[3]).toBe('arg1');
      expect(result.args[4]).toBe('arg2');
    });
  });

  describe('normalizePaths (via wrapCommand)', () => {
    beforeEach(() => {
      spyOn(os, 'homedir').mockReturnValue('/home/testuser');
      spyOn(fs, 'existsSync').mockImplementation(() => true);
    });

    test('expands bare ~ to home directory', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['~'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('/home/testuser');
    });

    test('expands ~/ prefix to home directory', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['~/.config'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('/home/testuser/.config');
    });

    test('resolves relative paths to absolute', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['./relative/path'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', [], { cwd: '/project' });
      const profile = result.args[1];

      expect(profile).toContain('/project/relative/path');
    });

    test('preserves absolute paths unchanged', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['/absolute/path'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('/absolute/path');
    });

    test('filters out empty paths', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['', '  ', '/valid/path'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      // Should only contain the valid path, not empty strings
      expect(profile).toContain('/valid/path');
    });

    test('deduplicates paths', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['/same/path', '/same/path'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      // Count occurrences of /same/path - should only appear once
      const matches = profile.match(/\/same\/path/g);
      expect(matches?.length).toBe(1);
    });
  });

  describe('escapeSeatbeltPath (via profile generation)', () => {
    beforeEach(() => {
      spyOn(fs, 'existsSync').mockImplementation(() => true);
    });

    test('escapes double quotes in paths', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['/path/with"quote'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('\\"');
      expect(profile).not.toMatch(/subpath "\/path\/with"quote"/);
    });

    test('escapes backslashes in paths', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['/path/with\\backslash'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('\\\\');
    });

    test('escapes newlines in paths', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['/path/with\nnewline'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      // The actual newline should be escaped
      expect(profile).not.toContain('/path/with\nnewline');
      expect(profile).toContain('\\n');
    });

    test('escapes carriage returns in paths', () => {
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: ['/path/with\rcarriage'],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      expect(profile).toContain('\\r');
    });

    test('prevents injection attack with malicious path', () => {
      // This malicious path tries to break out of the subpath string
      // and add new allow rules
      const maliciousPath = '/tmp/foo"))(allow file-read* file-write* (subpath "/etc';
      const config: SandboxConfig = {
        enabled: true,
        mode: 'sandbox-exec',
        allowPaths: [maliciousPath],
      };
      const wrapper = new SandboxWrapper(config, createRequirements());

      const result = wrapper.wrapWithSandboxExec('test', []);
      const profile = result.args[1];

      // The profile should NOT contain unescaped injection
      expect(profile).not.toContain('(subpath "/etc")');
      // The quotes should be escaped
      expect(profile).toContain('\\"');
    });
  });
});
