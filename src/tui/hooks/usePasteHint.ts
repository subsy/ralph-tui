/**
 * ABOUTME: React hook for showing a first-time paste hint to new users.
 * Shows a transient hint about image paste support on the first text paste
 * of a session. The hint auto-dismisses after 3 seconds or on any keypress.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import type { UseToastReturn } from './useToast.js';

/**
 * The paste hint message shown to users.
 */
const PASTE_HINT_MESSAGE =
  'Tip: You can paste images too (file paths or Ctrl+V with image copied)';

/**
 * Duration to show the hint before auto-dismissing (in milliseconds).
 */
const HINT_DURATION_MS = 3000;

/**
 * Options for the usePasteHint hook.
 */
export interface UsePasteHintOptions {
  /** Whether paste hints are enabled (default: true) */
  enabled?: boolean;
}

/**
 * Return type for the usePasteHint hook.
 */
export interface UsePasteHintReturn {
  /**
   * Call this when a text paste occurs that is NOT an image.
   * If this is the first text paste of the session and hints are enabled,
   * shows the hint toast.
   */
  onTextPaste: () => void;
  /** Whether the hint has already been shown this session */
  hasShownHint: boolean;
}

/**
 * React hook for showing a first-time paste hint.
 *
 * Shows a transient hint about image paste support when:
 * 1. User pastes text (not an image)
 * 2. It's the first text paste of the session
 * 3. Hints are enabled in config
 *
 * The hint auto-dismisses after 3 seconds or on any keypress.
 *
 * @param toast - Toast hook return value for showing the hint
 * @param options - Configuration options
 * @returns Object with onTextPaste callback and hint state
 *
 * @example
 * ```tsx
 * function ChatInput({ showPasteHints }: { showPasteHints: boolean }) {
 *   const toast = useToast();
 *   const { onTextPaste } = usePasteHint(toast, { enabled: showPasteHints });
 *
 *   const handlePaste = async (text: string, event: PasteEvent) => {
 *     const result = await attachImage(text);
 *     if (!result.success) {
 *       // Not an image - show hint on first text paste
 *       onTextPaste();
 *     }
 *   };
 * }
 * ```
 */
export function usePasteHint(
  toast: UseToastReturn,
  options: UsePasteHintOptions = {},
): UsePasteHintReturn {
  const { enabled = true } = options;

  // Track whether we've shown the hint this session
  const hasShownHintRef = useRef(false);

  // Track whether the hint is currently being displayed
  const isHintActiveRef = useRef(false);

  // Timeout reference for cleanup
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Dismiss the hint toast early (on keypress).
   */
  const dismissHintEarly = useCallback(() => {
    if (isHintActiveRef.current) {
      // Clear the timeout if it exists
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Dismiss all toasts (the hint should be the only one at this early point)
      toast.dismissAll();
      isHintActiveRef.current = false;
    }
  }, [toast]);

  /**
   * Handle keypress to dismiss hint early.
   * We listen for any key to dismiss the hint.
   */
  const handleKeyboard = useCallback(() => {
    // Only process if there's an active hint
    if (isHintActiveRef.current) {
      dismissHintEarly();
    }
  }, [dismissHintEarly]);

  useKeyboard(handleKeyboard);

  /**
   * Called when a text paste occurs (not an image).
   * Shows the hint on first text paste if enabled.
   */
  const onTextPaste = useCallback(() => {
    // Don't show if hints are disabled
    if (!enabled) {
      return;
    }

    // Don't show if we've already shown the hint this session
    if (hasShownHintRef.current) {
      return;
    }

    // Mark that we've shown the hint
    hasShownHintRef.current = true;
    isHintActiveRef.current = true;

    // Show the hint toast
    toast.showInfo(PASTE_HINT_MESSAGE, { duration: HINT_DURATION_MS });

    // Set a timeout to mark the hint as inactive after the duration
    // (in case the toast auto-dismisses without a keypress)
    timeoutRef.current = setTimeout(() => {
      isHintActiveRef.current = false;
      timeoutRef.current = null;
    }, HINT_DURATION_MS);
  }, [enabled, toast]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      isHintActiveRef.current = false;
    };
  }, []);

  return {
    onTextPaste,
    hasShownHint: hasShownHintRef.current,
  };
}
