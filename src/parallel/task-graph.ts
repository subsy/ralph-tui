/**
 * ABOUTME: Task dependency graph analysis for parallel execution.
 * Uses topological sort (Kahn's algorithm) to detect cycles, compute task depths,
 * and group independent tasks into parallel execution groups.
 */

import type { TrackerTask } from '../plugins/trackers/types.js';
import type {
  TaskGraphNode,
  ParallelGroup,
  TaskGraphAnalysis,
} from './types.js';

/**
 * Analyze a set of tasks and their dependencies to determine parallel execution groups.
 *
 * Algorithm:
 * 1. Build an adjacency list from task dependsOn/blocks fields
 * 2. Run Kahn's algorithm for topological sort + cycle detection
 * 3. Group tasks by depth — same-depth tasks with no mutual dependencies form a ParallelGroup
 *
 * @param tasks - All tasks to analyze (should be open/in_progress, not completed)
 * @returns Analysis result with groups, cycle info, and parallelism recommendation
 */
export function analyzeTaskGraph(tasks: TrackerTask[]): TaskGraphAnalysis {
  const taskMap = new Map<string, TrackerTask>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  // Build graph nodes with adjacency info
  const nodes = buildGraph(tasks, taskMap);

  // Run Kahn's algorithm for topological sort and cycle detection
  const { depths, cyclicIds } = topologicalSort(nodes);

  // Mark cyclic nodes
  for (const id of cyclicIds) {
    const node = nodes.get(id);
    if (node) {
      node.inCycle = true;
    }
  }

  // Set depths on nodes
  for (const [id, depth] of depths) {
    const node = nodes.get(id);
    if (node) {
      node.depth = depth;
    }
  }

  // Group non-cyclic tasks by depth
  const groups = buildParallelGroups(nodes, depths, cyclicIds);

  const actionableTaskCount = tasks.length - cyclicIds.size;
  const maxParallelism =
    groups.length > 0
      ? Math.max(...groups.map((g) => g.tasks.length))
      : 0;

  return {
    nodes,
    groups,
    cyclicTaskIds: [...cyclicIds],
    actionableTaskCount,
    maxParallelism,
    recommendParallel: shouldRunParallelInternal(
      groups,
      tasks.length,
      cyclicIds.size
    ),
  };
}

/**
 * Determine whether parallel execution is beneficial for a given analysis.
 *
 * Heuristics:
 * - Need ≥2 tasks in at least one parallel group
 * - Need ≥3 total actionable tasks (overhead not worth it for 2)
 * - Must not have >50% cyclic tasks (graph is too tangled)
 */
export function shouldRunParallel(analysis: TaskGraphAnalysis): boolean {
  return analysis.recommendParallel;
}

/**
 * Internal heuristic evaluation for parallel recommendation.
 */
function shouldRunParallelInternal(
  groups: ParallelGroup[],
  totalTasks: number,
  cyclicCount: number
): boolean {
  const actionableCount = totalTasks - cyclicCount;

  // Need at least 3 actionable tasks (overhead not worth it for fewer)
  if (actionableCount < 3) {
    return false;
  }

  // Must not have more than 50% cyclic tasks
  if (totalTasks > 0 && cyclicCount / totalTasks > 0.5) {
    return false;
  }

  // Need at least one group with ≥2 tasks (actual parallelism)
  const hasParallelGroup = groups.some((g) => g.tasks.length >= 2);
  if (!hasParallelGroup) {
    return false;
  }

  return true;
}

/**
 * Build the dependency graph from tasks.
 * Creates nodes with forward (dependencies) and reverse (dependents) edges.
 * Only includes edges where both tasks exist in the input set.
 */
