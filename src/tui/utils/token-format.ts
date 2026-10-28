/**
 * ABOUTME: Shared token count formatting helpers for compact TUI displays.
 * Provides a single compact formatter used by dashboard and task list components.
 */

/**
 * Format token counts in a compact form for constrained layouts.
 * Examples: 950 -> "950", 1250 -> "1.3k", 1250000 -> "1.3m"
 */
export function formatTokenCount(tokens: number): string {
  const value = Number(tokens);
  const safeTokens = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  if (safeTokens >= 1_000_000) {
    return `${(safeTokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (safeTokens >= 1_000) {
    return `${(safeTokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(safeTokens);
}
