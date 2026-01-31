/**
 * ABOUTME: Markdown PRD parser for converting existing PRD documents to JSON.
 * Parses US-XXX sections to extract user stories, titles, descriptions, and acceptance criteria.
 */

import type { PrdUserStory, GeneratedPrd } from './types.js';

/**
 * Result of parsing a PRD markdown file.
 */
export interface ParsedPrd {
  /** Name/title of the PRD */
  name: string;

  /** Description/overview from the PRD */
  description: string;

  /** Extracted user stories */
  userStories: PrdUserStory[];

  /** Branch name if found in the document */
  branchName?: string;

  /** Original creation date if found */
  createdAt?: string;

  /** Any parsing warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Options for parsing PRD markdown.
 */
export interface ParseOptions {
  /** Story ID prefix pattern to match (default: "US-") */
  storyPrefix?: string;

  /** Strict mode - fail on parsing issues (default: false) */
  strict?: boolean;
}

/**
 * Pattern to match user story headers: ### US-001: Title or ## US-001: Title or #### US-001: Title
 * Supports multiple ID formats:
 * - US-001: Standard 3-digit format
 * - US-2.1.1: Version-style format (X.Y or X.Y.Z)
 * - EPIC-123: Custom prefix format
 * - Feature 1.1: Feature version format
 */
const USER_STORY_HEADER_PATTERN = /^#{2,4}\s+(US-\d{3}|US-\d+(?:\.\d+)+|(?!US-)[A-Z]+-\d+|Feature\s+\d+\.\d+):\s*(.+)$/;

/**
 * Fallback pattern to match ANY header with a colon in the User Stories section.
 * Used when strict patterns don't match. Captures any H2/H3/H4 header.
 * Examples: "### Epic 1: Title", "## 1. Story Title", "#### Any Header: With Colon"
 */
const FALLBACK_STORY_HEADER_PATTERN = /^(#{2,4})\s+(.+?):\s*(.+)$/;

/**
 * Pattern to match PRD title from first H1
 */
const PRD_TITLE_PATTERN = /^#\s+(?:PRD:\s*)?(.+)$/;

/**
 * Pattern to match branch name from document
 */
const BRANCH_NAME_PATTERN = /^>\s*Branch:\s*`?([^`\n]+)`?/m;

/**
 * Pattern to match generated/creation date
 */
const CREATED_DATE_PATTERN = /^>\s*Generated:\s*(.+)$/m;

/**
 * Pattern to match acceptance criteria section
 */
const ACCEPTANCE_CRITERIA_PATTERN = /\*\*Acceptance Criteria:\*\*|^Acceptance Criteria:$/m;

/**
 * Pattern to match priority line
 */
const PRIORITY_PATTERN = /\*\*Priority:\*\*\s*P?(\d)/;

/**
 * Pattern to match depends on line
 */
const DEPENDS_ON_PATTERN = /\*\*Depends on:\*\*\s*(.+)/;

/**
 * Pattern to match checklist items: - [ ] or - [x]
 */
const CHECKLIST_ITEM_PATTERN = /^-\s+\[[\sx]\]\s+(.+)$/;

/**
 * Normalize story ID from various formats to standard format.
 * Examples:
 * - "US-001" → "US-001" (unchanged)
 * - "Feature 1.1" → "FEAT-1-1"
 * - "EPIC-123" → "EPIC-123" (unchanged)
 */
function normalizeStoryId(rawId: string): string {
  // If it's already in US-XXX or PREFIX-XXX format, keep it
  if (/^(US-\d{3}|[A-Z]+-\d+)$/.test(rawId)) {
    return rawId;
  }

  // Convert "Feature X.Y" to "FEAT-X-Y"
  const featureMatch = rawId.match(/^Feature\s+(\d+)\.(\d+)$/);
  if (featureMatch) {
    const majorVersion = featureMatch[1];
    const minorVersion = featureMatch[2];
    return `FEAT-${majorVersion}-${minorVersion}`;
  }

  // Fallback: return as-is
  return rawId;
}

/**
 * Extract the PRD title from the document.
 */
function extractTitle(markdown: string): string {
  const lines = markdown.split('\n');

  for (const line of lines) {
    const match = line.match(PRD_TITLE_PATTERN);
    if (match) {
      return match[1]?.trim() ?? 'Untitled PRD';
    }
  }

  return 'Untitled PRD';
}

/**
 * Extract description from the Overview section.
 */
function extractDescription(markdown: string): string {
  // Find the Overview section
  const overviewMatch = markdown.match(/^##\s+Overview\s*\n+([\s\S]*?)(?=\n##|\n---|\n$)/m);
  if (overviewMatch && overviewMatch[1]) {
    return overviewMatch[1].trim();
  }

  // Fall back to the first paragraph after the title
  const lines = markdown.split('\n');
  let foundTitle = false;
  const descLines: string[] = [];

  for (const line of lines) {
    if (line.match(PRD_TITLE_PATTERN)) {
      foundTitle = true;
      continue;
    }

    if (foundTitle && !line.startsWith('#') && !line.startsWith('>')) {
      if (line.trim()) {
        descLines.push(line.trim());
      } else if (descLines.length > 0) {
        break; // End of first paragraph
      }
    }
  }

  return descLines.join(' ').trim() || 'No description';
}

/**
 * Extract branch name from the document metadata.
 */
function extractBranchName(markdown: string): string | undefined {
  const match = markdown.match(BRANCH_NAME_PATTERN);
  return match?.[1]?.trim();
}

/**
 * Extract creation date from document metadata.
 */
function extractCreatedAt(markdown: string): string | undefined {
  const match = markdown.match(CREATED_DATE_PATTERN);
  if (match?.[1]) {
    // Try to parse as a date
    const dateStr = match[1].trim();
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return dateStr;
  }
  return undefined;
}

/**
 * Extract acceptance criteria from a user story section.
 */
function extractAcceptanceCriteria(section: string): string[] {
  const criteria: string[] = [];

  // Find the acceptance criteria section
  const acIndex = section.search(ACCEPTANCE_CRITERIA_PATTERN);
  if (acIndex === -1) {
    return criteria;
  }

  // Get lines after the acceptance criteria header
  const afterAc = section.slice(acIndex);
  const lines = afterAc.split('\n');

  // Skip the header line
  let foundHeader = false;
  for (const line of lines) {
    if (!foundHeader) {
      if (line.match(ACCEPTANCE_CRITERIA_PATTERN)) {
        foundHeader = true;
      }
      continue;
    }

    // Stop at next section header or separator
    if (line.startsWith('**') && !line.startsWith('**Acceptance')) {
      break;
    }
    if (line.startsWith('#') || line.startsWith('---')) {
      break;
    }

    // Extract checklist items
    const checklistMatch = line.match(CHECKLIST_ITEM_PATTERN);
    if (checklistMatch && checklistMatch[1]) {
      criteria.push(checklistMatch[1].trim());
      continue;
    }

    // Also accept plain bullet points
    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (bulletMatch && bulletMatch[1] && !bulletMatch[1].startsWith('[')) {
      criteria.push(bulletMatch[1].trim());
    }
  }

  return criteria;
}

/**
 * Extract priority from a user story section.
 */
function extractPriority(section: string): number {
  const match = section.match(PRIORITY_PATTERN);
  if (match && match[1]) {
    const priority = parseInt(match[1], 10);
    if (!isNaN(priority) && priority >= 0 && priority <= 4) {
      return priority;
    }
  }
  return 2; // Default to medium priority
}

/**
 * Extract dependencies from a user story section.
 */
function extractDependsOn(section: string): string[] | undefined {
  const match = section.match(DEPENDS_ON_PATTERN);
  if (match && match[1]) {
    // Split on comma, handling various formats
    const deps = match[1]
      .split(/,\s*/)
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    return deps.length > 0 ? deps : undefined;
  }
  return undefined;
}

/**
 * Pattern to match bold-prefixed metadata fields that terminate description extraction.
 * These are known structured fields, NOT description content.
 */
const DESCRIPTION_STOP_PATTERN = /^\*\*(Acceptance Criteria|Priority|Depends on|Labels|Notes):\*\*/;

/**
 * Pattern to match the **Description:** label prefix that LLMs sometimes generate.
 * The actual description text follows the label on the same line.
 */
const DESCRIPTION_LABEL_PATTERN = /^\*\*Description:\*\*\s*/;

/**
 * Extract the description (first paragraph) from a user story section.
 * Handles multiple LLM output formats:
 *   - Plain text: "As a user, I want..."
 *   - Bold-label: "**Description:** As a user, I want..."
 *   - Bold-keyword: "**As a** user **I want** to... **So that**..."
 */
function extractStoryDescription(section: string, headerLine: string): string {
  // Get lines after the header
  const lines = section.split('\n');
  const headerIndex = lines.findIndex((line) => line.includes(headerLine));

  if (headerIndex === -1) {
    return '';
  }

  const descLines: string[] = [];

  // Start after the header
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';

    // Stop at acceptance criteria or other known metadata sections
    if (line.match(ACCEPTANCE_CRITERIA_PATTERN)) {
      break;
    }
    if (line.match(DESCRIPTION_STOP_PATTERN)) {
      break;
    }
    if (line.startsWith('#')) {
      break;
    }
    if (line.startsWith('---')) {
      break;
    }

    // Strip **Description:** label prefix if present
    const stripped = line.replace(DESCRIPTION_LABEL_PATTERN, '');

    // Add non-empty lines (after stripping labels)
    if (stripped) {
      descLines.push(stripped);
    } else if (descLines.length > 0) {
      // Empty line ends the description paragraph
      break;
    }
  }

  // Join and strip any remaining bold markers used for emphasis (e.g., **As a** → As a)
  const raw = descLines.join(' ').trim();
  return raw.replace(/\*\*([^*]+)\*\*/g, '$1');
}

/**
 * Find all user story sections in the markdown.
 * Uses a 3-tier fallback strategy to ALWAYS find something:
 * 1. Strict patterns (US-XXX, US-X.Y.Z, PREFIX-XXX, Feature X.Y)
 * 2. Any header with colon in "User Stories" section
 * 3. Ultimate fallback: ANY H2/H3/H4 with colon in entire document
 */
function findUserStorySections(markdown: string): Array<{ id: string; title: string; section: string }> {
  // First try with strict patterns
  const strictSections = findUserStorySectionsStrict(markdown);
  if (strictSections.length > 0) {
    return strictSections;
  }

  // Second fallback: find any headers in User Stories section
  const fallbackSections = findUserStorySectionsFallback(markdown);
  if (fallbackSections.length > 0) {
    return fallbackSections;
  }

  // Ultimate fallback: find ANY headers with colons in the entire document
  return findUserStorySectionsUltimate(markdown);
}

/**
 * Find user story sections using strict ID patterns.
 */
function findUserStorySectionsStrict(markdown: string): Array<{ id: string; title: string; section: string }> {
  const sections: Array<{ id: string; title: string; section: string }> = [];
  const lines = markdown.split('\n');

  let currentStory: { id: string; title: string; startIndex: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = line.match(USER_STORY_HEADER_PATTERN);

    if (match) {
      // Save previous story section
      if (currentStory) {
        const sectionLines = lines.slice(currentStory.startIndex, i);
        sections.push({
          id: currentStory.id,
          title: currentStory.title,
          section: sectionLines.join('\n'),
        });
      }

      // Start new story
      currentStory = {
        id: normalizeStoryId(match[1] ?? ''),
        title: match[2]?.trim() ?? '',
        startIndex: i,
      };
    }
  }

  // Don't forget the last story
  if (currentStory) {
    const sectionLines = lines.slice(currentStory.startIndex);
    sections.push({
      id: currentStory.id,
      title: currentStory.title,
      section: sectionLines.join('\n'),
    });
  }

  return sections;
}

/**
 * Fallback: Find any H2/H3/H4 headers with colons in the User Stories section.
 * Auto-generates IDs like STORY-001, STORY-002, etc.
 */
function findUserStorySectionsFallback(markdown: string): Array<{ id: string; title: string; section: string }> {
  const sections: Array<{ id: string; title: string; section: string }> = [];
  const lines = markdown.split('\n');

  // Find the "User Stories" section
  let inUserStoriesSection = false;
  let storyCounter = 0;
  let currentStory: { id: string; title: string; startIndex: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Check if we're entering User Stories section
    if (/^#{1,2}\s+.*(?:User\s*Stor(?:y|ies)|Felhasználói\s*történet)/i.test(line)) {
      inUserStoriesSection = true;
      continue;
    }

    // Check if we're leaving User Stories section (any H1 or H2 that's not a story header)
    if (inUserStoriesSection && /^#{1,2}\s+/.test(line)) {
      // Check if this H1/H2 looks like a story header (has colon format)
      const looksLikeStory = FALLBACK_STORY_HEADER_PATTERN.test(line);
      if (!looksLikeStory) {
        // Not a story header - we've left the User Stories section
        // Save last story and exit
        if (currentStory) {
          const sectionLines = lines.slice(currentStory.startIndex, i);
          sections.push({
            id: currentStory.id,
            title: currentStory.title,
            section: sectionLines.join('\n'),
          });
        }
        break;
      }
    }

    if (!inUserStoriesSection) continue;

    // Match any header with colon (potential story)
    const fallbackMatch = line.match(FALLBACK_STORY_HEADER_PATTERN);
    if (fallbackMatch) {
      // Save previous story section
      if (currentStory) {
        const sectionLines = lines.slice(currentStory.startIndex, i);
        sections.push({
          id: currentStory.id,
          title: currentStory.title,
          section: sectionLines.join('\n'),
        });
      }

      // Generate auto ID or extract from prefix
      storyCounter++;
      const prefix = fallbackMatch[2]?.trim() ?? '';
      const title = fallbackMatch[3]?.trim() ?? '';

      // Try to use the prefix as ID if it looks like one, otherwise generate
      let id: string;
      // Match valid ID formats:
      // - US-XXX (exactly 3 digits) or US-X.Y.Z (version style)
      // - Non-US prefix with digits (EPIC-1, TASK-123)
      // - Feature X.Y format
      const validIdPattern = /^US-\d{3}$|^US-\d+(?:\.\d+)+$|^(?!US-)[A-Z]+-\d+$|^Feature\s+\d+\.\d+$/i;
      if (validIdPattern.test(prefix)) {
        id = normalizeStoryId(prefix);
      } else {
        id = `STORY-${String(storyCounter).padStart(3, '0')}`;
      }

      currentStory = {
        id,
        title: title || prefix,
        startIndex: i,
      };
    }
  }

  // Don't forget the last story
  if (currentStory) {
    const sectionLines = lines.slice(currentStory.startIndex);
    sections.push({
      id: currentStory.id,
      title: currentStory.title,
      section: sectionLines.join('\n'),
    });
  }

  return sections;
}

/**
 * Ultimate fallback: Find ANY H2/H3/H4 headers with colons in the entire document.
 * This ensures we ALWAYS generate some stories, even from non-standard PRDs.
 * Skips common non-story headers like "Overview:", "Description:", etc.
 */
function findUserStorySectionsUltimate(markdown: string): Array<{ id: string; title: string; section: string }> {
  const sections: Array<{ id: string; title: string; section: string }> = [];
  const lines = markdown.split('\n');

  let storyCounter = 0;
  let currentStory: { id: string; title: string; startIndex: number } | null = null;

  // Headers to skip (common section headers, not stories)
  const skipHeaders = /^#{1,4}\s*(?:Overview|Description|Summary|Introduction|Background|Goals|Objectives|Requirements|Technical|Implementation|Architecture|Design|Testing|Documentation|Appendix|References|Glossary|Changelog|Notes|Risks|Timeline|Dependencies|Constraints|Assumptions|Scope|Összefoglaló|Leírás|Célok|Követelmények|Technikai|Implementáció|Tesztelés|Dokumentáció):/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Skip the title (H1)
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      continue;
    }

    // Skip known non-story headers
    if (skipHeaders.test(line)) {
      continue;
    }

    // Match any H2/H3/H4 with colon
    const match = line.match(/^(#{2,4})\s+(.+?):\s*(.+)$/);
    if (match) {
      // Save previous story section
      if (currentStory) {
        const sectionLines = lines.slice(currentStory.startIndex, i);
        sections.push({
          id: currentStory.id,
          title: currentStory.title,
          section: sectionLines.join('\n'),
        });
      }

      storyCounter++;
      const prefix = match[2]?.trim() ?? '';
      const title = match[3]?.trim() ?? '';

      // Try to use prefix as ID if it looks like one
      let id: string;
      const validIdPattern = /^US-\d{3}$|^US-\d+(?:\.\d+)+$|^(?!US-)[A-Z]+-\d+$|^Feature\s+\d+\.\d+$/i;
      if (validIdPattern.test(prefix)) {
        id = normalizeStoryId(prefix);
      } else {
        id = `STORY-${String(storyCounter).padStart(3, '0')}`;
      }

      currentStory = {
        id,
        title: title || prefix,
        startIndex: i,
      };
    }
  }

  // Don't forget the last story
  if (currentStory) {
    const sectionLines = lines.slice(currentStory.startIndex);
    sections.push({
      id: currentStory.id,
      title: currentStory.title,
      section: sectionLines.join('\n'),
    });
  }

  return sections;
}

/**
 * Parse a PRD markdown document into a structured format.
 */
export function parsePrdMarkdown(
  markdown: string,
  options: ParseOptions = {}
): ParsedPrd {
  const warnings: string[] = [];
  const storyPrefix = options.storyPrefix || 'US-';

  // Extract top-level information
  const name = extractTitle(markdown);
  const description = extractDescription(markdown);
  const branchName = extractBranchName(markdown);
  const createdAt = extractCreatedAt(markdown);

  // Find all user story sections
  const storySections = findUserStorySections(markdown);

  if (storySections.length === 0) {
    warnings.push(`No user stories found with pattern "### ${storyPrefix}XXX: Title"`);
  }

  // Parse each user story
  const userStories: PrdUserStory[] = [];

  for (let i = 0; i < storySections.length; i++) {
    const storySection = storySections[i];
    if (!storySection) continue;

    const { id, title, section } = storySection;

    // Extract story details
    const storyDescription = extractStoryDescription(section, title);
    const acceptanceCriteria = extractAcceptanceCriteria(section);
    const priority = extractPriority(section);
    const dependsOn = extractDependsOn(section);

    // Warn if no acceptance criteria
    if (acceptanceCriteria.length === 0) {
      warnings.push(`Story ${id} has no acceptance criteria`);
    }

    // Assign priority based on order if not specified in document
    // Stories appearing earlier get higher priority (lower number)
    const orderBasedPriority = Math.min(i + 1, 4);

    userStories.push({
      id,
      title,
      description: storyDescription || title,
      acceptanceCriteria,
      priority: priority !== 2 ? priority : orderBasedPriority,
      dependsOn,
    });
  }

  return {
    name,
    description,
    userStories,
    branchName,
    createdAt,
    warnings,
  };
}

/**
 * Convert a parsed PRD to the GeneratedPrd format for JSON export.
 */
export function parsedPrdToGeneratedPrd(
  parsed: ParsedPrd,
  branchNameOverride?: string
): GeneratedPrd {
  const slug = parsed.name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    name: parsed.name,
    slug,
    description: parsed.description,
    targetUsers: 'End users',
    problemStatement: parsed.description,
    solution: parsed.description,
    successMetrics: 'Feature works as specified',
    constraints: 'None specified',
    userStories: parsed.userStories,
    branchName: branchNameOverride || parsed.branchName || `feature/${slug}`,
    createdAt: parsed.createdAt || new Date().toISOString(),
  };
}
