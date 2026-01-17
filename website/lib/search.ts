/**
 * ABOUTME: Search functionality for documentation.
 * Uses a pre-built search index generated at build time from MDX content.
 * This module is client-safe and loads the index dynamically.
 */

import searchIndexData from './search-index.json';

/**
 * Represents a single searchable item in the index.
 */
export interface SearchItem {
  /** Unique identifier for the search result */
  id: string;
  /** Page title from frontmatter */
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
 * Raw search index item from the generated JSON.
 */
interface SearchIndexItem {
  title: string;
  section?: string;
  href: string;
  anchor?: string;
  category: string;
  snippet: string;
  searchableContent: string;
}

/**
 * Converts a heading text to a URL-friendly slug.
 * This is a client-safe copy of the slugify function from docs.ts.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// Build search index from generated data
const searchIndex: SearchItem[] = (searchIndexData as SearchIndexItem[]).map(
  (item, index) => ({
    id: `search-${index}`,
    title: item.title,
    section: item.section,
    snippet: item.snippet,
    href: item.href,
    anchor: item.anchor,
    category: item.category,
  }),
);

// Store searchable content separately for searching
const searchableContents: string[] = (searchIndexData as SearchIndexItem[]).map(
  (item) => item.searchableContent,
);

/**
 * Searches the documentation index for matching items.
 * Uses full-text matching against pre-indexed content.
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

  for (let i = 0; i < searchIndex.length; i++) {
    const item = searchIndex[i];
    const searchableContent = searchableContents[i];
    const titleLower = item.title.toLowerCase();
    const sectionLower = item.section?.toLowerCase() || '';

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

      // Full content match (searches actual MDX content)
      if (searchableContent.includes(term)) {
        score += 10;

        // Bonus for multiple occurrences (using safe string-based counting to avoid ReDoS)
        const occurrences = searchableContent.split(term).length - 1;
        score += Math.min(occurrences - 1, 5) * 2;
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
    (item) => item.category.toLowerCase() === category.toLowerCase(),
  );
}

/**
 * Returns all unique categories in the search index.
 */
export function getSearchCategories(): string[] {
  const categories = new Set(searchIndex.map((item) => item.category));
  return Array.from(categories);
}

export { searchIndex, slugify };
