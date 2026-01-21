/**
 * ABOUTME: Adapter to convert TrackerTask[] to PrdUserStory[] for orchestrator analysis.
 * Enables the orchestrator to work with tasks loaded from any tracker plugin.
 */

import type { TrackerTask } from '../plugins/trackers/types.js';
import type { PrdUserStory } from '../prd/types.js';
import { analyzePrd, type DependencyGraph, type AnalyzeOptions } from './index.js';

/**
 * Convert a TrackerTask to a PrdUserStory for orchestrator analysis.
 * Maps compatible fields and provides sensible defaults for missing ones.
 */
function trackerTaskToStory(task: TrackerTask): PrdUserStory {
  const acceptanceCriteria = extractAcceptanceCriteria(task.description);

  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    acceptanceCriteria,
    priority: Math.max(1, task.priority) as 1 | 2 | 3 | 4,
    labels: task.labels,
    dependsOn: task.dependsOn,
  };
}

/**
 * Extract acceptance criteria from a description string.
 * Looks for bullet points, numbered lists, or lines starting with "- [ ]".
 */
function extractAcceptanceCriteria(description: string | undefined): string[] {
  if (!description) return [];

  const criteria: string[] = [];
  const lines = description.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*]\s+(?:\[.\]\s+)?(.+)$/);
    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (bulletMatch?.[1]) {
      criteria.push(bulletMatch[1]);
    } else if (numberedMatch?.[1]) {
      criteria.push(numberedMatch[1]);
    }
  }

  return criteria;
}

/**
 * Convert an array of TrackerTasks to PrdUserStories.
 * Only includes tasks that are open or in_progress (not completed/cancelled).
 */
export function convertTrackerTasksToStories(tasks: TrackerTask[]): PrdUserStory[] {
  return tasks
    .filter((task) => task.status === 'open' || task.status === 'in_progress')
    .map(trackerTaskToStory);
}

/**
 * Analyze tracker tasks and return the dependency graph.
 */
export async function analyzeTrackerTasks(
  tasks: TrackerTask[],
  analyzeOptions?: AnalyzeOptions
): Promise<DependencyGraph> {
  const stories = convertTrackerTasksToStories(tasks);

  if (stories.length === 0) {
    return { nodes: new Map(), parallelGroups: [] };
  }

  return analyzePrd(stories, analyzeOptions);
}
