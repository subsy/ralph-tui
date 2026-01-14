/**
 * ABOUTME: Utilities for handling MDX documentation content.
 * Provides functions to read MDX files, extract frontmatter, and generate table of contents.
 */

import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';

/**
 * Frontmatter metadata extracted from MDX files.
 */
export interface DocFrontmatter {
  title: string;
  description?: string;
  /** Optional date for blog posts or changelogs */
  date?: string;
  /** Optional author for blog posts */
  author?: string;
  /** Additional arbitrary metadata */
  [key: string]: string | undefined;
}

/**
 * Represents a heading in the table of contents.
 */
export interface TocItem {
  /** The heading text */
  title: string;
  /** URL-friendly slug for linking */
  id: string;
  /** Heading level (2 for h2, 3 for h3) */
  level: number;
  /** Nested headings (h3 under h2) */
  children?: TocItem[];
}

/**
 * Complete document data including content and metadata.
 */
export interface DocData {
  /** Raw MDX content (without frontmatter) */
  content: string;
  /** Extracted frontmatter metadata */
  frontmatter: DocFrontmatter;
  /** Generated table of contents */
  toc: TocItem[];
}

/**
 * Converts a heading text to a URL-friendly slug.
 * Matches the behavior of rehype-slug for consistency.
 *
 * @example
 * slugify('Getting Started') // 'getting-started'
 * slugify('API Reference (v2)') // 'api-reference-v2'
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .trim();
}

/**
 * Extracts YAML frontmatter from MDX content.
 * Returns the frontmatter object and the content without frontmatter.
 *
 * @example
 * const mdx = `---
 * title: My Page
 * description: A description
 * ---
 * # Content here`;
 *
 * const { frontmatter, content } = extractFrontmatter(mdx);
 */
export function extractFrontmatter(rawContent: string): {
  frontmatter: DocFrontmatter;
  content: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = rawContent.match(frontmatterRegex);

  if (!match) {
    return {
      frontmatter: { title: 'Untitled' },
      content: rawContent,
    };
  }

  const frontmatterStr = match[1];
  const content = rawContent.slice(match[0].length);

  // Parse YAML-like frontmatter (simple key: value pairs)
  const frontmatter: DocFrontmatter = { title: 'Untitled' };
  const lines = frontmatterStr.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, content };
}

/**
 * Generates a table of contents from MDX content.
 * Extracts h2 and h3 headings, creating a hierarchical structure.
 *
 * @example
 * const toc = generateTableOfContents(`
 * ## Getting Started
 * ### Prerequisites
 * ### Installation
 * ## Usage
 * `);
 * // Returns nested TocItem array
 */
export function generateTableOfContents(content: string): TocItem[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: TocItem[] = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const title = match[2].trim();
    const id = slugify(title);

    headings.push({ title, id, level });
  }

  // Build hierarchical structure (h3 nested under h2)
  const toc: TocItem[] = [];
  let currentH2: TocItem | null = null;

  for (const heading of headings) {
    if (heading.level === 2) {
      currentH2 = { ...heading, children: [] };
      toc.push(currentH2);
    } else if (heading.level === 3 && currentH2) {
      currentH2.children = currentH2.children || [];
      currentH2.children.push(heading);
    } else if (heading.level === 3) {
      // h3 without preceding h2, add to root
      toc.push(heading);
    }
  }

  return toc;
}

/**
 * Reads and parses an MDX file from the docs directory.
 *
 * @param slug - The document slug (e.g., 'getting-started' or 'cli/run')
 * @returns Document data including content, frontmatter, and TOC
 */
export async function getDocBySlug(slug: string): Promise<DocData> {
  // Resolve to absolute path for reliable comparison
  const docsDirectory = resolve(process.cwd(), 'content', 'docs');

  // Resolve the full file path (this normalizes .. and other path components)
  const filePath = resolve(docsDirectory, `${slug}.mdx`);

  // Ensure the resolved path is within the docs directory
  // Use trailing slash to prevent sibling-prefix matches (e.g., /docs-evil/file)
  if (!filePath.startsWith(docsDirectory + '/')) {
    throw new Error('Invalid document path');
  }

  const rawContent = await readFile(filePath, 'utf-8');
  const { frontmatter, content } = extractFrontmatter(rawContent);
  const toc = generateTableOfContents(content);

  return { content, frontmatter, toc };
}

/**
 * Gets all document slugs for static generation.
 * Recursively scans the docs directory for MDX files.
 *
 * @returns Array of slug paths (e.g., ['getting-started', 'cli/run'])
 */
export async function getAllDocSlugs(): Promise<string[]> {
  const docsDirectory = join(process.cwd(), 'content', 'docs');
  const slugs: string[] = [];

  async function scanDirectory(dir: string, prefix = ''): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await scanDirectory(join(dir, entry.name), relativePath);
        } else if (entry.name.endsWith('.mdx')) {
          // Remove .mdx extension
          slugs.push(relativePath.replace(/\.mdx$/, ''));
        }
      }
    } catch {
      // Directory doesn't exist yet, return empty array
    }
  }

  await scanDirectory(docsDirectory);
  return slugs;
}
