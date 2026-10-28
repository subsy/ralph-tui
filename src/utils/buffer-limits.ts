/**
 * ABOUTME: Shared helpers for bounded in-memory text buffers.
 * Used by streaming components to cap memory growth while preserving recent output.
 */

/**
 * Append text to a buffer while enforcing a maximum size.
 * Keeps the most recent content (tail) and prepends a truncation prefix when needed.
 */
export function appendWithCharLimit(
  current: string,
  chunk: string,
  maxChars: number,
  prefix = '[...truncated in memory...]\n',
): string {
  if (!chunk) return current;
  if (maxChars <= 0) return '';

  const totalLen = current.length + chunk.length;
  if (totalLen <= maxChars) {
    return current + chunk;
  }

  if (maxChars <= prefix.length) {
    return prefix.slice(0, maxChars);
  }

  const keep = maxChars - prefix.length;
  const combinedTailStart = totalLen - keep;

  let tail: string;
  if (combinedTailStart >= current.length) {
    const startInChunk = combinedTailStart - current.length;
    tail = chunk.slice(startInChunk);
  } else {
    const tailFromCurrent = current.slice(combinedTailStart);
    const remaining = keep - tailFromCurrent.length;
    const tailFromChunk = remaining > 0 ? chunk.slice(-remaining) : '';
    tail = tailFromCurrent + tailFromChunk;
  }

  return prefix + tail;
}
