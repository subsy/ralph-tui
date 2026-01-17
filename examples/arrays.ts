/**
 * ABOUTME: Array manipulation utilities for testing ralph-tui.
 * Provides common array operations: unique, flatten, and chunk.
 */

/**
 * Returns an array with duplicate values removed.
 * @param arr - The array to deduplicate
 * @returns A new array containing only unique values
 * @example
 * unique([1, 2, 2, 3, 1]) // returns [1, 2, 3]
 * unique(['a', 'b', 'a']) // returns ['a', 'b']
 */
export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Flattens a nested array by one level.
 * @param arr - The array of arrays to flatten
 * @returns A new array with one level of nesting removed
 * @example
 * flatten([[1, 2], [3, 4]]) // returns [1, 2, 3, 4]
 * flatten([['a'], ['b', 'c']]) // returns ['a', 'b', 'c']
 */
export function flatten<T>(arr: T[][]): T[] {
  return arr.flat();
}

/**
 * Splits an array into chunks of a specified size.
 * @param arr - The array to split into chunks
 * @param size - The maximum size of each chunk
 * @returns An array of arrays, each with at most `size` elements
 * @example
 * chunk([1, 2, 3, 4, 5], 2) // returns [[1, 2], [3, 4], [5]]
 * chunk(['a', 'b', 'c'], 3) // returns [['a', 'b', 'c']]
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
