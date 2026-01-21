/**
 * ABOUTME: Adapter to convert TrackerTask[] to PrdUserStory[] for orchestrator analysis.
 * Enables the orchestrator to work with tasks loaded from any tracker plugin.
 */

import type { TrackerTask } from '../plugins/trackers/types.js';
import type { PrdUserStory } from '../prd/types.js';
import { analyzePrd, createSchedule, type DependencyGraph, type AnalyzeOptions } from './index.js';
import type { OrchestratorConfig, Phase } from './types.js';

/**
 * Convert a TrackerTask to a PrdUserStory for orchestrator analysis.
 * Maps compatible fields and provides sensible defaults for missing ones.
 */
function trackerTaskToStory(task: TrackerTask): PrdUserStory {
  // Extract acceptance criteria from description if present
  // Look for bullet points or numbered lists that might be criteria
  const acceptanceCriteria = extractAcceptanceCriteria(task.description);

  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    acceptanceCriteria,
    // TrackerTask priority is 0-4 (0=highest), PrdUserStory is 1-4 (1=highest)
    // Map: 0->1, 1->1, 2->2, 3->3, 4->4
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
    // Match bullet points: "- item", "* item"
    // Match numbered lists: "1. item", "1) item"
    // Match checkboxes: "- [ ] item", "- [x] item"
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

/** Minimal config for scheduling (only maxWorkers is used) */
interface ScheduleConfig {
  maxWorkers: number;
}

/**
 * Analyze tracker tasks and create an execution schedule.
 * Returns phases that can be executed by the WorkerManager.
 */
export async function analyzeTrackerTasks(
  tasks: TrackerTask[],
  config: ScheduleConfig,
  analyzeOptions?: AnalyzeOptions
): Promise<{ graph: DependencyGraph; phases: Phase[] }> {
  const stories = convertTrackerTasksToStories(tasks);

  if (stories.length === 0) {
    return {
      graph: { nodes: new Map(), parallelGroups: [] },
      phases: [],
    };
  }

  const graph = await analyzePrd(stories, analyzeOptions);
  // createSchedule only uses maxWorkers from config, so cast is safe
  const fullConfig = { maxWorkers: config.maxWorkers, prdPath: '', headless: true, cwd: '' } as OrchestratorConfig;
  const phases = createSchedule(graph, fullConfig);

  return { graph, phases };
}
