/**
 * ABOUTME: Identifies single printable Unicode code points from keyboard input.
 * Excludes controls and supports code-point-safe editing operations.
 */

export function isPrintableKeySequence(sequence: string | undefined): boolean {
  if (sequence === undefined) {
    return false;
  }

  const codePoints = Array.from(sequence);
  if (codePoints.length !== 1) {
    return false;
  }

  const codePoint = codePoints[0]!.codePointAt(0)!;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
    return false;
  }

  return codePoint < 0xd800 || codePoint > 0xdfff;
}

export function removeLastCodePoint(value: string): string {
  const codePoints = Array.from(value);
  codePoints.pop();
  return codePoints.join('');
}