function buildGraph(
  tasks: TrackerTask[],
  taskMap: Map<string, TrackerTask>
): Map<string, TaskGraphNode> {
  const nodes = new Map<string, TaskGraphNode>();

  // Initialize all nodes
  for (const task of tasks) {
    nodes.set(task.id, {
      task,
      dependencies: [],
      dependents: [],
      depth: 0,
      inCycle: false,
    });
  }

  // Build edges from dependsOn relationships
  for (const task of tasks) {
    const node = nodes.get(task.id)!;

    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        // Only include edges to tasks in our set, and avoid duplicates
        if (taskMap.has(depId) && !node.dependencies.includes(depId)) {
          node.dependencies.push(depId);

          // Add reverse edge
          const depNode = nodes.get(depId);
          if (depNode && !depNode.dependents.includes(task.id)) {
            depNode.dependents.push(task.id);
          }
        }
      }
    }

    // Also process blocks (reverse direction)
    if (task.blocks) {
      for (const blockedId of task.blocks) {
        if (taskMap.has(blockedId)) {
          // task.blocks[blockedId] means blockedId depends on task
          const blockedNode = nodes.get(blockedId);
          if (blockedNode && !blockedNode.dependencies.includes(task.id)) {
            blockedNode.dependencies.push(task.id);
          }
          if (!node.dependents.includes(blockedId)) {
            node.dependents.push(blockedId);
          }
        }
      }
    }
  }

  return nodes;
}

/**
 * Run Kahn's algorithm for topological sort with depth computation.
 *
 * Kahn's algorithm:
 * 1. Find all nodes with in-degree 0 (no dependencies)
 * 2. Process them at depth 0, remove their outgoing edges
 * 3. Any newly zero-in-degree nodes go to the next depth level
 * 4. Repeat until no more nodes can be processed
 * 5. Any remaining nodes are in cycles
 *
 * @returns Map of task ID → depth, and set of cyclic task IDs
 */
function topologicalSort(
  nodes: Map<string, TaskGraphNode>
): { depths: Map<string, number>; cyclicIds: Set<string> } {
  // Compute in-degrees
  const inDegree = new Map<string, number>();
  for (const [id, node] of nodes) {
    inDegree.set(id, node.dependencies.length);
  }

  // Find initial nodes with zero in-degree
  let currentLevel: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      currentLevel.push(id);
    }
  }

  const depths = new Map<string, number>();
  let depth = 0;
  let processedCount = 0;

  // Process level by level
  while (currentLevel.length > 0) {
    const nextLevel: string[] = [];

    for (const id of currentLevel) {
      depths.set(id, depth);
      processedCount++;

      const node = nodes.get(id)!;
      for (const dependentId of node.dependents) {
        const currentDegree = inDegree.get(dependentId)!;
        const newDegree = currentDegree - 1;
        inDegree.set(dependentId, newDegree);

        if (newDegree === 0) {
          nextLevel.push(dependentId);
        }
      }
    }

    currentLevel = nextLevel;
    depth++;
  }

  // Any nodes not processed are in cycles
  const cyclicIds = new Set<string>();
  if (processedCount < nodes.size) {
    for (const [id] of nodes) {
      if (!depths.has(id)) {
        cyclicIds.add(id);
      }
    }
  }

  return { depths, cyclicIds };
}

/**
 * Build parallel groups from topologically sorted tasks.
 * Tasks at the same depth with no mutual dependencies form a group.
 * Groups are ordered by depth (must execute in order).
 */
function buildParallelGroups(
  nodes: Map<string, TaskGraphNode>,
  depths: Map<string, number>,
  cyclicIds: Set<string>
): ParallelGroup[] {
  // Group tasks by depth (excluding cyclic tasks)
  const depthBuckets = new Map<number, TrackerTask[]>();

  for (const [id, depth] of depths) {
    if (cyclicIds.has(id)) continue;

    const node = nodes.get(id);
    if (!node) continue;

    let bucket = depthBuckets.get(depth);
    if (!bucket) {
      bucket = [];
      depthBuckets.set(depth, bucket);
    }
    bucket.push(node.task);
  }

  // Convert to sorted ParallelGroup array
  const sortedDepths = [...depthBuckets.keys()].sort((a, b) => a - b);
  const groups: ParallelGroup[] = [];

  for (let i = 0; i < sortedDepths.length; i++) {
    const d = sortedDepths[i];
    const tasks = depthBuckets.get(d)!;

    // Sort tasks within group by priority (lower number = higher priority)
    tasks.sort((a, b) => a.priority - b.priority);

    const maxPriority = tasks.reduce(
      (max, t) => (t.priority < max ? t.priority : max),
      tasks[0].priority
    );

    groups.push({
      index: i,
      tasks,
      depth: d,
      maxPriority,
    });
  }

  return groups;
}
