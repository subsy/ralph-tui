/**
 * ABOUTME: React hook for managing inline image indicators in text input.
 * Handles atomic [Image N] placeholders that can't be partially deleted.
 * Works in conjunction with useImageAttachment to provide inline visual feedback.
 */

import { useState, useCallback, useRef } from 'react';
import type { AttachedImage } from './useImageAttachment.js';

/**
 * Special Unicode markers used internally to mark indicator boundaries.
 * These are Zero-Width characters that are invisible but trackable.
 */
const INDICATOR_START = '\u200B'; // Zero Width Space - marks start of indicator
const INDICATOR_END = '\u200C'; // Zero Width Non-Joiner - marks end of indicator

/**
 * Pattern to match an image indicator in text.
 * Format: [START][Image N][END]
 * The markers are invisible but allow us to detect indicator boundaries.
 */
const INDICATOR_PATTERN = new RegExp(
  `${INDICATOR_START}\\[Image (\\d+)\\]${INDICATOR_END}`,
  'g',
);

/**
 * Maps an image ID to its indicator number for consistent display.
 */
export interface ImageIndicatorMap {
  [imageId: string]: number;
}

/**
 * Result of processing text with indicators.
 */
export interface ProcessedText {
  /** Text with marker characters included (for internal tracking) */
  rawText: string;
  /** Text with indicators shown (for display) */
  displayText: string;
  /** Text with indicators removed (clean text for submission) */
  cleanText: string;
}

/**
 * Return type for the useInlineImageIndicators hook.
 */
export interface UseInlineImageIndicatorsReturn {
  /**
   * Insert an image indicator at the specified cursor position.
   * @param text - Current text content
   * @param cursorPosition - Position to insert at
   * @param imageId - ID of the attached image
   * @returns New text with indicator inserted and new cursor position
   */
  insertIndicator: (
    text: string,
    cursorPosition: number,
    imageId: string,
  ) => { text: string; cursorPosition: number };

  /**
   * Create an indicator text string (with zero-width markers) for an image.
   * Also registers the image ID in the indicator map for later lookup.
   * Use this when you need to insert the indicator via another mechanism
   * (e.g., textarea.insertText).
   * @param imageId - ID of the attached image
   * @returns The indicator string including zero-width boundary markers
   */
  createIndicatorText: (imageId: string) => string;

  /**
   * Handle backspace key, removing entire indicator if cursor is adjacent to one.
   * @param text - Current text content
   * @param cursorPosition - Current cursor position
   * @returns Object with new text, cursor position, and removed image ID (if any)
   */
  handleBackspace: (
    text: string,
    cursorPosition: number,
  ) => { text: string; cursorPosition: number; removedImageId: string | null };

  /**
   * Handle delete key, removing entire indicator if cursor is adjacent to one.
   * @param text - Current text content
   * @param cursorPosition - Current cursor position
   * @returns Object with new text, cursor position, and removed image ID (if any)
   */
  handleDelete: (
    text: string,
    cursorPosition: number,
  ) => { text: string; cursorPosition: number; removedImageId: string | null };

  /**
   * Get clean text (without indicators) for submission.
   * @param text - Text with indicators
   * @returns Clean text without indicators
   */
  getCleanText: (text: string) => string;

  /**
   * Get display text with styled indicators.
   * @param text - Text with markers
   * @returns Text formatted for display
   */
  getDisplayText: (text: string) => string;

  /**
   * Remove all indicators for images that are no longer attached.
   * @param text - Current text content
   * @param attachedImages - Currently attached images
   * @returns Cleaned text with orphaned indicators removed
   */
  removeOrphanedIndicators: (
    text: string,
    attachedImages: AttachedImage[],
  ) => string;

  /**
   * Renumber indicators to be sequential based on current attachments.
   * @param text - Current text content
   * @param attachedImages - Currently attached images (in order)
   * @returns Text with indicators renumbered sequentially
   */
  renumberIndicators: (text: string, attachedImages: AttachedImage[]) => string;

  /**
   * Map of image IDs to their indicator numbers.
   */
  indicatorMap: ImageIndicatorMap;

  /**
   * Get the indicator number for a given image ID.
   * Creates a new number if this is a new image.
   */
  getIndicatorNumber: (imageId: string) => number;
}

/**
 * React hook for managing inline image indicators.
 *
 * Provides utilities to:
 * - Insert [Image N] placeholders at cursor positions
 * - Handle atomic deletion (backspace/delete removes entire indicator)
 * - Maintain indicator numbering consistency
 * - Extract clean text for submission
 *
 * @example
 * ```tsx
 * function TextInput() {
 *   const { insertIndicator, handleBackspace, getCleanText } = useInlineImageIndicators();
 *   const [text, setText] = useState('');
 *   const [cursor, setCursor] = useState(0);
 *
 *   const onImageAttached = (imageId: string) => {
 *     const result = insertIndicator(text, cursor, imageId);
 *     setText(result.text);
 *     setCursor(result.cursorPosition);
 *   };
 *
 *   const onBackspace = () => {
 *     const result = handleBackspace(text, cursor);
 *     setText(result.text);
 *     setCursor(result.cursorPosition);
 *     if (result.removedImageId) {
 *       // Remove the image from attachments
 *     }
 *   };
 *
 *   const onSubmit = () => {
 *     const cleanText = getCleanText(text);
 *     // Submit cleanText
 *   };
 * }
 * ```
 */
