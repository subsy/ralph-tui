/**
 * ABOUTME: Generates robots.txt for search engine crawler directives.
 * Allows all crawlers access to the site and references the sitemap.
 */

import type { MetadataRoute } from 'next';

const BASE_URL = 'https://ralph-tui.dev';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
