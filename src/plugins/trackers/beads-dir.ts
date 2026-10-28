/**
 * ABOUTME: Shared Beads store directory resolution for native tracker plugins.
 * Resolves configured and environment-provided store paths consistently.
 */

import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_BEADS_DIR = '.beads';

/**
 * Resolve a Beads store path, honoring configured absolute paths, BEADS_DIR,
 * then the working directory and configured relative path. BEADS_DIR is
 * honored because bd itself uses it to locate stores outside the cwd.
 */
export function resolveBeadsDir(
  workingDir: string,
  configuredBeadsDir: string
): { path: string; source: string; explicit: boolean } {
  if (isAbsolute(configuredBeadsDir)) {
    return { path: configuredBeadsDir, source: 'configured beadsDir', explicit: true };
  }

  const environmentBeadsDir = process.env.BEADS_DIR?.trim();
  if (environmentBeadsDir) {
    return {
      path: isAbsolute(environmentBeadsDir)
        ? environmentBeadsDir
        : resolve(workingDir, environmentBeadsDir),
      source: 'BEADS_DIR',
      explicit: false,
    };
  }

  return {
    path: resolve(workingDir, configuredBeadsDir),
    source: 'workingDir and beadsDir',
    explicit: configuredBeadsDir !== DEFAULT_BEADS_DIR,
  };
}
