/**
 * ABOUTME: Shared task ordering utilities for tracker plugins.
 * Provides deterministic sorting for dotted child task IDs while preserving
 * the original positions of non-child IDs in mixed task lists.
 */

interface TaskWithId {
  id: string;
}

interface ParsedChildId {
  rawId: string;
  prefix: string;
  issueNumber: number;
}

const CHILD_TASK_ID_PATTERN = /^(.*)\.(\d+)$/;

function parseChildTaskId(id: string): ParsedChildId | undefined {
  const match = CHILD_TASK_ID_PATTERN.exec(id);
  if (!match) {
    return undefined;
  }

  const prefix = match[1];
  const issueNumberString = match[2];
  if (prefix === undefined || issueNumberString === undefined) {
    return undefined;
  }

  const issueNumber = Number(issueNumberString);
  if (!Number.isFinite(issueNumber)) {
    return undefined;
  }

  return {
    rawId: id,
    prefix,
    issueNumber,
  };
}

function compareParsedChildIds(a: ParsedChildId, b: ParsedChildId): number {
  const prefixComparison = a.prefix.localeCompare(b.prefix, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (prefixComparison !== 0) {
    return prefixComparison;
  }

  if (a.issueNumber !== b.issueNumber) {
    return a.issueNumber - b.issueNumber;
  }

  return a.rawId.localeCompare(b.rawId, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Sort dotted child IDs of form "<prefix>.<number>" numerically while keeping
 * non-child IDs fixed in their original relative positions.
 */
export function sortDottedChildTaskIds<T extends TaskWithId>(tasks: T[]): T[] {
  if (tasks.length < 2) {
    return tasks;
  }

  const childEntries: Array<{ index: number; task: T; parsed: ParsedChildId }> = [];
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) {
      continue;
    }

    const parsed = parseChildTaskId(task.id);
    if (parsed) {
      childEntries.push({ index, task, parsed });
    }
  }

  if (childEntries.length < 2) {
    return tasks;
  }

  const sortedChildren = childEntries
    .slice()
    .sort((a, b) => compareParsedChildIds(a.parsed, b.parsed))
    .map((entry) => entry.task);

  const result = tasks.slice();
  for (let i = 0; i < childEntries.length; i += 1) {
    const originalEntry = childEntries[i];
    const sortedTask = sortedChildren[i];
    if (!originalEntry || !sortedTask) {
      continue;
    }
    result[originalEntry.index] = sortedTask;
  }

  return result;
}

