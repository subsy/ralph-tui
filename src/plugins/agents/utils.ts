/**
 * ABOUTME: Shared utility functions for agent plugins.
 * Contains common helpers used across multiple agent implementations.
 */

/**
 * Extract a string error message from various error formats.
 * Handles: string, { message: string }, { error: string }, or other objects.
 *
 * @param err - The error value to extract a message from
 * @returns A string error message, or empty string if no error
 */
export function extractErrorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    // Fallback: stringify the object
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}
