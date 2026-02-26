/**
 * ABOUTME: Structured markdown body builder and parser for Linear story issues.
 * Builds and parses the heading-based markdown format used for Ralph metadata,
 * description, and acceptance criteria in Linear issue bodies.
 */

/**
 * Default Ralph Priority when metadata is missing or malformed.
 * Maps to TrackerTask.priority 2 (Medium) via clamp: Math.min(4, Math.max(0, 3 - 1)) = 2.
 */
export const DEFAULT_RALPH_PRIORITY = 3;

/**
 * Parameters for building a story issue body.
 */
export interface StoryBodyParams {
  storyId: string;
  ralphPriority: number;
  description: string;
  acceptanceCriteria: string[];
}

/**
 * Result of parsing a Linear story issue body.
 */
export interface ParsedStoryBody {
  /** Story ID extracted from Ralph Metadata section (e.g., "US-001") */
  storyId: string | undefined;
  /** Ralph Priority (unbounded integer, defaults to DEFAULT_RALPH_PRIORITY if missing/malformed) */
  ralphPriority: number;
  /** Description text extracted from the Description section */
  description: string;
  /** Acceptance criteria items extracted from checkbox list */
  acceptanceCriteria: string[];
}

/**
 * Build the structured markdown body for a Linear story issue.
 *
 * Format:
 * ```
 * ## Ralph Metadata
 * - **Story ID:** US-001
 * - **Ralph Priority:** 2
 *
 * ## Description
 * <description text>
 *
 * ## Acceptance Criteria
 * - [ ] First criterion
 * - [ ] Second criterion
 * ```
 */
export function buildStoryIssueBody(params: StoryBodyParams): string {
  const lines: string[] = [];

  lines.push('## Ralph Metadata');
  lines.push(`- **Story ID:** ${params.storyId}`);
  lines.push(`- **Ralph Priority:** ${params.ralphPriority}`);
  lines.push('');
  lines.push('## Description');
  lines.push(params.description);
  lines.push('');
  lines.push('## Acceptance Criteria');

  if (params.acceptanceCriteria.length > 0) {
    for (const criterion of params.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  } else {
    lines.push('*No acceptance criteria defined.*');
  }

  return lines.join('\n');
}

/**
 * Split markdown text into sections keyed by their `## Heading` title.
 * Content before the first heading is keyed as empty string.
 */
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const headingPattern = /^## (.+)$/;
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of body.split('\n')) {
    const match = headingPattern.exec(line);
    if (match) {
      sections.set(currentHeading, currentLines.join('\n').trim());
      currentHeading = match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  sections.set(currentHeading, currentLines.join('\n').trim());
  return sections;
}

/**
 * Extract Ralph Priority from a Ralph Metadata section body.
 * Looks for `- **Ralph Priority:** <number>` or `Ralph Priority: <number>`.
 * Returns DEFAULT_RALPH_PRIORITY if not found or not a valid integer.
 */
export function parseRalphPriority(metadataBody: string): number {
  const match = /Ralph Priority[:\s*]*\**\s*(\d+)/i.exec(metadataBody);
  if (!match) {
    return DEFAULT_RALPH_PRIORITY;
  }

  const parsed = parseInt(match[1], 10);
  if (isNaN(parsed)) {
    return DEFAULT_RALPH_PRIORITY;
  }

  return parsed;
}

/**
 * Extract Story ID from a Ralph Metadata section body.
 * Looks for `- **Story ID:** <value>` or `Story ID: <value>`.
 */
export function parseStoryId(metadataBody: string): string | undefined {
  const match = /Story ID[:\s*]*\**\s*(.+)/i.exec(metadataBody);
  if (!match) {
    return undefined;
  }
  return match[1].trim().replace(/\*+$/, '').trim() || undefined;
}

/**
 * Extract acceptance criteria items from a checkbox list section.
 * Matches both checked `- [x]` and unchecked `- [ ]` items.
 */
export function parseAcceptanceCriteria(sectionBody: string): string[] {
  const criteria: string[] = [];
  const checkboxPattern = /^-\s*\[[ xX]\]\s*(.+)$/;

  for (const line of sectionBody.split('\n')) {
    const match = checkboxPattern.exec(line.trim());
    if (match) {
      criteria.push(match[1].trim());
    }
  }

  return criteria;
}

/**
 * Parse a Linear story issue body into its structured components.
 * Handles missing sections and malformed metadata gracefully with safe defaults.
 */
export function parseStoryIssueBody(body: string): ParsedStoryBody {
  if (!body || !body.trim()) {
    return {
      storyId: undefined,
      ralphPriority: DEFAULT_RALPH_PRIORITY,
      description: '',
      acceptanceCriteria: [],
    };
  }

  const sections = splitSections(body);

  const metadataSection = sections.get('Ralph Metadata') ?? '';
  const descriptionSection = sections.get('Description') ?? '';
  const acSection = sections.get('Acceptance Criteria') ?? '';

  return {
    storyId: parseStoryId(metadataSection),
    ralphPriority: parseRalphPriority(metadataSection),
    description: descriptionSection,
    acceptanceCriteria: parseAcceptanceCriteria(acSection),
  };
}
