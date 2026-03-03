/**
 * ABOUTME: Session-level git worktree creation for isolated execution.
 * When --worktree is active, creates a single git worktree before the
 * execution engine starts so all task execution happens in an isolated
 * copy of the repo.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sanitizeBranchName } from './parallel/worktree-manager.js';

/** Result of session worktree creation */
export interface SessionWorktreeResult {
  /** Absolute path to the created worktree */
  worktreePath: string;
  /** Branch name used for the worktree */
  branchName: string;
}

/** Session worktree creation/reuse mode */
export type SessionWorktreeMode = 'created' | 'reused' | 'attached';

/** Result of preparing a session worktree (create or reuse) */
export interface PreparedSessionWorktreeResult extends SessionWorktreeResult {
  /** Whether the worktree was created new, reused, or attached to an existing branch */
  mode: SessionWorktreeMode;
}

/** Default minimum free disk space (500 MB) before creating a worktree */
const DEFAULT_MIN_FREE_DISK_SPACE = 500 * 1024 * 1024;

/**
 * Derive the session worktree name from available context.
 *
 * Priority:
 * 1. Explicit custom name (user passed --worktree <name>)
 * 2. Epic ID (e.g. "my-epic-123")
 * 3. PRD filename without extension (e.g. "auth-feature")
 * 4. Session short ID (first 8 chars of UUID)
 */
export function deriveSessionName(options: {
  customName?: string;
  epicId?: string;
  prdPath?: string;
  sessionId: string;
}): string {
  if (options.customName) {
    return sanitizeBranchName(options.customName);
  }
  if (options.epicId) {
    return sanitizeBranchName(options.epicId);
  }
  if (options.prdPath) {
    const basename = path.basename(options.prdPath, path.extname(options.prdPath));
    return sanitizeBranchName(basename);
  }
  // Fallback: first 8 chars of session UUID
  return options.sessionId.slice(0, 8);
}


/**
 * Compute the worktree base directory as a sibling of the project.
 *
 * Worktrees must live outside the project directory to prevent
 * Claude CLI's project detection from walking up and finding the parent's
 * .git directory.
 *
 * Uses: {parent}/.ralph-worktrees/{basename}/
 */
function getWorktreeBaseDir(cwd: string): string {
  const parentDir = path.dirname(cwd);
  const projectName = path.basename(cwd);
  return path.join(parentDir, '.ralph-worktrees', projectName);
}

/**
 * Check whether `candidate` is inside `baseDir`.
 */
