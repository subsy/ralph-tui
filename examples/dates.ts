/**
 * ABOUTME: Date manipulation utilities for testing ralph-tui.
 * Provides common date operations: formatDate, daysBetween, and isWeekend.
 */

/**
 * Formats a Date object as a human-readable string (YYYY-MM-DD).
 * @param date - The date to format
 * @returns A string in YYYY-MM-DD format
 * @example
 * formatDate(new Date('2024-03-15')) // returns '2024-03-15'
 * formatDate(new Date(2024, 0, 1)) // returns '2024-01-01'
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates the number of days between two dates.
 * @param start - The start date
 * @param end - The end date
 * @returns The absolute number of days between the two dates
 * @example
 * daysBetween(new Date('2024-01-01'), new Date('2024-01-10')) // returns 9
 * daysBetween(new Date('2024-01-10'), new Date('2024-01-01')) // returns 9
 */
export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = Math.abs(end.getTime() - start.getTime());
  return Math.floor(diffMs / msPerDay);
}

/**
 * Checks if a given date falls on a weekend (Saturday or Sunday).
 * @param date - The date to check
 * @returns True if the date is a Saturday or Sunday, false otherwise
 * @example
 * isWeekend(new Date('2024-03-16')) // returns true (Saturday)
 * isWeekend(new Date('2024-03-18')) // returns false (Monday)
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
