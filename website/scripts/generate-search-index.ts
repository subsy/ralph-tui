/**
 * ABOUTME: Build-time search index generator for documentation.
 * Scans all MDX files, extracts content, and generates a JSON index
 * that the client-side search can use.
 *
 * Run: bun run scripts/generate-search-index.ts
 */

import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';

/**
 * Represents a searchable item in the generated index.
 */
interface SearchIndexItem {
  /** Page title from frontmatter */
  title: string;
  /** Section heading if this is a subsection */
  section?: string;
  /** URL path to navigate to */
  href: string;
  /** Anchor ID for direct section linking */
  anchor?: string;
  /** Parent category for grouping */
  category: string;
  /** Content snippet for preview and search */
  snippet: string;
  /** Full searchable content (title + section + content) */
  searchableContent: string;
}

/**
 * Extracts YAML frontmatter from MDX content.
 */
function extractFrontmatter(rawContent: string): {
  frontmatter: Record<string, string>;
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

  const frontmatter: Record<string, string> = { title: 'Untitled' };
  const lines = frontmatterStr.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

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
 * Converts a heading text to a URL-friendly slug.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Extracts plain text from MDX content by stripping markdown syntax.
 */
function stripMarkdown(content: string): string {
  return (
    content
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      // Remove inline code
      .replace(/`[^`]+`/g, '')
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      // Remove headings markers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove HTML tags
      .replace(/<[^>]+>/g, '')
      // Remove JSX/MDX components
      .replace(/<\w+[^>]*\/>/g, '')
      .replace(/<\w+[^>]*>[\s\S]*?<\/\w+>/g, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extracts headings and their content sections from MDX.
 */
function extractSections(
  content: string,
): Array<{ title: string; content: string; level: number }> {
  const sections: Array<{ title: string; content: string; level: number }> = [];
  const lines = content.split('\n');
  let currentSection: {
    title: string;
    content: string[];
    level: number;
  } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        sections.push({
          title: currentSection.title,
          content: stripMarkdown(currentSection.content.join('\n')),
          level: currentSection.level,
        });
      }
      // Start new section
      currentSection = {
        title: headingMatch[2].trim(),
        content: [],
        level: headingMatch[1].length,
      };
    } else if (currentSection) {
      currentSection.content.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections.push({
      title: currentSection.title,
      content: stripMarkdown(currentSection.content.join('\n')),
      level: currentSection.level,
    });
  }

  return sections;
}

/**
 * Determines the category from a file path.
 */
function getCategoryFromPath(slug: string): string {
  const parts = slug.split('/');
  if (parts.length < 2) return 'Documentation';

  const categoryMap: Record<string, string> = {
    'getting-started': 'Getting Started',
    cli: 'CLI Commands',
    configuration: 'Configuration',
    plugins: 'Plugins',
    templates: 'Prompt Templates',
    troubleshooting: 'Troubleshooting',
  };

  return (
    categoryMap[parts[0]] ||
    parts[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Creates a snippet from content, truncating to a reasonable length.
 */
function createSnippet(content: string, maxLength = 150): string {
  const stripped = stripMarkdown(content);
  if (stripped.length <= maxLength) return stripped;
  return stripped.slice(0, maxLength).replace(/\s+\S*$/, '') + '...';
}

/**
 * Main function to generate the search index.
 */
async function generateSearchIndex(): Promise<void> {
  const docsDirectory = resolve(process.cwd(), 'content', 'docs');
  const outputPath = resolve(process.cwd(), 'lib', 'search-index.json');
  const items: SearchIndexItem[] = [];

  async function scanDirectory(dir: string, prefix = ''): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await scanDirectory(join(dir, entry.name), relativePath);
        } else if (entry.name.endsWith('.mdx')) {
          const slug = relativePath.replace(/\.mdx$/, '');
          const filePath = join(dir, entry.name);
          const rawContent = await readFile(filePath, 'utf-8');
          const { frontmatter, content } = extractFrontmatter(rawContent);

          const category = getCategoryFromPath(slug);
          const href = `/docs/${slug}`;
          const title = frontmatter.title || entry.name.replace('.mdx', '');
          const description = frontmatter.description || '';
          const fullContent = stripMarkdown(content);

          // Add the main page entry
          items.push({
            title,
            href,
            category,
            snippet: description || createSnippet(fullContent),
            searchableContent: [title, description, fullContent]
              .join(' ')
              .toLowerCase(),
          });

          // Add entries for each heading section
          const sections = extractSections(content);
          for (const section of sections) {
            if (section.content.length > 20) {
              // Only add if there's meaningful content
              items.push({
                title,
                section: section.title,
                href,
                anchor: slugify(section.title),
                category,
                snippet: createSnippet(section.content),
                searchableContent: [title, section.title, section.content]
                  .join(' ')
                  .toLowerCase(),
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }

  await scanDirectory(docsDirectory);

  // Ensure the output directory exists
  await mkdir(resolve(process.cwd(), 'lib'), { recursive: true });

  // Write the index
  await writeFile(outputPath, JSON.stringify(items, null, 2), 'utf-8');

  console.log(
    `✓ Generated search index with ${items.length} items at ${outputPath}`,
  );
}

// Run the generator
generateSearchIndex().catch(console.error);
