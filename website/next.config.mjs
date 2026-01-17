/**
 * ABOUTME: Next.js configuration with MDX support for the Ralph TUI website.
 * Configures MDX processing with remark/rehype plugins for documentation pages.
 * Uses string-based plugin names for Turbopack compatibility (Next.js 16+).
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import createMDX from '@next/mdx';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8'),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  // Silence lockfile warning in monorepo setup
  outputFileTracingRoot: join(__dirname, '../'),
  // Expose version to client
  env: {
    NEXT_PUBLIC_VERSION: packageJson.version,
  },
};

// Next.js 16+ with Turbopack requires plugins as strings, not imported functions
const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: [
      'rehype-slug',
      [
        'rehype-autolink-headings',
        {
          behavior: 'wrap',
          properties: {
            className: ['anchor'],
          },
        },
      ],
      [
        'rehype-pretty-code',
        {
          theme: 'tokyo-night',
          keepBackground: true,
        },
      ],
    ],
  },
});

export default withMDX(nextConfig);
