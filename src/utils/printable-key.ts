// ABOUTME: Identifies single printable Unicode code points from keyboard input.
// ABOUTME: Excludes control characters, C1 controls, and multi-code-point sequences.

export function isPrintableKeySequence(sequence: string | undefined): boolean {
  if (sequence === undefined) {
    return false;
  }

  const codePoints = Array.from(sequence);
  if (codePoints.length !== 1) {
    return false;
  }

  const codePoint = codePoints[0]!.codePointAt(0)!;
  return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f);
}
