/**
 * ABOUTME: Progress file management for cross-iteration context.
 * Maintains a progress.md file that accumulates notes from each iteration,
 * providing context for subsequent agent runs about what's been done.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { IterationResult } from '../engine/types.js';

/**
 * Default path for the progress file (relative to cwd).
 */
export const PROGRESS_FILE = '.ralph-tui/progress.md';

/**
 * Maximum size for the progress file before truncating old entries.
 * 50KB should provide plenty of context without bloating prompts.
 */
const MAX_PROGRESS_SIZE = 50_000;

/**
 * Patterns to extract notable content from agent output.
 */
const INSIGHT_PATTERN = /`?★ Insight[─\s]*`?\n([\s\S]*?)\n`?─+`?/gi;
const COMPLETION_NOTES_PATTERN = /<promise>\s*COMPLETE\s*<\/promise>/i;

/**
 * Entry for a single iteration in the progress file.
 */
export interface ProgressEntry {
  iteration: number;
  taskId: string;
  taskTitle: string;
  completed: boolean;
  timestamp: string;
  durationMs: number;
  notes?: string;
  insights?: string[];
  error?: string;
  /** Git commit hash after successful completion */
  commitHash?: string;
  /** Files changed in this iteration */
  filesChanged?: string[];
}

/**
 * Extract insights from agent output.
 * Looks for ★ Insight blocks commonly used in educational output style.
 */
function extractInsights(output: string): string[] {
  const insights: string[] = [];
  let match;

  // Reset regex state
  INSIGHT_PATTERN.lastIndex = 0;

  while ((match = INSIGHT_PATTERN.exec(output)) !== null) {
    const insight = match[1]?.trim();
    if (insight && insight.length > 10) {
      insights.push(insight);
    }
  }

  return insights;
}

/**
 * Extract completion notes - text immediately before <promise>COMPLETE</promise>.
 * Agents often summarize what was done right before the completion marker.
 */
function extractCompletionNotes(output: string): string | undefined {
  const match = output.match(COMPLETION_NOTES_PATTERN);
  if (!match) return undefined;

  // Get text before the completion marker (last ~500 chars)
  const beforeComplete = output.slice(0, match.index);
  const lastSection = beforeComplete.slice(-500).trim();

  // Look for a summary-like section (bullet points, "completed", etc.)
  const lines = lastSection.split('\n').filter(l => l.trim());
  const relevantLines = lines.slice(-5); // Last 5 lines before completion

  if (relevantLines.length > 0) {
    return relevantLines.join('\n');
  }

  return undefined;
}

/**
 * Format a progress entry as markdown.
 */
function formatProgressEntry(entry: ProgressEntry): string {
  const lines: string[] = [];
  const status = entry.completed ? '✓' : '✗';
  const duration = Math.round(entry.durationMs / 1000);

  lines.push(`## ${status} Iteration ${entry.iteration} - ${entry.taskId}: ${entry.taskTitle}`);
  lines.push(`*${entry.timestamp} (${duration}s)*`);
  if (entry.commitHash) {
    lines.push(`**Commit:** ${entry.commitHash}`);
  }
  lines.push('');

  if (entry.completed) {
    lines.push('**Status:** Completed');
  } else {
    lines.push('**Status:** Failed/Incomplete');
  }

  if (entry.error) {
    lines.push('');
    lines.push('**Error:**');
    lines.push(entry.error);
  }

  if (entry.filesChanged && entry.filesChanged.length > 0) {
    lines.push('');
    lines.push('**Files Changed:**');
    for (const file of entry.filesChanged.slice(0, 10)) {
      lines.push(`- ${file}`);
    }
    if (entry.filesChanged.length > 10) {
      lines.push(`- ... and ${entry.filesChanged.length - 10} more`);
    }
  }

  if (entry.notes) {
    lines.push('');
    lines.push('**Notes:**');
    lines.push(entry.notes);
  }

  if (entry.insights && entry.insights.length > 0) {
    lines.push('');
    lines.push('**Insights:**');
    for (const insight of entry.insights) {
      lines.push(insight);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * Create a progress entry from an iteration result.
 */
export function createProgressEntry(result: IterationResult): ProgressEntry {
  const output = result.agentResult?.stdout ?? '';

  return {
    iteration: result.iteration,
    taskId: result.task.id,
    taskTitle: result.task.title,
    completed: result.taskCompleted,
    timestamp: new Date().toISOString(),
    durationMs: result.durationMs ?? 0,
    notes: extractCompletionNotes(output),
    insights: extractInsights(output),
    error: result.error,
  };
}

/**
 * Append a progress entry to the progress file.
 * Creates the file if it doesn't exist.
 * Truncates old entries if file exceeds max size.
 */
export async function appendProgress(
  cwd: string,
  entry: ProgressEntry
): Promise<void> {
  const filePath = join(cwd, PROGRESS_FILE);
  const dirPath = dirname(filePath);

  // Ensure directory exists
  await mkdir(dirPath, { recursive: true });

  // Read existing content
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist yet - create with header
    existing = `# Ralph Progress Log

This file tracks progress across iterations. It's automatically updated
after each iteration and included in agent prompts for context.

---

`;
  }

  // Format and append new entry
  const newEntry = formatProgressEntry(entry);
  let content = existing + newEntry;

  // Truncate if too large (keep header + recent entries)
  if (content.length > MAX_PROGRESS_SIZE) {
    const headerEnd = content.indexOf('---\n\n') + 5;
    const header = content.slice(0, headerEnd);
    const entries = content.slice(headerEnd);

    // Keep last ~40KB of entries
    const keepSize = MAX_PROGRESS_SIZE - header.length - 1000;
    const trimmedEntries = entries.slice(-keepSize);

    // Find a clean break point (start of an entry)
    const cleanBreak = trimmedEntries.indexOf('\n## ');
    if (cleanBreak > 0) {
      content = header + '\n[...older entries truncated...]\n\n' + trimmedEntries.slice(cleanBreak + 1);
    } else {
      content = header + trimmedEntries;
    }
  }

  await writeFile(filePath, content, 'utf-8');
}

/**
 * Read the progress file content for inclusion in prompts.
 * Returns empty string if file doesn't exist.
 */
export async function readProgress(cwd: string): Promise<string> {
  const filePath = join(cwd, PROGRESS_FILE);

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
  cwd: string,
  maxEntries = 5
): Promise<string> {
  const content = await readProgress(cwd);
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
export async function clearProgress(cwd: string): Promise<void> {
  const filePath = join(cwd, PROGRESS_FILE);

  try {
    await writeFile(filePath, getDefaultProgressHeader(), 'utf-8');
  } catch {
    // Ignore errors
  }
}

/**
 * Default header for the progress file.
 * Includes a placeholder for the Codebase Patterns section.
 */
function getDefaultProgressHeader(): string {
  return `# Ralph Progress Log

This file tracks progress across iterations. It's automatically updated
after each iteration and included in agent prompts for context.

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
 * @param cwd Working directory
 * @returns Array of pattern strings, or empty array if none found
 */
export async function extractCodebasePatterns(cwd: string): Promise<string[]> {
  const content = await readProgress(cwd);
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
 * @param cwd Working directory
 * @returns Formatted patterns section markdown
 */
export async function getCodebasePatternsForPrompt(cwd: string): Promise<string> {
  const patterns = await extractCodebasePatterns(cwd);
  if (patterns.length === 0) return '';

  const lines = ['## Codebase Patterns (Study These First)', ''];
  for (const pattern of patterns) {
    lines.push(`- ${pattern}`);
  }
  lines.push('');

  return lines.join('\n');
}