function isPathInside(baseDir: string, candidate: string): boolean {
  const rel = path.relative(baseDir, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Parse `git worktree list --porcelain` output.
 */
function parseWorktreeList(output: string): Array<{ path: string; branch?: string }> {
  const entries: Array<{ path: string; branch?: string }> = [];
  let current: { path: string; branch?: string } | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) {
        entries.push(current);
      }
      current = { path: path.resolve(line.slice('worktree '.length).trim()) };
      continue;
    }

    if (line.startsWith('branch ') && current) {
      const ref = line.slice('branch '.length).trim();
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

/**
 * Determine whether a local branch exists.
 */
function branchExists(cwd: string, branchName: string): boolean {
  try {
    git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a PRD path to a guaranteed in-worktree target path.
 *
 * - PRDs inside the main cwd preserve relative layout in worktree.
 * - PRDs outside cwd are rebased into `.ralph-tui/external-prd/`.
 */
export function resolveWorktreePrdPath(
  cwd: string,
  worktreePath: string,
  prdPath: string,
): { sourcePrd: string; targetPrd: string; isExternal: boolean } {
  const sourcePrd = path.resolve(cwd, prdPath);

  // If already inside this worktree, keep as-is (resume path).
  if (isPathInside(worktreePath, sourcePrd)) {
    return { sourcePrd, targetPrd: sourcePrd, isExternal: false };
  }

  if (isPathInside(cwd, sourcePrd)) {
    const relativePath = path.relative(cwd, sourcePrd);
    const safeRelative = relativePath.length > 0 ? relativePath : path.basename(sourcePrd);
    return {
      sourcePrd,
      targetPrd: path.join(worktreePath, safeRelative),
      isExternal: false,
    };
  }

  const ext = path.extname(sourcePrd) || '.json';
  const rawBase = path.basename(sourcePrd, path.extname(sourcePrd));
  const safeBase = rawBase.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 64) || 'prd';
  const sourceHash = createHash('sha1').update(sourcePrd).digest('hex').slice(0, 8);
  const targetPrd = path.join(
    worktreePath,
    '.ralph-tui',
    'external-prd',
    `${safeBase}-${sourceHash}${ext}`,
  );

  return { sourcePrd, targetPrd, isExternal: true };
}

/**
 * Copy ralph-tui configuration into a worktree.
 */
function copyConfig(cwd: string, worktreePath: string): void {
  const configDir = path.join(cwd, '.ralph-tui');
  const targetDir = path.join(worktreePath, '.ralph-tui');

  // Copy config.toml if it exists
  const configFile = path.join(configDir, 'config.toml');
  if (fs.existsSync(configFile)) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(configFile, path.join(targetDir, 'config.toml'));
  }

  // Also copy config.yaml / config.yml if they exist
  for (const ext of ['yaml', 'yml']) {
    const yamlConfig = path.join(configDir, `config.${ext}`);
    if (fs.existsSync(yamlConfig)) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(yamlConfig, path.join(targetDir, `config.${ext}`));
    }
  }
}

/** Files/patterns to exclude when copying .beads/ directory */
const BEADS_EXCLUDE_PATTERNS = [
  /\.db$/,
  /\.db-shm$/,
  /\.db-wal$/,
  /\.lock$/,
  /\.tmp$/,
  /^last-touched$/,
];

/**
 * Check if a filename matches any of the beads exclusion patterns.
 */
function isBeadsExcluded(filename: string): boolean {
  return BEADS_EXCLUDE_PATTERNS.some((pattern) => pattern.test(filename));
}

/**
 * Copy the .beads/ directory from source to target, excluding git-ignored files
 * (database files, lock files, temporary files).
 */
function copyBeadsDir(cwd: string, worktreePath: string): void {
  const sourceDir = path.join(cwd, '.beads');
  const targetDir = path.join(worktreePath, '.beads');

  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir);
  for (const entry of entries) {
    if (isBeadsExcluded(entry)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    const stat = fs.statSync(sourcePath);

    if (stat.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    } else if (stat.isDirectory()) {
      // Recursively copy subdirectories, applying the same exclusion patterns
      fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        filter: (src) => !isBeadsExcluded(path.basename(src)),
      });
    }
  }
}

/**
 * Run `br sync --flush-only` or `bd sync --flush-only` in the main repo to
 * ensure the JSONL export is up to date with the SQLite database.
 * Returns true on success, false on failure (caller should log warning).
 */
