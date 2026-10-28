/**
 * ABOUTME: Fuzzy search utility for file path matching.
 * Provides scoring-based fuzzy matching for file discovery and autocomplete.
 */

import { basename } from 'node:path';

/**
 * Result of a fuzzy match with score for ranking
 */
export interface FuzzyMatch {
  /** The original item that matched */
  item: string;
  /** Score for ranking (higher is better) */
  score: number;
}

/**
 * Perform fuzzy matching on a list of items
 *
 * Scoring strategy:
 * - Exact match: 1000 points
 * - Filename exact match: 800 points
 * - Filename starts with query: 600 points
 * - Filename contains query: 400 points
 * - Path contains query: 200 points
 * - Sequential character match (fzf-style): 1-100 points based on match quality
 *
 * @param items - List of items to search through
 * @param query - The search query
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Sorted array of matches with scores (highest first)
 */
export function fuzzySearch(items: string[], query: string, limit: number = 10): FuzzyMatch[] {
  if (!query || query.trim().length === 0) {
    // No query - return first N items sorted alphabetically
    return items
      .slice()
      .sort()
      .slice(0, limit)
      .map((item) => ({ item, score: 0 }));
  }

  const normalizedQuery = query.toLowerCase();
  const results: FuzzyMatch[] = [];

  for (const item of items) {
    const score = calculateScore(item, normalizedQuery);
    if (score > 0) {
      results.push({ item, score });
    }
  }

  // Sort by score (descending), then alphabetically for ties
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.item.localeCompare(b.item);
  });

  return results.slice(0, limit);
}

/**
 * Calculate a match score for an item against a query
 */
function calculateScore(item: string, query: string): number {
  const normalizedItem = item.toLowerCase();
  const filename = basename(item).toLowerCase();

  // Exact match - highest priority
  if (normalizedItem === query) {
    return 1000;
  }

  // Filename exact match
  if (filename === query) {
    return 800;
  }

  // Filename starts with query
  if (filename.startsWith(query)) {
    return 600 + (query.length / filename.length) * 50;
  }

  // Filename contains query
  if (filename.includes(query)) {
    return 400 + (query.length / filename.length) * 50;
  }

  // Path contains query
  if (normalizedItem.includes(query)) {
    return 200 + (query.length / normalizedItem.length) * 50;
  }

  // Sequential character match (fzf-style)
  const sequentialScore = calculateSequentialScore(normalizedItem, query);
  if (sequentialScore > 0) {
    return sequentialScore;
  }

  return 0;
}

/**
 * Calculate score for sequential character matching (fzf-style)
 * Characters must appear in order but not necessarily consecutively
 */
function calculateSequentialScore(item: string, query: string): number {
  let itemIndex = 0;
  let queryIndex = 0;
  let consecutiveBonus = 0;
  let lastMatchIndex = -2; // Start at -2 so first match at 0 isn't considered consecutive

  while (itemIndex < item.length && queryIndex < query.length) {
    if (item[itemIndex] === query[queryIndex]) {
      // Bonus for consecutive matches
      if (itemIndex === lastMatchIndex + 1) {
        consecutiveBonus += 10;
      }
      lastMatchIndex = itemIndex;
      queryIndex++;
    }
    itemIndex++;
  }

  // All query characters must be found
  if (queryIndex < query.length) {
    return 0;
  }

  // Base score for matching, plus bonuses
  const matchRatio = query.length / item.length;
  const baseScore = 50 + matchRatio * 50 + consecutiveBonus;

  return Math.min(100, baseScore);
}

/**
 * Simple filter for items that match a query (no scoring)
 * Useful when you just need to check if items match
 */
export function fuzzyFilter(items: string[], query: string): string[] {
  return fuzzySearch(items, query, items.length).map((m) => m.item);
}
