/**
 * ABOUTME: Tests for configuration type defaults and constants.
 * Verifies default values are correctly defined.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CONFIG,
  DEFAULT_ERROR_HANDLING,
  DEFAULT_RATE_LIMIT_HANDLING,
  DEFAULT_SANDBOX_CONFIG,
} from './types.js';

describe('DEFAULT_ERROR_HANDLING', () => {
  test('has expected default values', () => {
    expect(DEFAULT_ERROR_HANDLING.strategy).toBe('skip');
    expect(DEFAULT_ERROR_HANDLING.maxRetries).toBe(3);
    expect(DEFAULT_ERROR_HANDLING.retryDelayMs).toBe(5000);
    expect(DEFAULT_ERROR_HANDLING.continueOnNonZeroExit).toBe(false);
  });
});

describe('DEFAULT_RATE_LIMIT_HANDLING', () => {
  test('has expected default values', () => {
    expect(DEFAULT_RATE_LIMIT_HANDLING.enabled).toBe(true);
    expect(DEFAULT_RATE_LIMIT_HANDLING.maxRetries).toBe(3);
    expect(DEFAULT_RATE_LIMIT_HANDLING.baseBackoffMs).toBe(5000);
    expect(DEFAULT_RATE_LIMIT_HANDLING.recoverPrimaryBetweenIterations).toBe(true);
  });
});

describe('DEFAULT_SANDBOX_CONFIG', () => {
  test('has expected default values', () => {
    expect(DEFAULT_SANDBOX_CONFIG.enabled).toBe(false);
    expect(DEFAULT_SANDBOX_CONFIG.mode).toBe('auto');
    expect(DEFAULT_SANDBOX_CONFIG.network).toBe(true);
  });
});

describe('DEFAULT_CONFIG', () => {
  test('has expected iteration defaults', () => {
    expect(DEFAULT_CONFIG.maxIterations).toBe(10);
    expect(DEFAULT_CONFIG.iterationDelay).toBe(1000);
  });

  test('has expected file paths', () => {
    expect(DEFAULT_CONFIG.outputDir).toBe('.ralph-tui/iterations');
    expect(DEFAULT_CONFIG.progressFile).toBe('.ralph-tui/progress.md');
  });

  test('shows TUI by default', () => {
    expect(DEFAULT_CONFIG.showTui).toBe(true);
  });

  test('includes error handling defaults', () => {
    expect(DEFAULT_CONFIG.errorHandling).toEqual(DEFAULT_ERROR_HANDLING);
  });

  test('includes sandbox defaults', () => {
    expect(DEFAULT_CONFIG.sandbox).toEqual(DEFAULT_SANDBOX_CONFIG);
  });
});