function syncBeadsTracker(cwd: string, command: string): boolean {
  try {
    execFileSync(command, ['sync', '--flush-only'], {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy tracker data files from the main repo into the worktree.
 *
 * Handles three tracker types:
 * - beads-rust: runs `br sync --flush-only`, then copies .beads/ (excluding db/lock/tmp files)
 * - beads / beads-bv: runs `bd sync --flush-only`, then copies .beads/ (excluding db/lock/tmp files)
 * - json: copies the prd.json file (or configured PRD path) if it exists
 *
 * @param cwd - The main project working directory
 * @param worktreePath - The worktree path to copy into
 * @param trackerPlugin - The tracker plugin ID (e.g., 'beads-rust', 'beads', 'json')
 * @param prdPath - Optional PRD file path for json tracker
 */
export function copyTrackerData(
  cwd: string,
  worktreePath: string,
  trackerPlugin: string,
  prdPath?: string,
): { jsonPrdPath?: string; jsonPrdIsExternal?: boolean } {
  if (trackerPlugin === 'beads-rust') {
    // Sync DB to JSONL before copying
    if (!syncBeadsTracker(cwd, 'br')) {
      console.warn('Warning: br sync --flush-only failed; worktree will use existing .beads/ from HEAD');
    }
    copyBeadsDir(cwd, worktreePath);
    return {};
  } else if (trackerPlugin === 'beads' || trackerPlugin === 'beads-bv') {
    // Sync DB to JSONL before copying
    if (!syncBeadsTracker(cwd, 'bd')) {
      console.warn('Warning: bd sync --flush-only failed; worktree will use existing .beads/ from HEAD');
    }
    copyBeadsDir(cwd, worktreePath);
    return {};
  } else if (trackerPlugin === 'json') {
    // Copy the PRD JSON file to a guaranteed in-worktree path.
    const prdFile = prdPath || 'prd.json';
    const { sourcePrd, targetPrd, isExternal } = resolveWorktreePrdPath(
      cwd,
      worktreePath,
      prdFile,
    );

    if (fs.existsSync(sourcePrd)) {
      if (sourcePrd !== targetPrd) {
        const targetPrdDir = path.dirname(targetPrd);
        fs.mkdirSync(targetPrdDir, { recursive: true });
        fs.copyFileSync(sourcePrd, targetPrd);
      }
    }

    return {
      jsonPrdPath: targetPrd,
      jsonPrdIsExternal: isExternal,
    };
  }

  return {};
}

/**
 * Check if there is enough disk space to create a worktree.
 * Uses fs.statfs first, falls back to `df` for APFS and similar.
 */
async function checkDiskSpace(cwd: string): Promise<void> {
  const minimumRequired = DEFAULT_MIN_FREE_DISK_SPACE;

  try {
    let available: number | null = null;

    // Try statfs first
    try {
      const stats = await fs.promises.statfs(cwd);
      const value = Number(stats.bavail) * Number(stats.bsize);
      if (Number.isFinite(value) && value > 0) {
        available = value;
      }
    } catch {
      // Fall through to df
    }

    // Fall back to df
    if (available === null) {
      try {
        const output = execFileSync('df', ['-k', cwd], { encoding: 'utf-8' });
        const lines = output.trim().split('\n').filter((l) => l.trim().length > 0);
        if (lines.length >= 2) {
          const header = lines[0]?.toLowerCase() ?? '';
          const cols = header.trim().split(/\s+/).map((v) => v.replace('%', '').trim());
          const availIdx = cols.findIndex((c) => c === 'avail' || c === 'available');
          if (availIdx >= 0) {
            const dataLine = lines.at(-1) ?? '';
            const values = dataLine.trim().split(/\s+/);
            const kb = Number.parseInt(values[availIdx] ?? '', 10);
            if (Number.isFinite(kb) && kb >= 0) {
              available = kb * 1024;
            }
          }
        }
      } catch {
        // Best effort
      }
    }

    if (available === null) {
      return; // Can't determine disk space, proceed optimistically
    }

    if (available < minimumRequired) {
      const availMB = Math.round(available / (1024 * 1024));
      const reqMB = Math.round(minimumRequired / (1024 * 1024));
      throw new Error(
        `Insufficient disk space for worktree: ${availMB}MB available, ${reqMB}MB required`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Insufficient disk space')) {
      throw err;
    }
    // Other errors: best-effort, don't block
  }
}

/**
 * Execute a git command in the given directory.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Create a session worktree for isolated execution.
 *
 * Creates a git worktree with branch `ralph-session/{name}` as a sibling
 * directory, copies config, and returns the worktree path for use as the
 * execution engine's cwd.
 *
 * @param cwd - The project's working directory
 * @param sessionName - Derived session name (from deriveSessionName)
 * @returns The worktree path and branch name
 * @throws If worktree creation fails or disk space is insufficient
 */
export async function createSessionWorktree(
  cwd: string,
  sessionName: string,
): Promise<SessionWorktreeResult> {
  // Check disk space before creating
  await checkDiskSpace(cwd);

  const branchName = `ralph-session/${sessionName}`;
  const baseDir = getWorktreeBaseDir(cwd);
  const worktreePath = path.join(baseDir, sessionName);

  // Ensure parent directory exists
  fs.mkdirSync(baseDir, { recursive: true });

  // Clean up stale worktree at this path if it exists
  if (fs.existsSync(worktreePath)) {
    try {
      git(cwd, ['worktree', 'remove', '--force', worktreePath]);
    } catch {
      fs.rmSync(worktreePath, { recursive: true, force: true });
      git(cwd, ['worktree', 'prune']);
    }
  }

  // Clean up stale branch if it exists, but only if no active worktree uses it
  if (branchExists(cwd, branchName)) {
    const worktreeOutput = git(cwd, ['worktree', 'list', '--porcelain']);
    const worktrees = parseWorktreeList(worktreeOutput);
    const inUse = worktrees.some((wt) => wt.branch === branchName);
    if (inUse) {
      throw new Error(
        `Branch "${branchName}" is currently in use by another worktree. ` +
        `Use a different --worktree name or remove the existing worktree first.`
      );
    }
    git(cwd, ['branch', '-D', branchName]);
  }

  // Create the worktree with a new branch from HEAD
  git(cwd, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);

  // Copy ralph-tui config into the worktree
  copyConfig(cwd, worktreePath);

  return { worktreePath, branchName };
}

/**
 * Prepare a session worktree for execution.
 *
 * In resume mode:
 * - reuse an already-attached worktree for the session branch when present
 * - otherwise attach a new worktree to the existing session branch
 *
 * In non-resume mode:
 * - create a fresh session worktree (destructive replacement behavior)
 */
export async function prepareSessionWorktree(
  cwd: string,
  sessionName: string,
  options?: { resume?: boolean },
): Promise<PreparedSessionWorktreeResult> {
  const branchName = `ralph-session/${sessionName}`;
  const baseDir = getWorktreeBaseDir(cwd);
  const worktreePath = path.join(baseDir, sessionName);
  const resume = options?.resume ?? false;

  if (resume) {
    let entries: Array<{ path: string; branch?: string }> = [];
    try {
      entries = parseWorktreeList(git(cwd, ['worktree', 'list', '--porcelain']));
    } catch {
      entries = [];
    }

    const attached = entries.find((entry) => entry.branch === branchName);
    if (attached) {
      return {
        worktreePath: attached.path,
        branchName,
        mode: 'reused',
      };
    }

    if (branchExists(cwd, branchName)) {
      await checkDiskSpace(cwd);
      fs.mkdirSync(baseDir, { recursive: true });

      if (fs.existsSync(worktreePath)) {
        try {
          git(cwd, ['worktree', 'remove', '--force', worktreePath]);
        } catch {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          try {
            git(cwd, ['worktree', 'prune']);
          } catch {
            // Best effort
          }
        }
      }

      git(cwd, ['worktree', 'add', worktreePath, branchName]);
      copyConfig(cwd, worktreePath);

      return {
        worktreePath,
        branchName,
        mode: 'attached',
      };
    }
  }

  const created = await createSessionWorktree(cwd, sessionName);
  return {
    ...created,
    mode: 'created',
  };
}

/** Result of merging a session worktree back to the original branch */
export interface MergeResult {
  /** Whether the merge was successful */
  success: boolean;
  /** Human-readable message describing what happened */
  message: string;
}

/**
 * Merge the session worktree branch back into the original branch.
 *
 * On success: switches to the original branch, merges (ff or commit),
 * removes the worktree directory, and deletes the session branch.
 *
 * On failure (conflicts): preserves the worktree and branch so the user
 * can resolve manually.
 *
 * @param cwd - The main project working directory (NOT the worktree)
 * @param worktreePath - Absolute path to the session worktree
 * @param branchName - The session branch name (e.g., "ralph-session/my-feature")
 * @returns MergeResult indicating success/failure with a message
 */
export async function mergeSessionWorktree(
  cwd: string,
  worktreePath: string,
  branchName: string,
): Promise<MergeResult> {
  // Determine the original branch to switch back to
  let originalBranch: string;
  try {
    // HEAD of the main repo should still be on the original branch
    originalBranch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch {
    return {
      success: false,
      message: `Failed to determine original branch. Worktree preserved at: ${worktreePath} (branch: ${branchName})`,
    };
  }

  // If the original branch IS the session branch (shouldn't happen, but guard), bail
  if (originalBranch === branchName) {
    return {
      success: false,
      message: `Original branch is the session branch (${branchName}). Worktree preserved at: ${worktreePath}`,
    };
  }

  // Check for uncommitted changes that would cause merge to fail
  try {
    git(cwd, ['diff', '--quiet']);
    git(cwd, ['diff', '--cached', '--quiet']);
  } catch {
    return {
      success: false,
      message: [
        'Cannot merge: the main working tree has uncommitted changes.',
        `  Worktree: ${worktreePath}`,
        `  Branch:   ${branchName}`,
        'Commit or stash your changes, then merge manually:',
        `  cd ${cwd}`,
        `  git merge ${branchName}`,
      ].join('\n'),
    };
  }

  // Try fast-forward merge first
  try {
    git(cwd, ['merge', '--ff-only', branchName]);
    console.log(`Merged ${branchName} into ${originalBranch} (fast-forward)`);
  } catch {
    // Fast-forward not possible, try regular merge
    try {
      git(cwd, ['merge', '--no-edit', branchName]);
      console.log(`Merged ${branchName} into ${originalBranch} (merge commit)`);
    } catch {
      // Merge failed — abort and preserve worktree
      try {
        git(cwd, ['merge', '--abort']);
      } catch {
        // merge --abort may fail if no merge in progress
      }

      return {
        success: false,
        message: [
          'Auto-merge failed due to conflicts.',
          `  Worktree: ${worktreePath}`,
          `  Branch:   ${branchName}`,
          'Resolve manually with:',
          `  cd ${cwd}`,
          `  git merge ${branchName}`,
        ].join('\n'),
      };
    }
  }

  // Merge succeeded — clean up worktree and branch
  await removeSessionWorktree(cwd, worktreePath, branchName);

  return {
    success: true,
    message: `Successfully merged ${branchName} into ${originalBranch}`,
  };
}

/**
 * Copy iteration logs from a session worktree to the main project.
 * This preserves logs so they can be reviewed after the worktree is removed
 * or when the session ends in a failed/incomplete state.
 * Best-effort — does not throw on failure.
 *
 * @param mainCwd - The main project working directory (NOT the worktree)
 * @param worktreePath - Absolute path to the session worktree
 */
export function preserveIterationLogs(mainCwd: string, worktreePath: string): void {
  const worktreeLogsDir = path.join(worktreePath, '.ralph-tui', 'iterations');
  const mainLogsDir = path.join(mainCwd, '.ralph-tui', 'iterations');

  if (!fs.existsSync(worktreeLogsDir)) {
    return;
  }

  try {
    fs.mkdirSync(mainLogsDir, { recursive: true });

    const logFiles = fs.readdirSync(worktreeLogsDir);
    for (const file of logFiles) {
      if (file.endsWith('.log')) {
        const srcPath = path.join(worktreeLogsDir, file);
        const destPath = path.join(mainLogsDir, file);

        // Don't overwrite if destination exists
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  } catch {
    // Best effort — don't fail if log preservation fails
  }
}

/**
 * Print a message telling the user their session worktree was preserved
 * and how to manually merge or clean it up.
 */
export function printWorktreePreservedMessage(
  worktreePath: string,
  branchName: string,
  reason: string,
): void {
  console.log('');
  console.log(`Session worktree preserved (${reason}).`);
  console.log(`  Worktree: ${worktreePath}`);
  console.log(`  Branch:   ${branchName}`);
  console.log('');
  console.log('To manually merge the work:');
  console.log(`  git merge ${branchName}`);
  console.log('');
  console.log('To clean up when done:');
  console.log(`  git worktree remove ${worktreePath}`);
}

/**
 * Remove a session worktree and its branch.
 * Best-effort cleanup — does not throw on failure.
 */
export async function removeSessionWorktree(
  cwd: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  // Force remove the worktree
  try {
    git(cwd, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    try {
      git(cwd, ['worktree', 'prune']);
    } catch {
      // Best effort
    }
  }

  // Delete the branch
  try {
    git(cwd, ['branch', '-D', branchName]);
  } catch {
    // Branch may already be deleted
  }

  // Remove worktree directories if empty
  try {
    const baseDir = getWorktreeBaseDir(cwd);
    const entries = fs.readdirSync(baseDir);
    if (entries.length === 0) {
      fs.rmdirSync(baseDir);
      const parentDir = path.dirname(baseDir);
      const parentEntries = fs.readdirSync(parentDir);
      if (parentEntries.length === 0) {
        fs.rmdirSync(parentDir);
      }
    }
  } catch {
    // Directory may not exist or not be empty
  }
}
