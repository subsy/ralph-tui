/**
 * ABOUTME: Semantic version comparison utility.
 * Provides numeric semver comparison used by config migration and runtime version checks.
 */

/**
 * Compare two semver-like version strings numerically.
 * Compares each segment as integers (e.g., "2.10" > "2.9").
 * Missing segments are treated as 0.
 *
 * @param a First version string
 * @param b Second version string
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareSemverStrings(a: string, b: string): -1 | 0 | 1 {
  // Strip leading "v" prefix, then pre-release/build metadata (e.g., "v2.0-beta" -> "2.0")
  const cleanA = a.replace(/^v/i, '').split(/[-+]/)[0];
  const cleanB = b.replace(/^v/i, '').split(/[-+]/)[0];

  const partsA = cleanA.split('.').map((s) => parseInt(s, 10) || 0);
  const partsB = cleanB.split('.').map((s) => parseInt(s, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}
