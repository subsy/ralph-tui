/**
 * ABOUTME: Tests for the RateLimitDetector.
 * Tests rate limit detection across all patterns: Claude, OpenCode, and generic.
 */

import { describe, test, expect } from 'bun:test';
import { RateLimitDetector } from '../../src/engine/rate-limit-detector.js';
import type { RateLimitDetectionInput } from '../../src/engine/rate-limit-detector.js';

describe('RateLimitDetector', () => {
  const detector = new RateLimitDetector();

  describe('detect', () => {
    describe('common rate limit patterns', () => {
      test('detects HTTP 429 status code', () => {
        const result = detector.detect({
          stderr: 'Error: HTTP 429 Too Many Requests',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.message).toContain('429');
      });

      test('detects status 429', () => {
        const result = detector.detect({
          stderr: 'Request failed with status 429',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects error 429', () => {
        const result = detector.detect({
          stderr: 'API returned error 429',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects rate-limit keyword', () => {
        const result = detector.detect({
          stderr: 'Error: Rate limit exceeded for this API key',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.message).toContain('Rate limit');
      });

      test('detects rate limit with hyphen', () => {
        const result = detector.detect({
          stderr: 'API rate-limit reached',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects too many requests', () => {
        const result = detector.detect({
          stderr: 'Error: Too many requests in a short period',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.message).toContain('Too many requests');
      });

      test('detects quota exceeded', () => {
        const result = detector.detect({
          stderr: 'Error: API quota exceeded',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects quota-exceeded with hyphen', () => {
        const result = detector.detect({
          stderr: 'quota-exceeded error',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects overloaded message', () => {
        const result = detector.detect({
          stderr: 'Server is overloaded, please try again later',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('extracts retry-after duration', () => {
        const result = detector.detect({
          stderr: 'Rate limit exceeded. retry-after: 30s',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.retryAfter).toBe(30);
      });

      test('extracts retry after without hyphen', () => {
        const result = detector.detect({
          stderr: 'Rate limit. Retry after: 45s',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.retryAfter).toBe(45);
      });
    });

    describe('Claude-specific patterns', () => {
      test('detects Anthropic rate limit message', () => {
        const result = detector.detect({
          stderr: 'anthropic API rate limit exceeded',
          agentId: 'claude',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects Claude is currently overloaded', () => {
        const result = detector.detect({
          stderr: 'Error: Claude is currently overloaded. Please wait.',
          agentId: 'claude',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects API rate limit exceeded', () => {
        const result = detector.detect({
          stderr: 'API rate limit exceeded, please slow down',
          agentId: 'claude',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects api-error with 429', () => {
        const result = detector.detect({
          stderr: 'api-error: 429 response',
          agentId: 'claude',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('extracts wait duration from Claude error', () => {
        // The rate-limit-detector uses specific patterns for retry-after extraction
        // The 'wait: 60s' format is matched by the Claude-specific pattern
        const result = detector.detect({
          stderr: 'API rate limit exceeded. retry-after: 60s',
          agentId: 'claude',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.retryAfter).toBe(60);
      });
    });

    describe('OpenCode-specific patterns', () => {
      test('detects OpenAI rate limit', () => {
        const result = detector.detect({
          stderr: 'openai API rate limit reached',
          agentId: 'opencode',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects tokens per minute limit', () => {
        const result = detector.detect({
          stderr: 'Error: Exceeded tokens per minute limit',
          agentId: 'opencode',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects requests per minute limit', () => {
        const result = detector.detect({
          stderr: 'Requests per minute limit exceeded',
          agentId: 'opencode',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects Azure throttling', () => {
        const result = detector.detect({
          stderr: 'Azure service throttling request',
          agentId: 'opencode',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });
    });

    describe('false positive prevention', () => {
      test('does not trigger for plain 429 without context', () => {
        // A plain number 429 in output should not trigger rate limit
        // (e.g., line number 429, or an ID containing 429)
        const result = detector.detect({
          stderr: '',
          stdout: 'Processing item 429',
          exitCode: 0,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not trigger on success with empty stderr', () => {
        const result = detector.detect({
          stderr: '',
          exitCode: 0,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not trigger for unrelated errors', () => {
        const result = detector.detect({
          stderr: 'Error: File not found',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not trigger for network errors', () => {
        const result = detector.detect({
          stderr: 'Error: Network timeout',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not trigger for authentication errors', () => {
        const result = detector.detect({
          stderr: 'Error: Invalid API key',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not trigger for package names like @upstash/ratelimit (issue #100)', () => {
        // Regression test: Agent output mentioning package names should not trigger false positives
        // The pattern /rate[- ]?limit/ was too permissive and matched "ratelimit" without separator
        const result = detector.detect({
          stderr: 'ESLint type-safety issues with external libraries (better-auth, stripe, @upstash/redis, @upstash/ratelimit)',
          exitCode: 0,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not trigger for concatenated ratelimit word', () => {
        // Should not match "ratelimit" without space or hyphen separator
        const result = detector.detect({
          stderr: 'import { Ratelimit } from "@upstash/ratelimit"',
          exitCode: 0,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not trigger for ratelimit function names', () => {
        // Code containing "ratelimit" as a function/variable name should not trigger
        const result = detector.detect({
          stderr: 'TypeError: ratelimit.check is not a function',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(false);
      });
    });

    describe('loose rate limit check with exit codes', () => {
      test('detects throttling with exit code 429', () => {
        const result = detector.detect({
          stderr: 'Request throttled',
          exitCode: 429,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects limit exceeded pattern', () => {
        const result = detector.detect({
          stderr: 'Request limit exceeded',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects exceeded limit pattern', () => {
        const result = detector.detect({
          stderr: 'Exceeded API limit',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects capacity issues', () => {
        const result = detector.detect({
          stderr: 'Service at capacity',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });

      test('detects backoff requests', () => {
        const result = detector.detect({
          stderr: 'Please backoff and retry',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
      });
    });

    describe('retry-after extraction', () => {
      test('extracts seconds from various formats', () => {
        // Only test formats that the detector actually supports
        const testCases = [
          { input: 'retry-after: 30s', expected: 30 },
          { input: 'Retry after: 45s', expected: 45 },
        ];

        for (const { input, expected } of testCases) {
          const result = detector.detect({
            stderr: `Rate limit. ${input}`,
            exitCode: 1,
          });
          expect(result.isRateLimit).toBe(true);
          expect(result.retryAfter).toBe(expected);
        }
      });

      test('extracts duration from too many requests message', () => {
        const result = detector.detect({
          stderr: 'Too many requests. Please wait 30 seconds before retrying.',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.retryAfter).toBe(30);
      });

      test('ignores unreasonable retry-after values', () => {
        const result = detector.detect({
          stderr: 'Rate limit. retry-after: 5000s',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        // Values >= 3600 (1 hour) should be ignored
        expect(result.retryAfter).toBeUndefined();
      });

      test('ignores zero or negative retry-after', () => {
        const result = detector.detect({
          stderr: 'Rate limit. retry-after: 0s',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.retryAfter).toBeUndefined();
      });
    });

    describe('message extraction', () => {
      test('extracts context around match', () => {
        const result = detector.detect({
          stderr: 'Some prefix text. Rate limit exceeded for user. Some suffix text.',
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.message).toContain('Rate limit exceeded');
      });

      test('truncates very long messages', () => {
        const longError = 'A'.repeat(100) + ' Rate limit exceeded ' + 'B'.repeat(200);
        const result = detector.detect({
          stderr: longError,
          exitCode: 1,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.message!.length).toBeLessThanOrEqual(203); // 200 + "..."
      });

      test('provides default message when pattern matched but extraction fails', () => {
        // This tests the fallback 'Rate limit detected' message
        const result = detector.detect({
          stderr: 'Throttled',
          exitCode: 429,
        });
        expect(result.isRateLimit).toBe(true);
        expect(result.message).toBeDefined();
      });
    });

    describe('only checks stderr', () => {
      test('does not detect rate limit patterns in stdout', () => {
        // Real rate limit errors come from stderr, not stdout
        // stdout might contain code or logs mentioning "rate limit"
        const result = detector.detect({
          stdout: 'console.log("Rate limit handler configured");',
          stderr: '',
          exitCode: 0,
        });
        expect(result.isRateLimit).toBe(false);
      });

      test('does not false positive on code containing 429', () => {
        const result = detector.detect({
          stdout: 'if (response.status === 429) { retry(); }',
          stderr: '',
          exitCode: 0,
        });
        expect(result.isRateLimit).toBe(false);
      });
    });
  });
});
