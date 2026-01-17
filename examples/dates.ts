/**
 * ABOUTME: Date formatting utilities for testing ralph-tui.
 * Provides common date operations: formatDate, daysBetween, and isWeekend.
 */

/**
 * Formats a date to ISO 8601 format string.
 * @param date - The date to format
 * @returns The date formatted as an ISO 8601 string (e.g., "2024-01-15T10:30:00.000Z")
 * @example
 * formatDate(new Date('2024-01-15T10:30:00Z')) // returns "2024-01-15T10:30:00.000Z"
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Calculates the number of complete days between two dates.
 * @param date1 - The first date
 * @param date2 - The second date
 * @returns The absolute number of complete days between the two dates
 * @example
 * daysBetween(new Date('2024-01-01'), new Date('2024-01-10')) // returns 9
 * daysBetween(new Date('2024-01-10'), new Date('2024-01-01')) // returns 9
 */
export function daysBetween(date1: Date, date2: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / msPerDay);
}

/**
 * Checks if a date falls on a weekend (Saturday or Sunday).
 * @param date - The date to check
 * @returns True if the date is a Saturday or Sunday, false otherwise
 * @example
 * isWeekend(new Date('2024-01-13')) // returns true (Saturday)
 * isWeekend(new Date('2024-01-15')) // returns false (Monday)
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
