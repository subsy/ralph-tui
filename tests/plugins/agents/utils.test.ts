/**
 * ABOUTME: Unit tests for shared agent utility helpers.
 * Verifies stable error message extraction across supported input shapes.
 */

import { describe, expect, test } from 'bun:test';
import { extractErrorMessage } from '../../../src/plugins/agents/utils.js';

describe('extractErrorMessage', () => {
  test('returns empty string for nullish values', () => {
    expect(extractErrorMessage(undefined)).toBe('');
    expect(extractErrorMessage(null)).toBe('');
  });

  test('returns string input unchanged', () => {
    expect(extractErrorMessage('simple error')).toBe('simple error');
  });

  test('prefers message property when present', () => {
    expect(extractErrorMessage({ message: 'from message', error: 'from error' })).toBe(
      'from message',
    );
  });

  test('uses error property when message is missing', () => {
    expect(extractErrorMessage({ error: 'from error' })).toBe('from error');
  });

  test('stringifies plain objects as fallback', () => {
    expect(extractErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  test('returns fallback text when JSON.stringify throws', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(extractErrorMessage(circular)).toBe('Unknown error');
  });

  test('handles non-object, non-string values', () => {
    expect(extractErrorMessage(404)).toBe('404');
    expect(extractErrorMessage(true)).toBe('true');
  });
});
