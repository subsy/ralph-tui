/**
 * ABOUTME: Search index generation and querying for documentation.
 * Builds a searchable index from MDX files including titles, headings, and content.
 * This module is client-safe (no fs/promises imports).
 */

import { docsNavigation, type NavItem } from './navigation';

/**
 * Converts a heading text to a URL-friendly slug.
 * This is a client-safe copy of the slugify function from docs.ts.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .trim();
}

/**
 * Represents a single searchable item in the index.
 */
export interface SearchItem {
  /** Unique identifier for the search result */
  id: string;
  /** Page title from navigation or frontmatter */
  title: string;
  /** Section heading if applicable */
  section?: string;
  /** Content snippet for preview */
  snippet: string;
  /** URL path to navigate to */
  href: string;
  /** Anchor ID for direct section linking */
  anchor?: string;
  /** Parent section name for categorization */
  category: string;
  /** Search score (populated during search) */
  score?: number;
}

/**
 * Static search index built from navigation structure.
 * In a real app, this would be generated at build time from MDX content.
 */
function buildSearchIndex(): SearchItem[] {
  const items: SearchItem[] = [];
  let idCounter = 0;

  function processNavItem(item: NavItem, parentCategory: string): void {
    if (item.href) {
      // Add the page itself
      items.push({
        id: `search-${idCounter++}`,
        title: item.title,
        snippet: getSnippetForPage(item.title, item.href),
        href: item.href,
        category: parentCategory,
      });

      // Add common sections for known pages
      const sections = getSectionsForPage(item.href);
      for (const section of sections) {
        items.push({
          id: `search-${idCounter++}`,
          title: item.title,
          section: section.title,
          snippet: section.snippet,
          href: item.href,
          anchor: slugify(section.title),
          category: parentCategory,
        });
      }
    }

    if (item.items) {
      const category = item.href ? parentCategory : item.title;
      for (const child of item.items) {
        processNavItem(child, category);
      }
    }
  }

  for (const item of docsNavigation) {
    processNavItem(item, item.title);
  }

  return items;
}

/**
 * Returns a contextual snippet for a page based on its path.
 */
function getSnippetForPage(title: string, href: string): string {
  const snippets: Record<string, string> = {
    '/docs/getting-started/introduction': 'AI Agent Loop Orchestrator - automate AI coding tasks with full visibility',
    '/docs/getting-started/quick-start': 'Get up and running with Ralph TUI in 5 minutes',
    '/docs/getting-started/installation': 'Install Ralph TUI via npm, bun, or from source',
    '/docs/cli/overview': 'Complete reference for all Ralph TUI CLI commands',
    '/docs/cli/run': 'Start the orchestrator loop with task selection and agent execution',
    '/docs/cli/resume': 'Continue from a saved session or recover from interruption',
    '/docs/cli/status': 'View current execution status and task progress',
    '/docs/cli/logs': 'Access detailed logs for debugging and monitoring',
    '/docs/cli/setup': 'Initialize Ralph TUI configuration in your project',
    '/docs/cli/create-prd': 'Generate PRD templates for task definition',
    '/docs/cli/convert': 'Convert between task tracker formats',
    '/docs/configuration/overview': 'Customize Ralph TUI behavior and preferences',
    '/docs/configuration/config-file': 'ralph.config.json structure and location',
    '/docs/configuration/options': 'Complete reference of all configuration options',
    '/docs/plugins/overview': 'Extend Ralph TUI with agent and tracker plugins',
    '/docs/plugins/agents/claude': 'Configure Claude Code as your AI agent',
    '/docs/plugins/agents/opencode': 'Configure OpenCode as your AI agent',
    '/docs/plugins/trackers/json': 'Use prd.json files for simple task tracking',
    '/docs/plugins/trackers/beads': 'Git-backed issue tracking with Beads',
    '/docs/plugins/trackers/beads-bv': 'Graph-aware triage with Beads and bv',
    '/docs/templates/overview': 'How prompt templates transform tasks into agent instructions',
    '/docs/templates/customization': 'Create custom templates for your workflow',
    '/docs/templates/handlebars': 'Handlebars syntax reference for templates',
    '/docs/troubleshooting/common-issues': 'Solutions for common issues and error messages',
    '/docs/troubleshooting/debugging': 'Debug techniques and diagnostic tools',
  };

  return snippets[href] || `Documentation for ${title}`;
}

