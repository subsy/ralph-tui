// src/tui/utils/marker-edit.ts
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

  if (onImageMarkerDeleted) {
    const markers = findMarkersOverlappingRange(text, a, b);
    if (markers.length > 0) {
      const sorted = [...markers].sort((m1, m2) => m2.start - m1.start);

      let newText = text;
      for (const m of sorted) {
        newText = newText.slice(0, m.start) + newText.slice(m.end);
      }

      editBuffer.setText(newText);
      editBuffer.setCursorByOffset(Math.min(...markers.map((m) => m.start)));

      for (const m of markers) onImageMarkerDeleted(m.imageNumber);
      return;
    }
  }

  editBuffer.setText(text.slice(0, a) + text.slice(b));
  editBuffer.setCursorByOffset(a);
}
