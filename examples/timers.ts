/**
 * ABOUTME: Timer utilities for testing ralph-tui.
 * Provides functions for delays, debouncing, and throttling.
 */

/**
 * Returns a Promise that resolves after the specified number of milliseconds.
 * @param ms - The number of milliseconds to wait
 * @returns A Promise that resolves after the delay
 * @example
 * await sleep(1000) // waits 1 second
 * sleep(500).then(() => console.log('Done!'))
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a debounced version of a function that delays execution until after
 * the specified wait time has elapsed since the last call.
 * @param fn - The function to debounce
 * @param ms - The number of milliseconds to wait before calling the function
 * @returns A debounced version of the function
 * @example
 * const debouncedSearch = debounce((query: string) => search(query), 300)
 * debouncedSearch('hello') // only executes after 300ms of no calls
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return (...args: Parameters<T>): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, ms);
  };
}

/**
 * Creates a throttled version of a function that only executes at most once
 * per specified time period.
 * @param fn - The function to throttle
 * @param ms - The minimum number of milliseconds between function calls
 * @returns A throttled version of the function
 * @example
 * const throttledScroll = throttle(() => updatePosition(), 100)
 * window.addEventListener('scroll', throttledScroll) // executes at most every 100ms
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;

  return (...args: Parameters<T>): void => {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    }
  };
}
