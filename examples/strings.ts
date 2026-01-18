/**
 * ABOUTME: Simple string utilities for demonstration purposes.
 * Provides basic string operations: capitalize, reverse, and truncate.
 */

/**
 * Capitalizes the first letter of a string.
 *
 * @param s - The string to capitalize
 * @returns The string with its first letter capitalized
 */
export function capitalize(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Reverses a string.
 *
 * @param s - The string to reverse
 * @returns The reversed string
 */
export function reverse(s: string): string {
  return s.split('').reverse().join('');
}

/**
 * Truncates a string to a maximum length, adding '...' if truncated.
 *
 * @param s - The string to truncate
 * @param maxLen - The maximum length of the resulting string (including '...')
 * @returns The truncated string with '...' appended if it exceeds maxLen
 */
export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) {
    return s;
  }
  return s.slice(0, maxLen - 3) + '...';
}
