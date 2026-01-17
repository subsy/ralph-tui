/**
 * ABOUTME: Input validation utilities for common data formats.
 * Provides simple boolean validation functions for emails, URLs, and numeric strings.
 */

/**
 * Validates whether a string is a valid email address.
 * Uses a standard regex pattern that covers most common email formats.
 *
 * @param s - The string to validate
 * @returns True if the string is a valid email address, false otherwise
 */
export function isEmail(s: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(s);
}

/**
 * Validates whether a string is a valid URL.
 * Accepts http and https protocols with standard URL formatting.
 *
 * @param s - The string to validate
 * @returns True if the string is a valid URL, false otherwise
 */
export function isUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates whether a string represents a numeric value.
 * Accepts integers, decimals, and negative numbers.
 * Does not accept empty strings, whitespace-only strings, or NaN results.
 *
 * @param s - The string to validate
 * @returns True if the string is numeric, false otherwise
 */
export function isNumeric(s: string): boolean {
  if (s.trim() === "") {
    return false;
  }
  return !isNaN(Number(s)) && isFinite(Number(s));
}
