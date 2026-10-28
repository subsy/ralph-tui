/**
 * ABOUTME: Input validation utility functions.
 * Provides common validation helpers for strings, numbers, and configurations.
 */

import { compareSemverStrings } from './semver.js';

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Validate a required string
 */
export function validateRequired(value: unknown, fieldName: string): ValidationResult {
  if (value === undefined || value === null) {
    return { valid: false, error: `${fieldName} is required` };
  }

  if (typeof value === 'string' && value.trim() === '') {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  return { valid: true };
}

/**
 * Validate a string matches a pattern
 */
export function validatePattern(
  value: string,
  pattern: RegExp,
  fieldName: string,
  patternDesc?: string
): ValidationResult {
  if (!pattern.test(value)) {
    const desc = patternDesc || `valid ${fieldName} format`;
    return { valid: false, error: `${fieldName} must be a ${desc}` };
  }

  return { valid: true };
}

/**
 * Validate string length
 */
export function validateLength(
  value: string,
  options: { min?: number; max?: number; fieldName: string }
): ValidationResult {
  const { min, max, fieldName } = options;

  if (min !== undefined && value.length < min) {
    return { valid: false, error: `${fieldName} must be at least ${min} characters` };
  }

  if (max !== undefined && value.length > max) {
    return { valid: false, error: `${fieldName} must be at most ${max} characters` };
  }

  return { valid: true };
}

/**
 * Validate a number is within range
 */
export function validateRange(
  value: number,
  options: { min?: number; max?: number; fieldName: string }
): ValidationResult {
  const { min, max, fieldName } = options;

  if (isNaN(value)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }

  if (min !== undefined && value < min) {
    return { valid: false, error: `${fieldName} must be at least ${min}` };
  }

  if (max !== undefined && value > max) {
    return { valid: false, error: `${fieldName} must be at most ${max}` };
  }

  return { valid: true };
}

/**
 * Validate value is one of allowed options
 */
export function validateOneOf<T>(
  value: T,
  allowedValues: T[],
  fieldName: string
): ValidationResult {
  if (!allowedValues.includes(value)) {
    const allowed = allowedValues.map((v) => String(v)).join(', ');
    return { valid: false, error: `${fieldName} must be one of: ${allowed}` };
  }

  return { valid: true };
}

/**
 * Validate an email address
 */
export function validateEmail(value: string, fieldName = 'Email'): ValidationResult {
  // Basic email pattern
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return validatePattern(value, emailPattern, fieldName, 'valid email address');
}

/**
 * Validate a URL
 */
export function validateUrl(value: string, fieldName = 'URL'): ValidationResult {
  try {
    new URL(value);
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} must be a valid URL` };
  }
}

/**
 * Validate an integer
 */
export function validateInteger(value: number, fieldName: string): ValidationResult {
  if (!Number.isInteger(value)) {
    return { valid: false, error: `${fieldName} must be an integer` };
  }

  return { valid: true };
}

/**
 * Validate a positive number
 */
export function validatePositive(value: number, fieldName: string): ValidationResult {
  if (value <= 0) {
    return { valid: false, error: `${fieldName} must be positive` };
  }

  return { valid: true };
}

/**
 * Validate a non-negative number
 */
export function validateNonNegative(value: number, fieldName: string): ValidationResult {
  if (value < 0) {
    return { valid: false, error: `${fieldName} must be non-negative` };
  }

  return { valid: true };
}

/**
 * Validate an array is not empty
 */
export function validateNonEmptyArray(value: unknown[], fieldName: string): ValidationResult {
  if (!Array.isArray(value) || value.length === 0) {
    return { valid: false, error: `${fieldName} must be a non-empty array` };
  }

  return { valid: true };
}

/**
 * Compose multiple validators
 */
export function composeValidators(
  ...validators: (() => ValidationResult)[]
): ValidationResult {
  for (const validator of validators) {
    const result = validator();
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}

/**
 * Validate an object against a schema of validators
 */
export function validateObject<T extends Record<string, unknown>>(
  obj: T,
  schema: { [K in keyof T]?: (value: T[K]) => ValidationResult }
): ValidationResult {
  for (const [key, validator] of Object.entries(schema)) {
    if (validator) {
      const result = (validator as (value: unknown) => ValidationResult)(obj[key as keyof T]);
      if (!result.valid) {
        return result;
      }
    }
  }

  return { valid: true };
}

/**
 * Check if a value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Sanitize a string by trimming and removing control characters
 */
export function sanitizeString(value: string): string {
  return value.trim().replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Validate a slug (URL-safe identifier)
 */
export function validateSlug(value: string, fieldName = 'Slug'): ValidationResult {
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return validatePattern(
    value,
    slugPattern,
    fieldName,
    'lowercase letters, numbers, and hyphens'
  );
}

/**
 * Validate a semantic version string
 */
export function validateSemver(value: string, fieldName = 'Version'): ValidationResult {
  const semverPattern = /^v?\d+\.\d+\.\d+(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;
  return validatePattern(value, semverPattern, fieldName, 'semantic version (e.g., 1.0.0)');
}

/**
 * Check that the running Bun version meets a minimum requirement.
 *
 * @param currentVersion - The current Bun.version string (e.g., "1.2.0")
 * @param minVersion - The minimum required version (e.g., "1.3.6")
 * @returns null if the version is acceptable, or an error message string if too old
 */
export function checkBunVersion(currentVersion: string, minVersion: string): string | null {
  if (compareSemverStrings(currentVersion, minVersion) < 0) {
    return (
      `ralph-tui requires Bun >= ${minVersion}, but you are running Bun ${currentVersion}.\n` +
      `Run 'bun upgrade' or visit https://bun.sh/docs/installation`
    );
  }

  return null;
}
