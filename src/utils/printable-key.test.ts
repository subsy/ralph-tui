// ABOUTME: Tests Unicode printable keyboard sequence classification.
// ABOUTME: Covers printable code points, controls, and multi-code-point input.

import { describe, expect, test } from 'bun:test';
import { isPrintableKeySequence } from './printable-key.js';

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
