/**
 * ABOUTME: Generates sitemap.xml for search engine indexing.
 * Includes all static pages and documentation pages from the content directory.
 */

import type { MetadataRoute } from 'next';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://ralph-tui.dev';

/**
 * Recursively collects all MDX files from the docs content directory.
 */
function getDocSlugs(dir: string, basePath: string = ''): string[] {
  const slugs: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        slugs.push(...getDocSlugs(fullPath, relativePath));
      } else if (entry.name.endsWith('.mdx')) {
        // Remove .mdx extension to get the slug
        const slug = relativePath.replace(/\.mdx$/, '');
        slugs.push(slug);
      }
    }
  } catch {
    // Content directory might not exist during build
  }

  return slugs;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/docs`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
  ];

  // Documentation pages
  const docsDir = path.join(process.cwd(), 'content', 'docs');
  const docSlugs = getDocSlugs(docsDir);

  const docPages: MetadataRoute.Sitemap = docSlugs.map((slug) => ({
    url: `${BASE_URL}/docs/${slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  return [...staticPages, ...docPages];
}
