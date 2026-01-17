/**
 * ABOUTME: Tests for validation utility functions.
 * Tests input validation helpers for strings, numbers, and configurations.
 */

import { describe, test, expect } from 'bun:test';
import {
  validateRequired,
  validatePattern,
  validateLength,
  validateRange,
  validateOneOf,
  validateEmail,
  validateUrl,
  validateInteger,
  validatePositive,
  validateNonNegative,
  validateNonEmptyArray,
  composeValidators,
  validateObject,
  isObject,
  isNonEmptyString,
  sanitizeString,
  validateSlug,
  validateSemver,
} from '../../src/utils/validation.js';

describe('validation utility', () => {
  describe('validateRequired', () => {
    test('returns valid for non-empty string', () => {
      const result = validateRequired('hello', 'name');
      expect(result.valid).toBe(true);
    });

    test('returns invalid for undefined', () => {
      const result = validateRequired(undefined, 'name');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name is required');
    });

    test('returns invalid for null', () => {
      const result = validateRequired(null, 'name');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name is required');
    });

    test('returns invalid for empty string', () => {
      const result = validateRequired('', 'name');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name cannot be empty');
    });

    test('returns invalid for whitespace-only string', () => {
      const result = validateRequired('   ', 'name');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name cannot be empty');
    });

    test('returns valid for numbers', () => {
      expect(validateRequired(0, 'count').valid).toBe(true);
      expect(validateRequired(42, 'count').valid).toBe(true);
    });
  });

  describe('validatePattern', () => {
    test('returns valid when pattern matches', () => {
      const result = validatePattern('abc123', /^[a-z0-9]+$/, 'code');
      expect(result.valid).toBe(true);
    });

    test('returns invalid when pattern does not match', () => {
      const result = validatePattern('abc 123', /^[a-z0-9]+$/, 'code');
      expect(result.valid).toBe(false);
    });

    test('uses custom pattern description', () => {
      const result = validatePattern('invalid', /^[0-9]+$/, 'id', 'numeric ID');
      expect(result.error).toBe('id must be a numeric ID');
    });
  });

  describe('validateLength', () => {
    test('returns valid within range', () => {
      const result = validateLength('hello', {
        min: 2,
        max: 10,
        fieldName: 'name',
      });
      expect(result.valid).toBe(true);
    });

    test('returns invalid below minimum', () => {
      const result = validateLength('a', { min: 2, fieldName: 'name' });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name must be at least 2 characters');
    });

    test('returns invalid above maximum', () => {
      const result = validateLength('hello world', {
        max: 5,
        fieldName: 'name',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name must be at most 5 characters');
    });

    test('allows exact minimum length', () => {
      const result = validateLength('hi', { min: 2, fieldName: 'name' });
      expect(result.valid).toBe(true);
    });

    test('allows exact maximum length', () => {
      const result = validateLength('hello', { max: 5, fieldName: 'name' });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateRange', () => {
    test('returns valid within range', () => {
      const result = validateRange(5, { min: 1, max: 10, fieldName: 'count' });
      expect(result.valid).toBe(true);
    });

    test('returns invalid for NaN', () => {
      const result = validateRange(NaN, { fieldName: 'count' });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('count must be a valid number');
    });

    test('returns invalid below minimum', () => {
      const result = validateRange(0, { min: 1, fieldName: 'count' });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('count must be at least 1');
    });

    test('returns invalid above maximum', () => {
      const result = validateRange(11, { max: 10, fieldName: 'count' });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('count must be at most 10');
    });
  });

  describe('validateOneOf', () => {
    test('returns valid for allowed value', () => {
      const result = validateOneOf('red', ['red', 'green', 'blue'], 'color');
      expect(result.valid).toBe(true);
    });

    test('returns invalid for disallowed value', () => {
      const result = validateOneOf('yellow', ['red', 'green', 'blue'], 'color');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('color must be one of: red, green, blue');
    });

    test('works with numbers', () => {
      expect(validateOneOf(1, [1, 2, 3], 'level').valid).toBe(true);
      expect(validateOneOf(4, [1, 2, 3], 'level').valid).toBe(false);
    });
  });

  describe('validateEmail', () => {
    test('returns valid for valid email', () => {
      expect(validateEmail('user@example.com').valid).toBe(true);
      expect(validateEmail('user.name@example.co.uk').valid).toBe(true);
    });

    test('returns invalid for invalid email', () => {
      expect(validateEmail('invalid').valid).toBe(false);
      expect(validateEmail('user@').valid).toBe(false);
      expect(validateEmail('@example.com').valid).toBe(false);
    });
  });

  describe('validateUrl', () => {
    test('returns valid for valid URL', () => {
      expect(validateUrl('https://example.com').valid).toBe(true);
      expect(validateUrl('http://localhost:3000').valid).toBe(true);
      expect(validateUrl('ftp://files.example.com').valid).toBe(true);
    });

    test('returns invalid for invalid URL', () => {
      expect(validateUrl('not-a-url').valid).toBe(false);
      expect(validateUrl('example.com').valid).toBe(false);
    });
  });

  describe('validateInteger', () => {
    test('returns valid for integer', () => {
      expect(validateInteger(42, 'count').valid).toBe(true);
      expect(validateInteger(0, 'count').valid).toBe(true);
      expect(validateInteger(-5, 'count').valid).toBe(true);
    });

    test('returns invalid for float', () => {
      const result = validateInteger(3.14, 'count');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('count must be an integer');
    });
  });

  describe('validatePositive', () => {
    test('returns valid for positive number', () => {
      expect(validatePositive(1, 'amount').valid).toBe(true);
      expect(validatePositive(0.1, 'amount').valid).toBe(true);
    });

    test('returns invalid for zero', () => {
      const result = validatePositive(0, 'amount');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('amount must be positive');
    });

    test('returns invalid for negative', () => {
      const result = validatePositive(-1, 'amount');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateNonNegative', () => {
    test('returns valid for zero', () => {
      expect(validateNonNegative(0, 'count').valid).toBe(true);
    });

    test('returns valid for positive', () => {
      expect(validateNonNegative(5, 'count').valid).toBe(true);
    });

    test('returns invalid for negative', () => {
      const result = validateNonNegative(-1, 'count');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('count must be non-negative');
    });
  });

  describe('validateNonEmptyArray', () => {
    test('returns valid for non-empty array', () => {
      expect(validateNonEmptyArray([1, 2, 3], 'items').valid).toBe(true);
      expect(validateNonEmptyArray(['a'], 'items').valid).toBe(true);
    });

    test('returns invalid for empty array', () => {
      const result = validateNonEmptyArray([], 'items');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('items must be a non-empty array');
    });

    test('returns invalid for non-array', () => {
      const result = validateNonEmptyArray(
        'not array' as unknown as unknown[],
        'items',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('composeValidators', () => {
    test('returns valid when all validators pass', () => {
      const result = composeValidators(
        () => validateRequired('hello', 'name'),
        () => validateLength('hello', { min: 2, max: 10, fieldName: 'name' }),
      );
      expect(result.valid).toBe(true);
    });

    test('returns first error when validator fails', () => {
      const result = composeValidators(
        () => validateRequired('', 'name'),
        () => validateLength('', { min: 2, fieldName: 'name' }),
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name cannot be empty');
    });

    test('stops at first failure', () => {
      let secondCalled = false;
      composeValidators(
        () => ({ valid: false, error: 'first error' }),
        () => {
          secondCalled = true;
          return { valid: true };
        },
      );
      expect(secondCalled).toBe(false);
    });
  });

  describe('validateObject', () => {
    test('returns valid when all fields pass', () => {
      const obj = { name: 'test', count: 5 };
      const result = validateObject(obj, {
        name: (v) => validateRequired(v, 'name'),
        count: (v) => validatePositive(v as number, 'count'),
      });
      expect(result.valid).toBe(true);
    });

    test('returns error for failing field', () => {
      const obj = { name: '', count: 5 };
      const result = validateObject(obj, {
        name: (v) => validateRequired(v, 'name'),
        count: (v) => validatePositive(v as number, 'count'),
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('name cannot be empty');
    });
  });

  describe('isObject', () => {
    test('returns true for plain object', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
    });

    test('returns false for array', () => {
      expect(isObject([])).toBe(false);
    });

    test('returns false for null', () => {
      expect(isObject(null)).toBe(false);
    });

    test('returns false for primitives', () => {
      expect(isObject('string')).toBe(false);
      expect(isObject(42)).toBe(false);
      expect(isObject(true)).toBe(false);
    });
  });

  describe('isNonEmptyString', () => {
    test('returns true for non-empty string', () => {
      expect(isNonEmptyString('hello')).toBe(true);
    });

    test('returns false for empty string', () => {
      expect(isNonEmptyString('')).toBe(false);
    });

    test('returns false for whitespace-only string', () => {
      expect(isNonEmptyString('   ')).toBe(false);
    });

    test('returns false for non-string', () => {
      expect(isNonEmptyString(42)).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    test('trims whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    test('removes control characters', () => {
      expect(sanitizeString('hello\x00world')).toBe('helloworld');
      expect(sanitizeString('test\x1F')).toBe('test');
    });

    test('keeps normal characters', () => {
      expect(sanitizeString('Hello, World! 123')).toBe('Hello, World! 123');
    });
  });

  describe('validateSlug', () => {
    test('returns valid for valid slug', () => {
      expect(validateSlug('my-project').valid).toBe(true);
      expect(validateSlug('project123').valid).toBe(true);
      expect(validateSlug('a').valid).toBe(true);
    });

    test('returns invalid for uppercase', () => {
      expect(validateSlug('My-Project').valid).toBe(false);
    });

    test('returns invalid for spaces', () => {
      expect(validateSlug('my project').valid).toBe(false);
    });

    test('returns invalid for consecutive hyphens', () => {
      expect(validateSlug('my--project').valid).toBe(false);
    });

    test('returns invalid for leading/trailing hyphens', () => {
      expect(validateSlug('-project').valid).toBe(false);
      expect(validateSlug('project-').valid).toBe(false);
    });
  });

  describe('validateSemver', () => {
    test('returns valid for valid semver', () => {
      expect(validateSemver('1.0.0').valid).toBe(true);
      expect(validateSemver('0.1.0').valid).toBe(true);
      expect(validateSemver('10.20.30').valid).toBe(true);
    });

    test('returns valid for semver with v prefix', () => {
      expect(validateSemver('v1.0.0').valid).toBe(true);
    });

    test('returns valid for semver with prerelease', () => {
      expect(validateSemver('1.0.0-alpha').valid).toBe(true);
      expect(validateSemver('1.0.0-beta.1').valid).toBe(true);
    });

    test('returns valid for semver with build metadata', () => {
      expect(validateSemver('1.0.0+build').valid).toBe(true);
      expect(validateSemver('1.0.0-alpha+001').valid).toBe(true);
    });

    test('returns invalid for invalid semver', () => {
      expect(validateSemver('1.0').valid).toBe(false);
      expect(validateSemver('1').valid).toBe(false);
      expect(validateSemver('version1').valid).toBe(false);
    });
  });
});
