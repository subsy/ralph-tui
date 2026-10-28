/** ABOUTME: Deterministic tests for platform-aware Ctrl+C shortcut classification. */

import { describe, expect, test } from 'bun:test';
import { classifyCopyOrInterrupt } from '../../src/tui/utils/keyboard-shortcuts.js';

describe('classifyCopyOrInterrupt', () => {
  test('copies with Cmd+C on macOS when text is selected', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', meta: true },
        { platform: 'darwin', hasSelection: true }
      )
    ).toBe('copy');
  });

  test('interrupts with Ctrl+C on macOS', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', ctrl: true },
        { platform: 'darwin', hasSelection: false }
      )
    ).toBe('interrupt');
  });

  test('copies with Ctrl+C on Windows when text is selected', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', ctrl: true },
        { platform: 'win32', hasSelection: true }
      )
    ).toBe('copy');
  });

  test('interrupts with Ctrl+C on Windows without a selection', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', ctrl: true },
        { platform: 'win32', hasSelection: false }
      )
    ).toBe('interrupt');
  });

  test('copies with Ctrl+Shift+C on Linux when text is selected', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', ctrl: true, shift: true },
        { platform: 'linux', hasSelection: true }
      )
    ).toBe('copy');
  });

  test('copies with Alt+C on Linux when text is selected', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', option: true },
        { platform: 'linux', hasSelection: true }
      )
    ).toBe('copy');
  });

  test('interrupts with Ctrl+C on Linux without a selection', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', ctrl: true },
        { platform: 'linux', hasSelection: false }
      )
    ).toBe('interrupt');
  });

  test('interrupts with Ctrl+C on Linux even when text is selected', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', ctrl: true },
        { platform: 'linux', hasSelection: true }
      )
    ).toBe('interrupt');
  });

  test('does not copy Ctrl+Shift+C on Linux without a selection', () => {
    expect(
      classifyCopyOrInterrupt(
        { name: 'c', ctrl: true, shift: true },
        { platform: 'linux', hasSelection: false }
      )
    ).toBe('none');
  });

  test('ignores unrelated keys and plain c', () => {
    expect(classifyCopyOrInterrupt({ name: 'q' }, { platform: 'linux', hasSelection: true })).toBe(
      'none'
    );
    expect(classifyCopyOrInterrupt({ name: 'c' }, { platform: 'linux', hasSelection: true })).toBe(
      'none'
    );
  });
});