export function useInlineImageIndicators(): UseInlineImageIndicatorsReturn {
  // Track which image IDs map to which indicator numbers
  const [indicatorMap, setIndicatorMap] = useState<ImageIndicatorMap>({});
  // Counter for assigning new indicator numbers
  const [nextNumber, setNextNumber] = useState(1);

  // Use refs to avoid stale closure issues in callbacks
  const indicatorMapRef = useRef<ImageIndicatorMap>({});
  const nextNumberRef = useRef(1);

  // Keep refs in sync with state
  indicatorMapRef.current = indicatorMap;
  nextNumberRef.current = nextNumber;

  /**
   * Get or assign an indicator number for an image ID.
   */
  const getIndicatorNumber = useCallback(
    (imageId: string): number => {
      // Safety check - imageId should never be empty
      if (!imageId) {
        return 1;
      }

      // Use refs to get the latest values (avoid stale closure)
      const currentMap = indicatorMapRef.current;
      const currentNextNumber = nextNumberRef.current;

      if (currentMap[imageId] !== undefined) {
        return currentMap[imageId];
      }

      // Assign next available number
      const number = currentNextNumber;
      const nextMap = { ...currentMap, [imageId]: number };
      const nextNumber = number + 1;

      // Update refs immediately to avoid duplicate assignments on rapid calls.
      indicatorMapRef.current = nextMap;
      nextNumberRef.current = nextNumber;

      // Mirror refs in state for rendering.
      setIndicatorMap(nextMap);
      setNextNumber(nextNumber);
      return number;
    },
    [], // No dependencies needed since we use refs
  );

  /**
   * Insert an image indicator at the cursor position.
   */
  const insertIndicator = useCallback(
    (
      text: string,
      cursorPosition: number,
      imageId: string,
    ): { text: string; cursorPosition: number } => {
      const number = getIndicatorNumber(imageId);
      const indicator = `${INDICATOR_START}[Image ${number}]${INDICATOR_END}`;

      // Insert at cursor position
      const before = text.slice(0, cursorPosition);
      const after = text.slice(cursorPosition);
      const newText = before + indicator + after;

      // Move cursor past the indicator
      const newCursorPosition = cursorPosition + indicator.length;

      return { text: newText, cursorPosition: newCursorPosition };
    },
    [getIndicatorNumber],
  );

  /**
   * Create an indicator text string (with zero-width markers) for an image.
   * Also registers the image ID in the indicator map for later lookup.
   */
  const createIndicatorText = useCallback(
    (imageId: string): string => {
      const number = getIndicatorNumber(imageId);
      return `${INDICATOR_START}[Image ${number ?? 1}]${INDICATOR_END}`;
    },
    [getIndicatorNumber],
  );

  /**
   * Find the indicator boundaries around a given position.
   * Returns null if no indicator at position, or { start, end, imageNumber } if found.
   */
  const findIndicatorAtPosition = useCallback(
    (
      text: string,
      position: number,
    ): { start: number; end: number; imageNumber: number } | null => {
      // Find all indicators and check if position is within or adjacent to one
      const matches: Array<{ start: number; end: number; number: number }> = [];
      let match;

      INDICATOR_PATTERN.lastIndex = 0;
      while ((match = INDICATOR_PATTERN.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          number: parseInt(match[1], 10),
        });
      }

      // Check if position is inside or immediately after any indicator
      for (const m of matches) {
        if (position > m.start && position <= m.end) {
          return { start: m.start, end: m.end, imageNumber: m.number };
        }
      }

      return null;
    },
    [],
  );

  /**
   * Find image ID by indicator number.
   */
  const findImageIdByNumber = useCallback(
    (number: number): string | null => {
      for (const [imageId, num] of Object.entries(indicatorMap)) {
        if (num === number) {
          return imageId;
        }
      }
      return null;
    },
    [indicatorMap],
  );

  /**
   * Handle backspace, atomically deleting indicators.
   */
  const handleBackspace = useCallback(
    (
      text: string,
      cursorPosition: number,
    ): {
      text: string;
      cursorPosition: number;
      removedImageId: string | null;
    } => {
      if (cursorPosition === 0) {
        return { text, cursorPosition, removedImageId: null };
      }

      // Check if we're at the end of an indicator
      const indicator = findIndicatorAtPosition(text, cursorPosition);

      if (indicator) {
        // Remove the entire indicator
        const newText =
          text.slice(0, indicator.start) + text.slice(indicator.end);
        const imageId = findImageIdByNumber(indicator.imageNumber);

        return {
          text: newText,
          cursorPosition: indicator.start,
          removedImageId: imageId,
        };
      }

      // Normal backspace behavior - just signal no removal, let caller handle normal delete
      return { text, cursorPosition, removedImageId: null };
    },
    [findIndicatorAtPosition, findImageIdByNumber],
  );

  /**
   * Handle delete key, atomically deleting indicators.
   */
  const handleDelete = useCallback(
    (
      text: string,
      cursorPosition: number,
    ): {
      text: string;
      cursorPosition: number;
      removedImageId: string | null;
    } => {
      if (cursorPosition >= text.length) {
        return { text, cursorPosition, removedImageId: null };
      }

      // Check if we're at the start of an indicator (cursor right before it)
      // Need to check position + 1 since we want to see if the next char starts an indicator
      const nextChar = text[cursorPosition];
      if (nextChar === INDICATOR_START) {
        const indicator = findIndicatorAtPosition(text, cursorPosition + 1);

        if (indicator && indicator.start === cursorPosition) {
          // Remove the entire indicator
          const newText =
            text.slice(0, indicator.start) + text.slice(indicator.end);
          const imageId = findImageIdByNumber(indicator.imageNumber);

          return {
            text: newText,
            cursorPosition: cursorPosition,
            removedImageId: imageId,
          };
        }
      }

      // Normal delete behavior
      return { text, cursorPosition, removedImageId: null };
    },
    [findIndicatorAtPosition, findImageIdByNumber],
  );

  /**
   * Get clean text without any indicators.
   */
  const getCleanText = useCallback((text: string): string => {
    // Remove all indicators (including markers)
    return text.replace(INDICATOR_PATTERN, '');
  }, []);

  /**
   * Get display text - just return as-is since markers are invisible.
   * The [Image N] parts will be visible.
   */
  const getDisplayText = useCallback((text: string): string => {
    // The markers are zero-width and invisible, so text displays correctly
    return text;
  }, []);

  /**
   * Remove indicators for images that are no longer attached.
   */
  const removeOrphanedIndicators = useCallback(
    (text: string, attachedImages: AttachedImage[]): string => {
      const attachedIds = new Set(attachedImages.map((img) => img.id));
      let result = text;

      // Find all indicators and remove those whose images are gone
      const indicatorsToRemove: number[] = [];
      for (const [imageId, number] of Object.entries(indicatorMap)) {
        if (!attachedIds.has(imageId)) {
          indicatorsToRemove.push(number);
        }
      }

      // Remove the orphaned indicators from text
      for (const number of indicatorsToRemove) {
        const pattern = new RegExp(
          `${INDICATOR_START}\\[Image ${number}\\]${INDICATOR_END}`,
          'g',
        );
        result = result.replace(pattern, '');
      }

      return result;
    },
    [indicatorMap],
  );

  /**
   * Renumber indicators sequentially based on attachment order.
   */
  const renumberIndicators = useCallback(
    (text: string, attachedImages: AttachedImage[]): string => {
      // Build new mapping based on attachment order
      const newMap: ImageIndicatorMap = {};
      attachedImages.forEach((img, idx) => {
        newMap[img.id] = idx + 1;
      });

      // Build reverse lookup from existing numbers to image IDs.
      const numberToImageId = new Map<number, string>();
      for (const [imageId, number] of Object.entries(indicatorMapRef.current)) {
        numberToImageId.set(number, imageId);
      }

      // Renumber in a single pass to avoid replacement collisions (e.g., swapping 1 <-> 2).
      const result = text.replace(
        INDICATOR_PATTERN,
        (_fullMatch: string, oldNumberText: string) => {
          const oldNumber = parseInt(oldNumberText, 10);
          const imageId = numberToImageId.get(oldNumber);
          if (!imageId) {
            return `${INDICATOR_START}[Image ${oldNumber}]${INDICATOR_END}`;
          }

          const newNumber = newMap[imageId];
          if (newNumber === undefined) {
            return `${INDICATOR_START}[Image ${oldNumber}]${INDICATOR_END}`;
          }

          return `${INDICATOR_START}[Image ${newNumber}]${INDICATOR_END}`;
        },
      );

      // Update the indicator map
      const nextNumberValue = attachedImages.length + 1;
      indicatorMapRef.current = newMap;
      nextNumberRef.current = nextNumberValue;
      setIndicatorMap(newMap);
      setNextNumber(nextNumberValue);

      return result;
    },
    [],
  );

  return {
    insertIndicator,
    createIndicatorText,
    handleBackspace,
    handleDelete,
    getCleanText,
    getDisplayText,
    removeOrphanedIndicators,
    renumberIndicators,
    indicatorMap,
    getIndicatorNumber,
  };
}

/**
 * Helper to check if a character position is within an indicator.
 * Useful for cursor movement restrictions.
 */
export function isWithinIndicator(text: string, position: number): boolean {
  INDICATOR_PATTERN.lastIndex = 0;
  let match;
  while ((match = INDICATOR_PATTERN.exec(text)) !== null) {
    if (position > match.index && position < match.index + match[0].length) {
      return true;
    }
  }
  return false;
}

/**
 * Constants exported for testing and external use.
 */
export const MARKERS = {
  START: INDICATOR_START,
  END: INDICATOR_END,
} as const;
