/**
 * ABOUTME: React hook for handling paste events from OpenTUI's KeyHandler.
 * Provides a clean React interface for listening to terminal paste events,
 * with optional debouncing to prevent double-processing.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useRenderer } from '@opentui/react';
import type { PasteEvent } from '@opentui/core';

/**
 * Options for the usePaste hook.
 */
export interface UsePasteOptions {
  /**
   * Whether paste handling is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Debounce delay in milliseconds to prevent double-processing.
   * Set to 0 to disable debouncing.
   * @default 100
   */
  debounceMs?: number;
}

/**
 * React hook for handling paste events from the terminal.
 *
 * Uses OpenTUI's KeyHandler paste event to detect when text is pasted
 * into the terminal. Includes debouncing to prevent double-processing
 * that can occur with some terminal emulators.
 *
 * @param callback - Function called when text is pasted
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const handlePaste = useCallback(async (text: string) => {
 *     // Check if pasted text is an image path
 *     const result = await attachImage(text);
 *     if (!result.success) {
 *       // Not an image, let normal text handling occur
 *       insertText(text);
 *     }
 *   }, []);
 *
 *   usePaste(handlePaste, { debounceMs: 100 });
 *
 *   return <textarea focused />;
 * }
 * ```
 */
export function usePaste(
  callback: (text: string, event: PasteEvent) => void,
  options: UsePasteOptions = {},
): void {
  const { enabled = true, debounceMs = 100 } = options;

  const renderer = useRenderer();
  const lastPasteTimeRef = useRef<number>(0);
  const lastPasteTextRef = useRef<string>('');

  // Stable callback ref to avoid re-subscribing on every render
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const handlePaste = useCallback(
    (event: PasteEvent) => {
      if (!enabled) {
        return;
      }

      const now = Date.now();
      const text = event.text;

      // Debounce: ignore if same text was pasted within debounce window
      if (debounceMs > 0) {
        if (
          text === lastPasteTextRef.current &&
          now - lastPasteTimeRef.current < debounceMs
        ) {
          // Prevent default to stop the textarea from receiving duplicate paste
          event.preventDefault();
          return;
        }
      }

      // Update debounce tracking
      lastPasteTimeRef.current = now;
      lastPasteTextRef.current = text;

      // Call the user's callback
      callbackRef.current(text, event);
    },
    [enabled, debounceMs],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const keyHandler = renderer.keyInput;
    keyHandler.on('paste', handlePaste);

    return () => {
      keyHandler.off('paste', handlePaste);
    };
  }, [renderer, enabled, handlePaste]);
}
