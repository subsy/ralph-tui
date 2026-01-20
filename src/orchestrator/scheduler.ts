/**
 * ABOUTME: Scheduler for planning execution phases from dependency analysis.
 * Creates optimized execution phases with worker allocation based on constraints.
 */

import type { DependencyGraph, StoryNode } from './analyzer.js';
import type { Phase, StoryGroup, OrchestratorConfig } from './types.js';

export interface SchedulerConfig {
  maxWorkers: number;
  maxStoriesPerWorker?: number;
  rateLimit?: number; // max concurrent API calls
}

function buildSchedulerConfig(config: OrchestratorConfig): SchedulerConfig {
  return {
    maxWorkers: config.maxWorkers,
    maxStoriesPerWorker: 5,
    rateLimit: config.maxWorkers,
  };
}

function getEstimatedFiles(nodes: Map<string, StoryNode>, ids: string[]): string[] {
  const files = new Set<string>();
  for (const id of ids) {
    const node = nodes.get(id);
    if (node) node.estimatedFiles.forEach((f) => files.add(f));
  }
  return Array.from(files);
}

function partitionGroup(ids: string[], maxPerWorker: number): string[][] {
  const partitions: string[][] = [];
  for (let i = 0; i < ids.length; i += maxPerWorker) {
    partitions.push(ids.slice(i, i + maxPerWorker));
  }
  return partitions;
}

function toStoryGroup(nodes: Map<string, StoryNode>, ids: string[]): StoryGroup {
  const sorted = [...ids].sort();
  return {
    idRange: { from: sorted[0], to: sorted[sorted.length - 1] },
    estimatedFiles: getEstimatedFiles(nodes, ids),
  };
}

function canRunInParallel(nodes: Map<string, StoryNode>, groups: string[][]): boolean {
  if (groups.length <= 1) return false;
  const filesByGroup = groups.map((g) => new Set(getEstimatedFiles(nodes, g)));
  for (let i = 0; i < filesByGroup.length; i++) {
    for (let j = i + 1; j < filesByGroup.length; j++) {
      for (const file of filesByGroup[i]) {
        if (filesByGroup[j].has(file)) return false;
      }
    }
  }
  return true;
}

function determineWorkerCount(groupCount: number, sched: SchedulerConfig): number {
  const byRate = sched.rateLimit ?? sched.maxWorkers;
  return Math.min(groupCount, sched.maxWorkers, byRate);
}

/** Create execution schedule from dependency graph */
export function createSchedule(graph: DependencyGraph, config: OrchestratorConfig): Phase[] {
  const sched = buildSchedulerConfig(config);
  const phases: Phase[] = [];
  const { nodes, parallelGroups } = graph;

  for (let i = 0; i < parallelGroups.length; i++) {
    const group = parallelGroups[i];
    const maxPerWorker = sched.maxStoriesPerWorker ?? 5;
    const partitions = partitionGroup(group, maxPerWorker);
    const workerCount = determineWorkerCount(partitions.length, sched);

    // Re-partition to match actual worker count if needed
    const finalPartitions = redistributePartitions(group, workerCount);
    const storyGroups = finalPartitions.map((p) => toStoryGroup(nodes, p));
    const parallel = canRunInParallel(nodes, finalPartitions);

    phases.push({
      name: `Phase ${i + 1}`,
      storyGroups,
      parallel,
    });
  }

  return phases;
}

function redistributePartitions(ids: string[], workerCount: number): string[][] {
  if (workerCount <= 0 || ids.length === 0) return [ids];
  const sorted = [...ids].sort();
  const partitions: string[][] = Array.from({ length: workerCount }, () => []);
  sorted.forEach((id, i) => partitions[i % workerCount].push(id));
  return partitions.filter((p) => p.length > 0);
}
