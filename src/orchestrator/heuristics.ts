/**
 * ABOUTME: Smart parallelism heuristics for story classification.
 * Detects story types (test, refactor, docs) and assigns parallelism confidence.
 */

import type { PrdUserStory } from '../prd/types.js';
import type { ParallelismHint } from './types.js';

const TEST_PATTERNS = [/\btest\b/i, /\bspec\b/i, /\btesting\b/i, /\bunit test\b/i];
const REFACTOR_PATTERNS = [/\brefactor\b/i, /\brename\b/i, /\bmove\b/i, /\brestructure\b/i];
const DOCS_PATTERNS = [/\bdocs?\b/i, /\breadme\b/i, /\bdocument\b/i, /\bdocumentation\b/i];

type StoryType = 'test' | 'refactor' | 'docs' | 'unknown';

interface ClassificationResult {
  type: StoryType;
  confidence: number;
  reason: string;
}

function matchesPatterns(text: string, patterns: RegExp[]): number {
  return patterns.filter((p) => p.test(text)).length;
}

function getStoryText(story: PrdUserStory): string {
  return [story.title, story.description, ...story.acceptanceCriteria].join(' ');
}

function classifyStory(story: PrdUserStory): ClassificationResult {
  const text = getStoryText(story);
  const testMatches = matchesPatterns(text, TEST_PATTERNS);
  const refactorMatches = matchesPatterns(text, REFACTOR_PATTERNS);
  const docsMatches = matchesPatterns(text, DOCS_PATTERNS);

  if (testMatches > 0 && testMatches >= refactorMatches && testMatches >= docsMatches) {
    return { type: 'test', confidence: Math.min(0.9, 0.6 + testMatches * 0.1), reason: 'test story' };
  }
  if (docsMatches > 0 && docsMatches >= refactorMatches) {
    return { type: 'docs', confidence: Math.min(0.9, 0.6 + docsMatches * 0.1), reason: 'documentation story' };
  }
  if (refactorMatches > 0) {
    return { type: 'refactor', confidence: Math.min(0.9, 0.6 + refactorMatches * 0.1), reason: 'refactor story' };
  }
  return { type: 'unknown', confidence: 0.3, reason: 'no clear pattern' };
}

function typeToConfidence(classification: ClassificationResult): number {
  switch (classification.type) {
    case 'test':
      return classification.confidence;
    case 'docs':
      return classification.confidence;
    case 'refactor':
      return 1 - classification.confidence; // inverse - low parallelism
    default:
      return classification.confidence;
  }
}

/** Compute parallelism hint for a story based on heuristics */
export function computeParallelismHint(story: PrdUserStory): ParallelismHint {
  const classification = classifyStory(story);
  return {
    confidence: typeToConfidence(classification),
    reason: classification.reason,
  };
}

/** Check if a story needs AI analysis (confidence below threshold) */
export function needsAiAnalysis(hint: ParallelismHint, threshold = 0.5): boolean {
  return hint.confidence < threshold;
}

/** Apply AI-analyzed hints to stories */
export function applyAiHints(
  hints: Map<string, ParallelismHint>,
  aiResults: Map<string, ParallelismHint>
): Map<string, ParallelismHint> {
  const merged = new Map(hints);
  for (const [id, aiHint] of aiResults) {
    merged.set(id, aiHint);
  }
  return merged;
}

/** Calculate average parallelism confidence for a group of hints */
export function groupConfidence(hints: ParallelismHint[]): number {
  if (hints.length === 0) return 0.5;
  return hints.reduce((sum, h) => sum + h.confidence, 0) / hints.length;
}
