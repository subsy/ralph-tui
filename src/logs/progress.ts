/**
 * ABOUTME: Progress file reading utilities for cross-iteration context.
 * Reads progress.md (written by agents) to provide context for subsequent
 * agent runs about what's been done.
 */

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Default path for the progress file (relative to cwd).
 */
export const PROGRESS_FILE = '.ralph-tui/progress.md';

/**
 * Working directory and optional configured progress file path.
 */
export interface ProgressLocation {
  cwd: string;
  progressFile?: string;
}

/**
 * Resolve a relative progress path against cwd; use absolute paths as-is.
 */
export function resolveProgressFile(location: ProgressLocation): string {
  const configured = location.progressFile?.trim() || PROGRESS_FILE;
  return isAbsolute(configured) ? configured : resolve(location.cwd, configured);
}

/**
 * Resolve a worker's isolated, gitignored progress file in its worktree.
 */
export function resolveWorkerProgressFile(worktreePath: string): string {
  return join(worktreePath, PROGRESS_FILE);
}

/**
 * Read the progress file content for inclusion in prompts.
 * Returns empty string if file doesn't exist.
 */
export async function readProgress(location: ProgressLocation): Promise<string> {
  const filePath = resolveProgressFile(location);

  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Get a summary of recent progress (last N entries) for prompts.
 * This is more concise than the full progress file.
 */
export async function getRecentProgressSummary(
  location: ProgressLocation,
  maxEntries = 5
): Promise<string> {
  const content = await readProgress(location);
  if (!content) return '';

  // Find entry headers
  const entryPattern = /## [✓✗] Iteration \d+/g;
  const matches = [...content.matchAll(entryPattern)];

  if (matches.length === 0) return '';

  // Get last N entries
  const startIndex = Math.max(0, matches.length - maxEntries);
  const startMatch = matches[startIndex];

  if (!startMatch || startMatch.index === undefined) return '';

  const recentContent = content.slice(startMatch.index);

  return `## Recent Progress (last ${Math.min(maxEntries, matches.length)} iterations)\n\n${recentContent}`;
}

/**
 * Clear the progress file (start fresh).
 */
export async function clearProgress(location: ProgressLocation): Promise<void> {
  const filePath = resolveProgressFile(location);
  const dirPath = dirname(filePath);

  try {
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, getDefaultProgressHeader(), 'utf-8');
  } catch {
    // Ignore errors
  }
}

/**
 * Create the progress file with its default header if it does not exist.
 */
export async function ensureProgressFile(location: ProgressLocation): Promise<void> {
  const filePath = resolveProgressFile(location);
  const dirPath = dirname(filePath);

  try {
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, getDefaultProgressHeader(), {
      encoding: 'utf-8',
      flag: 'wx',
    });
  } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Append a marker identifying the start of a new session.
 */
export async function appendProgressSessionMarker(
  location: ProgressLocation,
  sessionId: string
): Promise<void> {
  const filePath = resolveProgressFile(location);
  const marker = `\n---\n\n## Session ${sessionId} — started ${new Date().toISOString()}\n\n`;

  await appendFile(filePath, marker, 'utf-8');
}

/**
 * Default header for the progress file.
 * Includes a placeholder for the Codebase Patterns section.
 */
function getDefaultProgressHeader(): string {
  return `# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*

---

`;
}

/**
 * Pattern for matching the Codebase Patterns section.
 */
const PATTERNS_SECTION_REGEX = /## Codebase Patterns.*?\n([\s\S]*?)(?=\n---|\n## [^C])/i;

/**
 * Extract codebase patterns from the progress file.
 * These are consolidated learnings that should be read first.
 *
 * @param location Progress file location
 * @returns Array of pattern strings, or empty array if none found
 */
export async function extractCodebasePatterns(location: ProgressLocation): Promise<string[]> {
  const content = await readProgress(location);
  if (!content) return [];

  const match = content.match(PATTERNS_SECTION_REGEX);
  if (!match || !match[1]) return [];

  const patternsSection = match[1].trim();
  if (!patternsSection || patternsSection.startsWith('*Add reusable patterns')) {
    return [];
  }

  // Extract bullet points
  const patterns = patternsSection
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0);

  return patterns;
}

/**
 * Get the formatted codebase patterns section for prompts.
 * Returns empty string if no patterns exist.
 *
 * @param location Progress file location
 * @returns Formatted patterns section markdown
 */
export async function getCodebasePatternsForPrompt(location: ProgressLocation): Promise<string> {
  const patterns = await extractCodebasePatterns(location);
  if (patterns.length === 0) return '';

  const lines = ['## Codebase Patterns (Study These First)', ''];
  for (const pattern of patterns) {
    lines.push(`- ${pattern}`);
  }
  lines.push('');

  return lines.join('\n');
}