/**
 * Returns common sections for known documentation pages.
 */
function getSectionsForPage(href: string): Array<{ title: string; snippet: string }> {
  const sections: Record<string, Array<{ title: string; snippet: string }>> = {
    '/docs/getting-started/introduction': [
      { title: 'The Autonomous Loop', snippet: 'Continuous execution cycle: select, build, execute, detect, repeat' },
      { title: 'Key Concepts', snippet: 'Task trackers, agent plugins, prompt templates, and completion detection' },
      { title: 'Why Ralph TUI', snippet: 'Eliminate the copy-paste-wait cycle for AI-assisted coding' },
    ],
    '/docs/cli/run': [
      { title: 'Options', snippet: 'Command line flags: --max-iterations, --task-tracker, --agent' },
      { title: 'Examples', snippet: 'Common usage patterns and command combinations' },
    ],
    '/docs/configuration/overview': [
      { title: 'File Location', snippet: 'Config file discovery and precedence rules' },
      { title: 'Environment Variables', snippet: 'Override config with RALPH_* environment variables' },
    ],
    '/docs/plugins/overview': [
      { title: 'Agent Plugins', snippet: 'Connect AI coding assistants like Claude Code and OpenCode' },
      { title: 'Tracker Plugins', snippet: 'Integrate task sources like prd.json and Beads' },
    ],
    '/docs/templates/handlebars': [
      { title: 'Variables', snippet: 'Available template variables: task, context, history' },
      { title: 'Helpers', snippet: 'Built-in helpers for formatting and conditionals' },
    ],
  };

  return sections[href] || [];
}

// Build index once at module load
const searchIndex = buildSearchIndex();

/**
 * Searches the documentation index for matching items.
 * Uses simple substring matching with scoring based on match location.
 *
 * @param query - The search query string
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Sorted array of matching search items
 */
export function searchDocs(query: string, limit = 10): SearchItem[] {
  if (!query.trim()) {
    return [];
  }

  const normalizedQuery = query.toLowerCase().trim();
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

  const results: SearchItem[] = [];

  for (const item of searchIndex) {
    const titleLower = item.title.toLowerCase();
    const sectionLower = item.section?.toLowerCase() || '';
    const snippetLower = item.snippet.toLowerCase();
    const categoryLower = item.category.toLowerCase();

    let score = 0;

    for (const term of queryTerms) {
      // Exact title match gets highest score
      if (titleLower === term) {
        score += 100;
      } else if (titleLower.startsWith(term)) {
        score += 50;
      } else if (titleLower.includes(term)) {
        score += 25;
      }

      // Section match
      if (sectionLower.includes(term)) {
        score += 30;
      }

      // Category match
      if (categoryLower.includes(term)) {
        score += 15;
      }

      // Snippet match (lower priority)
      if (snippetLower.includes(term)) {
        score += 10;
      }
    }

    if (score > 0) {
      results.push({ ...item, score });
    }
  }

  // Sort by score descending, then by title alphabetically
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return (b.score || 0) - (a.score || 0);
    }
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, limit);
}

/**
 * Returns all items in a category for browsing.
 */
export function getSearchItemsByCategory(category: string): SearchItem[] {
  return searchIndex.filter(
    (item) => item.category.toLowerCase() === category.toLowerCase()
  );
}

/**
 * Returns all unique categories in the search index.
 */
export function getSearchCategories(): string[] {
  const categories = new Set(searchIndex.map((item) => item.category));
  return Array.from(categories);
}

export { searchIndex };
