// ABOUTME: Tests Unicode printable keyboard sequence classification.
// ABOUTME: Covers printable code points, controls, and multi-code-point input.

import { describe, expect, test } from 'bun:test';
import { isPrintableKeySequence, removeLastCodePoint } from './printable-key.js';

describe('isPrintableKeySequence', () => {
  test.each([
    ['ASCII printable', 'a'],
    ['space', ' '],
    ['CJK', '中'],
    ['diacritic', 'ă'],
    ['emoji', '😀'],
  ])('accepts %s input', (_label, sequence) => {
    expect(isPrintableKeySequence(sequence)).toBe(true);
  });

  test.each([
    ['empty', ''],
    ['undefined', undefined],
    ['control character', '\x03'],
    ['escape', '\x1b'],
    ['delete', '\x7f'],
    ['control sequence', '\x1b[A'],
    ['multiple CJK characters', '中文'],
  ])('rejects %s input', (_label, sequence) => {
    expect(isPrintableKeySequence(sequence)).toBe(false);
  });
});

describe('removeLastCodePoint', () => {
  test.each([
    ['empty string', '', ''],
    ['ASCII characters', 'ab', 'a'],
    ['CJK characters', '中文', '中'],
    ['ASCII followed by emoji', 'a😀', 'a'],
    ['emoji', '😀', ''],
  ])('removes the last code point from %s input', (_label, value, expected) => {
    const result = removeLastCodePoint(value);
    expect(result).toBe(expected);
    expect(Array.from(result).join('')).toBe(result);
  });

  test('does not leave a lone surrogate after removing emoji', () => {
    const result = removeLastCodePoint('a😀');
    expect(result.length).toBe(1);
    expect(result.charCodeAt(0)).toBe('a'.charCodeAt(0));
  });
});
