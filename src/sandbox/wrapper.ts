/**
 * ABOUTME: Wraps commands in sandbox isolation (bwrap on Linux, sandbox-exec on macOS).
 * Builds sandbox arguments based on config and agent requirements.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { SandboxConfig } from './types.js';
import type { AgentSandboxRequirements } from '../plugins/agents/types.js';

export interface WrappedCommand {
  command: string;
  args: string[];
}

export interface SandboxWrapOptions {
  cwd?: string;
}

const LINUX_SYSTEM_DIRS = ['/usr', '/bin', '/lib', '/lib64', '/sbin', '/etc'];

/**
 * Escape a path for safe inclusion in Seatbelt profile strings.
 * Prevents injection attacks by escaping quotes, backslashes, and newlines.
 */
function escapeSeatbeltPath(path: string): string {
  return path
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r'); // Escape carriage returns
}

const MACOS_SYSTEM_DIRS = [
  '/usr',
  '/bin',
  '/sbin',
  '/System',
  '/Library',
  '/Applications',
  '/private/var/db',
  '/private/etc',
];

export class SandboxWrapper {
  private readonly config: SandboxConfig;
  private readonly requirements: AgentSandboxRequirements;

  constructor(config: SandboxConfig, requirements: AgentSandboxRequirements) {
    this.config = config;
    this.requirements = requirements;
  }

  wrapCommand(
    command: string,
    args: string[],
    options: SandboxWrapOptions = {}
  ): WrappedCommand {
    if (this.config.enabled === false || this.config.mode === 'off') {
      return { command, args };
    }

    const mode = this.config.mode ?? 'auto';

    if (mode === 'bwrap') {
      return this.wrapWithBwrap(command, args, options);
    }

    if (mode === 'sandbox-exec') {
      return this.wrapWithSandboxExec(command, args, options);
    }

    // 'auto' mode - this shouldn't happen at runtime since detectSandboxMode
    // resolves 'auto' to a concrete mode, but handle it defensively
    return { command, args };
  }

  wrapWithBwrap(
    command: string,
    args: string[],
    options: SandboxWrapOptions = {}
  ): WrappedCommand {
    const cwd = options.cwd ?? process.cwd();
    const workDir = resolve(cwd);
    const bwrapArgs: string[] = ['--die-with-parent', '--dev', '/dev', '--proc', '/proc'];

    if (this.config.network === false) {
      bwrapArgs.push('--unshare-net');
    }

    for (const dir of LINUX_SYSTEM_DIRS) {
      if (existsSync(dir)) {
        bwrapArgs.push('--ro-bind', dir, dir);
      }
    }

    // Auth paths need read-write for OAuth token refresh
    const authPaths = this.normalizePaths(this.requirements.authPaths, workDir);
    const readWritePaths = new Set<string>([
      workDir,
      ...this.normalizePaths(this.config.allowPaths ?? [], workDir),
      ...authPaths,
    ]);
    const readOnlyPaths = new Set<string>([
      ...this.normalizePaths(this.config.readOnlyPaths ?? [], workDir),
      ...this.normalizePaths(this.requirements.binaryPaths, workDir),
      ...this.normalizePaths(this.requirements.runtimePaths, workDir),
    ]);

    for (const path of readWritePaths) {
      readOnlyPaths.delete(path);
    }

    for (const path of readWritePaths) {
      if (existsSync(path)) {
        bwrapArgs.push('--bind', path, path);
      }
    }

    for (const path of readOnlyPaths) {
      if (existsSync(path)) {
        bwrapArgs.push('--ro-bind', path, path);
      }
    }

    bwrapArgs.push('--chdir', workDir, '--', command, ...args);

    return { command: 'bwrap', args: bwrapArgs };
  }

  wrapWithSandboxExec(
    command: string,
    args: string[],
    options: SandboxWrapOptions = {}
  ): WrappedCommand {
    const cwd = options.cwd ?? process.cwd();
    const workDir = resolve(cwd);
    const profile = this.generateSeatbeltProfile(workDir);

    // Use -p to pass profile inline, avoiding temp file management
    return {
      command: 'sandbox-exec',
      args: ['-p', profile, command, ...args],
    };
  }

  private generateSeatbeltProfile(workDir: string): string {
    const lines: string[] = [
      '(version 1)',
      '(deny default)',
      '',
      '; Allow process execution and signals',
      '(allow process-exec)',
      '(allow process-fork)',
      '(allow signal)',
      '',
      '; Allow basic system operations',
      '(allow sysctl-read)',
      '(allow mach-lookup)',
      '(allow ipc-posix-shm)',
      '',
    ];

    // Network access
    if (this.config.network !== false) {
      lines.push('; Allow network access');
      lines.push('(allow network*)');
      lines.push('');
    }

    // System directories (read-only)
    lines.push('; System directories (read-only)');
    for (const dir of MACOS_SYSTEM_DIRS) {
      if (existsSync(dir)) {
        lines.push(`(allow file-read* (subpath "${escapeSeatbeltPath(dir)}"))`);
      }
    }
    lines.push('');

    // Dev and tmp directories
    lines.push('; Device and temporary directories');
    lines.push('(allow file-read* file-write* (subpath "/dev"))');
    lines.push('(allow file-read* file-write* (subpath "/private/tmp"))');
    lines.push('(allow file-read* file-write* (subpath "/tmp"))');
    lines.push('(allow file-read* file-write* (subpath "/var/folders"))');
    lines.push('');

    // Working directory (read-write)
    lines.push('; Working directory (read-write)');
    lines.push(`(allow file-read* file-write* (subpath "${escapeSeatbeltPath(workDir)}"))`);

    // Additional allowed paths (read-write)
    const allowPaths = this.normalizePaths(this.config.allowPaths ?? [], workDir);
    for (const path of allowPaths) {
      if (path !== workDir && existsSync(path)) {
        lines.push(`(allow file-read* file-write* (subpath "${escapeSeatbeltPath(path)}"))`);
      }
    }

    // Auth paths need read-write for OAuth token refresh
    lines.push('');
    lines.push('; Auth paths (read-write for token refresh)');
    const authPaths = this.normalizePaths(this.requirements.authPaths, workDir);
    for (const path of authPaths) {
      if (existsSync(path)) {
        lines.push(`(allow file-read* file-write* (subpath "${escapeSeatbeltPath(path)}"))`);
      }
    }
    lines.push('');

    // Read-only paths (binaries, runtime, config)
    lines.push('; Read-only paths (binaries, runtime, config)');
    const readOnlyPaths = new Set<string>([
      ...this.normalizePaths(this.config.readOnlyPaths ?? [], workDir),
      ...this.normalizePaths(this.requirements.binaryPaths, workDir),
      ...this.normalizePaths(this.requirements.runtimePaths, workDir),
    ]);
    for (const path of readOnlyPaths) {
      if (existsSync(path)) {
        lines.push(`(allow file-read* (subpath "${escapeSeatbeltPath(path)}"))`);
      }
    }

    return lines.join('\n');
  }

  private normalizePaths(paths: string[], cwd: string): string[] {
    const home = homedir();
    const resolved = paths
      .filter((path) => path.trim().length > 0)
      .map((path) => {
        // Expand ~ to home directory (both bare "~" and "~/...")
        let expanded: string;
        if (path === '~') {
          expanded = home;
        } else if (path.startsWith('~/')) {
          expanded = home + path.slice(1);
        } else {
          expanded = path;
        }
        return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
      });
    return Array.from(new Set(resolved));
  }
}
