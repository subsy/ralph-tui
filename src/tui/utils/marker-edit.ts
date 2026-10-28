/**
 * ABOUTME: Marker-edit utilities for atomic [Image N] marker handling in textareas.
 * Provides marker lookup, overlap detection, and safe range deletion behavior for chat input.
 */
import type { TextareaRenderable } from '@opentui/core';

export type MarkerInfo = { start: number; end: number; imageNumber: number };

export function findMarkerAtCursor(
  text: string,
  cursorOffset: number,
): MarkerInfo | null {
  const markerPattern = /\[Image (\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const imageNumber = parseInt(match[1], 10);

    // inside or adjacent
    if (cursorOffset > start && cursorOffset <= end)
      return { start, end, imageNumber };
    if (cursorOffset === start) return { start, end, imageNumber };
  }

  return null;
}

export function findMarkersOverlappingRange(
  text: string,
  a: number,
  b: number,
): MarkerInfo[] {
  const startRange = Math.min(a, b);
  const endRange = Math.max(a, b);

  const markerPattern = /\[Image (\d+)\]/g;
  const markers: MarkerInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const overlaps = start < endRange && end > startRange;
    if (overlaps)
      markers.push({ start, end, imageNumber: parseInt(match[1], 10) });
  }

  return markers;
}

export function wordBoundaryBackward(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

export function wordBoundaryForward(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

export function deleteRangeSafely(args: {
  textarea: TextareaRenderable;
  start: number;
  end: number;
  onImageMarkerDeleted?: (imageNumber: number) => void;
}): void {
  const { textarea, start, end, onImageMarkerDeleted } = args;
  const editBuffer = textarea.editBuffer;
  const text = textarea.plainText;

  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));
  if (a === b) return;

  const markers = findMarkersOverlappingRange(text, a, b);
  const rangesToRemove: Array<{ start: number; end: number }> = [
    { start: a, end: b },
    ...markers.map((marker) => ({ start: marker.start, end: marker.end })),
  ];

  rangesToRemove.sort((r1, r2) => r1.start - r2.start);

  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of rangesToRemove) {
    const last = mergedRanges[mergedRanges.length - 1];
    if (!last || range.start > last.end) {
      mergedRanges.push({ start: range.start, end: range.end });
      continue;
    }

    last.end = Math.max(last.end, range.end);
  }

  let newText = '';
  let lastEnd = 0;
  for (const range of mergedRanges) {
    newText += text.slice(lastEnd, range.start);
    lastEnd = range.end;
  }
  newText += text.slice(lastEnd);

  const nextCursorOffset =
    markers.length > 0 ? Math.min(a, ...markers.map((marker) => marker.start)) : a;

  editBuffer.setText(newText);
  editBuffer.setCursorByOffset(Math.min(nextCursorOffset, newText.length));

  if (onImageMarkerDeleted) {
    for (const marker of markers) {
      onImageMarkerDeleted(marker.imageNumber);
    }
  }
}
