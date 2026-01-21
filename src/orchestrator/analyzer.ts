/**
 * ABOUTME: PRD analyzer for dependency detection and parallel grouping.
 * Analyzes user stories to build a dependency graph and identify parallelizable groups.
 */

import type { PrdUserStory } from '../prd/types.js';

export interface StoryNode {
  id: string;
  title: string;
  estimatedFiles: string[];
  explicitDeps: string[];
  implicitDeps: string[];
}

export interface DependencyGraph {
  nodes: Map<string, StoryNode>;
  parallelGroups: string[][];
}

export interface AnalyzeOptions {
  analyzeAmbiguous?: (stories: PrdUserStory[]) => Promise<Map<string, string[]>>;
}

/** Sort IDs numerically if all are numbers, otherwise lexicographically */
function sortIds(ids: string[]): string[] {
  const allNumeric = ids.every((id) => /^\d+$/.test(id));
  if (allNumeric) {
    return [...ids].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }
  return [...ids].sort();
}

const FILE_PATTERNS = [
  /src\/[^\s"'`,)]+\.[a-z]+/gi,
  /(?:^|\s)([a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_-]+\.[a-z]+/gi,
  /[a-zA-Z0-9_-]+\.(ts|tsx|js|jsx|json|md|css|scss)/gi,
];

function extractFileHints(text: string): string[] {
  const files = new Set<string>();
  for (const pattern of FILE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) matches.forEach((m) => files.add(m.trim().toLowerCase()));
  }
  return Array.from(files);
}

function buildNode(story: PrdUserStory): StoryNode {
  const text = [story.title, story.description, ...story.acceptanceCriteria].join(' ');
  return {
    id: story.id,
    title: story.title,
    estimatedFiles: extractFileHints(text),
    explicitDeps: story.dependsOn ?? [],
    implicitDeps: [],
  };
}

function detectImplicitDeps(nodes: Map<string, StoryNode>): void {
  const fileToStories = new Map<string, string[]>();
  for (const node of nodes.values()) {
    for (const file of node.estimatedFiles) {
      const stories = fileToStories.get(file) ?? [];
      stories.push(node.id);
      fileToStories.set(file, stories);
    }
  }
  for (const [, storyIds] of fileToStories) {
    if (storyIds.length < 2) continue;
    const sorted = sortIds(storyIds);
    for (let i = 1; i < sorted.length; i++) {
      const later = nodes.get(sorted[i]);
      const earlier = sorted[i - 1];
      if (later && !later.explicitDeps.includes(earlier) && !later.implicitDeps.includes(earlier)) {
        later.implicitDeps.push(earlier);
      }
    }
  }
}

function getAllDeps(node: StoryNode): string[] {
  return [...new Set([...node.explicitDeps, ...node.implicitDeps])];
}

function groupParallel(nodes: Map<string, StoryNode>): string[][] {
  const groups: string[][] = [];
  const completed = new Set<string>();

  while (completed.size < nodes.size) {
    const ready: string[] = [];
    for (const node of nodes.values()) {
      if (completed.has(node.id)) continue;
      if (getAllDeps(node).every((d) => completed.has(d))) ready.push(node.id);
    }
    if (ready.length === 0) {
      groups.push(Array.from(nodes.keys()).filter((id) => !completed.has(id)));
      break;
    }
    const sortedReady = sortIds(ready);
    groups.push(sortedReady);
    sortedReady.forEach((id) => completed.add(id));
  }
  return groups;
}

/** Analyze PRD to detect dependencies and group stories for parallel execution */
export async function analyzePrd(
  stories: PrdUserStory[],
  options?: AnalyzeOptions
): Promise<DependencyGraph> {
  const nodes = new Map<string, StoryNode>();
  for (const story of stories) nodes.set(story.id, buildNode(story));

  detectImplicitDeps(nodes);

  if (options?.analyzeAmbiguous) {
    const additionalDeps = await options.analyzeAmbiguous(stories);
    for (const [storyId, deps] of additionalDeps) {
      const node = nodes.get(storyId);
      if (!node) continue;
      for (const dep of deps) {
        if (!node.explicitDeps.includes(dep) && !node.implicitDeps.includes(dep)) {
          node.implicitDeps.push(dep);
        }
      }
    }
  }

  return { nodes, parallelGroups: groupParallel(nodes) };
}

