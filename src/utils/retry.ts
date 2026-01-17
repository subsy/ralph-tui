/**
 * ABOUTME: Retry utility functions.
 * Provides retry logic with exponential backoff and configurable strategies.
 */

/**
 * Backoff strategy types
 */
export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Backoff strategy (default: 'exponential') */
  backoff?: BackoffStrategy;
  /** Multiplier for exponential backoff (default: 2) */
  multiplier?: number;
  /** Jitter factor (0-1) to randomize delays (default: 0.1) */
  jitter?: number;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: unknown, delay: number) => void;
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result value if successful */
  value?: T;
  /** Last error if failed */
  error?: unknown;
  /** Total number of attempts made */
  attempts: number;
  /** Total time spent in milliseconds */
  totalTime: number;
}

/**
 * Calculate backoff delay based on strategy
 */
export function calculateBackoff(
  attempt: number,
  options: {
    strategy?: BackoffStrategy;
    initialDelay?: number;
    maxDelay?: number;
    multiplier?: number;
    jitter?: number;
  } = {},
): number {
  const {
    strategy = 'exponential',
    initialDelay = 1000,
    maxDelay = 30000,
    multiplier = 2,
    jitter = 0.1,
  } = options;

  let delay: number;

  switch (strategy) {
    case 'fixed':
      delay = initialDelay;
      break;
    case 'linear':
      delay = initialDelay * attempt;
      break;
    case 'exponential':
    default:
      delay = initialDelay * Math.pow(multiplier, attempt - 1);
      break;
  }

  // Apply max delay cap
  delay = Math.min(delay, maxDelay);

  // Apply jitter
  if (jitter > 0) {
    const jitterAmount = delay * jitter;
    delay = delay + (Math.random() * 2 - 1) * jitterAmount;
  }

  return Math.floor(Math.max(0, delay));
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with configurable backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoff = 'exponential',
    multiplier = 2,
    jitter = 0.1,
    isRetryable = () => true,
    onRetry,
  } = options;

  let lastError: unknown;
  let attempts = 0;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    attempts = attempt;

    try {
      const value = await fn();
      return {
        success: true,
        value,
        attempts,
        totalTime: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt > maxRetries || !isRetryable(error)) {
        break;
      }

      // Calculate delay
      const delay = calculateBackoff(attempt, {
        strategy: backoff,
        initialDelay,
        maxDelay,
        multiplier,
        jitter,
      });

      // Call retry callback
      if (onRetry) {
        onRetry(attempt, error, delay);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts,
    totalTime: Date.now() - startTime,
  };
}

/**
 * Create a retryable version of a function
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: RetryOptions = {},
): (...args: Parameters<T>) => Promise<RetryResult<Awaited<ReturnType<T>>>> {
  return async (...args: Parameters<T>) => {
    return retry(() => fn(...args) as Promise<Awaited<ReturnType<T>>>, options);
  };
}

/**
 * Retry with a condition function
 */
export async function retryUntil<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  options: RetryOptions & { pollingInterval?: number } = {},
): Promise<RetryResult<T>> {
  const { pollingInterval = 1000, ...retryOptions } = options;

  let lastValue: T | undefined;

  const result = await retry(
    async () => {
      const value = await fn();
      lastValue = value;
      if (!condition(value)) {
        throw new Error('Condition not met');
      }
      return value;
    },
    {
      ...retryOptions,
      backoff: 'fixed',
      initialDelay: pollingInterval,
    },
  );

  // If failed but we have a last value, include it
  if (!result.success && lastValue !== undefined) {
    return {
      ...result,
      value: lastValue,
    };
  }

  return result;
}

/**
 * Check if an error is a transient/retryable error
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // Common transient error patterns
  const transientPatterns = [
    'timeout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'etimedout',
    'rate limit',
    'too many requests',
    '429',
    '503',
    '502',
    'service unavailable',
    'temporary',
  ];

  return transientPatterns.some((pattern) => message.includes(pattern));
}
