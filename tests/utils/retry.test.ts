/**
 * ABOUTME: Tests for retry utility functions.
 * Tests retry logic with exponential backoff and configurable strategies.
 */

import { describe, test, expect } from 'bun:test';
import {
  calculateBackoff,
  sleep,
  retry,
  withRetry,
  retryUntil,
  isTransientError,
} from '../../src/utils/retry.js';

describe('retry utility', () => {
  describe('calculateBackoff', () => {
    test('returns initial delay for first attempt with exponential backoff', () => {
      const delay = calculateBackoff(1, { initialDelay: 1000, jitter: 0 });
      expect(delay).toBe(1000);
    });

    test('applies exponential multiplier', () => {
      const delay1 = calculateBackoff(1, {
        initialDelay: 1000,
        multiplier: 2,
        jitter: 0,
      });
      const delay2 = calculateBackoff(2, {
        initialDelay: 1000,
        multiplier: 2,
        jitter: 0,
      });
      const delay3 = calculateBackoff(3, {
        initialDelay: 1000,
        multiplier: 2,
        jitter: 0,
      });

      expect(delay1).toBe(1000);
      expect(delay2).toBe(2000);
      expect(delay3).toBe(4000);
    });

    test('respects max delay', () => {
      const delay = calculateBackoff(10, {
        initialDelay: 1000,
        maxDelay: 5000,
        jitter: 0,
      });
      expect(delay).toBe(5000);
    });

    test('applies fixed backoff strategy', () => {
      const delay1 = calculateBackoff(1, {
        strategy: 'fixed',
        initialDelay: 1000,
        jitter: 0,
      });
      const delay2 = calculateBackoff(5, {
        strategy: 'fixed',
        initialDelay: 1000,
        jitter: 0,
      });
      expect(delay1).toBe(1000);
      expect(delay2).toBe(1000);
    });

    test('applies linear backoff strategy', () => {
      const delay1 = calculateBackoff(1, {
        strategy: 'linear',
        initialDelay: 1000,
        jitter: 0,
      });
      const delay2 = calculateBackoff(2, {
        strategy: 'linear',
        initialDelay: 1000,
        jitter: 0,
      });
      const delay3 = calculateBackoff(3, {
        strategy: 'linear',
        initialDelay: 1000,
        jitter: 0,
      });

      expect(delay1).toBe(1000);
      expect(delay2).toBe(2000);
      expect(delay3).toBe(3000);
    });

    test('applies jitter within expected range', () => {
      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        delays.push(calculateBackoff(1, { initialDelay: 1000, jitter: 0.1 }));
      }

      // All delays should be within 10% of 1000
      const min = Math.min(...delays);
      const max = Math.max(...delays);
      expect(min).toBeGreaterThanOrEqual(900);
      expect(max).toBeLessThanOrEqual(1100);

      // With 100 samples, we should see some variation
      const uniqueDelays = new Set(delays).size;
      expect(uniqueDelays).toBeGreaterThan(1);
    });

    test('returns non-negative delay', () => {
      const delay = calculateBackoff(1, { initialDelay: 0, jitter: 0.5 });
      expect(delay).toBeGreaterThanOrEqual(0);
    });
  });

  describe('sleep', () => {
    test('resolves after specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(150);
    });

    test('resolves immediately for 0ms', async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('retry', () => {
    test('returns success on first try if no error', async () => {
      let attempts = 0;
      const result = await retry(async () => {
        attempts++;
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
    });

    test('retries on failure and eventually succeeds', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        },
        { maxRetries: 5, initialDelay: 10 },
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(3);
    });

    test('returns failure after max retries', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          throw new Error('Persistent failure');
        },
        { maxRetries: 3, initialDelay: 10 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.attempts).toBe(4); // 1 initial + 3 retries
    });

    test('respects isRetryable function', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          throw new Error('Non-retryable error');
        },
        {
          maxRetries: 5,
          initialDelay: 10,
          isRetryable: () => false,
        },
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1); // No retries
    });

    test('calls onRetry callback', async () => {
      const retryCalls: Array<{ attempt: number; delay: number }> = [];
      let attempts = 0;

      await retry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Failure');
          }
          return 'success';
        },
        {
          maxRetries: 5,
          initialDelay: 10,
          jitter: 0,
          onRetry: (attempt, _error, delay) => {
            retryCalls.push({ attempt, delay });
          },
        },
      );

      expect(retryCalls.length).toBe(2);
      expect(retryCalls[0]!.attempt).toBe(1);
      expect(retryCalls[1]!.attempt).toBe(2);
    });

    test('tracks total time', async () => {
      const result = await retry(
        async () => {
          await sleep(20);
          return 'success';
        },
        { maxRetries: 0 },
      );

      expect(result.totalTime).toBeGreaterThanOrEqual(15);
    });
  });

  describe('withRetry', () => {
    test('wraps function with retry behavior', async () => {
      let attempts = 0;
      const fn = async (x: number) => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Failure');
        }
        return x * 2;
      };

      const retryableFn = withRetry(fn, { maxRetries: 3, initialDelay: 10 });
      const result = await retryableFn(5);

      expect(result.success).toBe(true);
      expect(result.value).toBe(10);
      expect(result.attempts).toBe(2);
    });
  });

  describe('retryUntil', () => {
    test('retries until condition is met', async () => {
      let counter = 0;
      const result = await retryUntil(
        async () => {
          counter++;
          return counter;
        },
        (value) => value >= 3,
        { maxRetries: 5, pollingInterval: 10 },
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe(3);
    });

    test('returns failure if condition never met', async () => {
      const result = await retryUntil(
        async () => 1,
        (value) => value > 10,
        { maxRetries: 2, pollingInterval: 10 },
      );

      expect(result.success).toBe(false);
      expect(result.value).toBe(1); // Last value is included
    });
  });

  describe('isTransientError', () => {
    test('returns true for timeout errors', () => {
      expect(isTransientError(new Error('Connection timeout'))).toBe(true);
      expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    });

    test('returns true for connection errors', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
      expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    });

    test('returns true for rate limit errors', () => {
      expect(isTransientError(new Error('Rate limit exceeded'))).toBe(true);
      expect(isTransientError(new Error('Too many requests'))).toBe(true);
      expect(isTransientError(new Error('Error 429'))).toBe(true);
    });

    test('returns true for service unavailable errors', () => {
      expect(isTransientError(new Error('503 Service unavailable'))).toBe(true);
      expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
    });

    test('returns false for non-transient errors', () => {
      expect(isTransientError(new Error('Invalid input'))).toBe(false);
      expect(isTransientError(new Error('Permission denied'))).toBe(false);
      expect(isTransientError(new Error('Not found'))).toBe(false);
    });

    test('returns false for non-Error objects', () => {
      expect(isTransientError('timeout')).toBe(false);
      expect(isTransientError({ message: 'timeout' })).toBe(false);
      expect(isTransientError(null)).toBe(false);
    });
  });
});
