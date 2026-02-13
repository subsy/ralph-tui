/**
 * ABOUTME: Wrapper hook that combines image attachment with toast feedback.
 * Provides user feedback when images are attached or when errors occur.
 * Handles missing clipboard tool warnings (shown only once per session).
 */

import { useCallback, useRef } from 'react';
import { platform } from 'node:os';
import { useImageAttachment } from './useImageAttachment.js';
import type {
  AttachResult,
  UseImageAttachmentReturn,
  UseImageAttachmentOptions,
} from './useImageAttachment.js';
import type { UseToastReturn } from './useToast.js';
import { checkClipboardTool } from '../utils/clipboard-image.js';
import { looksLikeImagePath } from '../utils/image-detection.js';

/**
 * Extended attach result with feedback information.
 */
export interface AttachResultWithFeedback extends AttachResult {
  /** Whether feedback was shown to the user */
  feedbackShown: boolean;
}

/**
 * Return type for the useImageAttachmentWithFeedback hook.
 */
export interface UseImageAttachmentWithFeedbackReturn extends Omit<
  UseImageAttachmentReturn,
  'attachImage' | 'attachFromClipboard'
> {
  /** Attach an image with toast feedback */
  attachImage: (input: string) => Promise<AttachResultWithFeedback>;
  /** Attach an image from clipboard with toast feedback */
  attachFromClipboard: () => Promise<AttachResultWithFeedback>;
}

/**
 * Error message categorization for user-friendly feedback.
 */
type ErrorCategory =
  | 'invalid_path' // File doesn't exist
  | 'unsupported_format' // Not a supported image type
  | 'clipboard_failed' // Failed to read clipboard
  | 'storage_failed' // Failed to save image
  | 'missing_tool' // Clipboard tool not installed
  | 'no_image' // No image in clipboard
  | 'max_limit' // Max images per message reached
  | 'unknown'; // Generic error

/**
 * Categorize an error message into a user-friendly category.
 */
function categorizeError(
  error: string,
  inputLooksLikePath: boolean,
): ErrorCategory {
  const lowerError = error.toLowerCase();

  // Max images limit reached
  if (lowerError.includes('maximum') && lowerError.includes('images')) {
    return 'max_limit';
  }

  // Missing clipboard tool
  if (
    lowerError.includes('no clipboard tool') ||
    lowerError.includes('install')
  ) {
    return 'missing_tool';
  }

  // No image in clipboard
  if (lowerError.includes('no image found in clipboard')) {
    return 'no_image';
  }

  // Clipboard read failures
  if (
    lowerError.includes('clipboard') ||
    lowerError.includes('pngpaste') ||
    lowerError.includes('xclip') ||
    lowerError.includes('wl-paste')
  ) {
    return 'clipboard_failed';
  }

  // File not found
  if (
    lowerError.includes('not found') ||
    lowerError.includes('does not exist')
  ) {
    return 'invalid_path';
  }

  // Unsupported format
  if (lowerError.includes('unsupported') || lowerError.includes('format')) {
    return 'unsupported_format';
  }

  // Storage failures
  if (
    lowerError.includes('store') ||
    lowerError.includes('save') ||
    lowerError.includes('write')
  ) {
    return 'storage_failed';
  }

  // If input looked like a path but failed, treat as invalid path
  if (inputLooksLikePath) {
    return 'invalid_path';
  }

  return 'unknown';
}

/**
 * Get user-friendly error message based on error category.
 */
function getErrorMessage(category: ErrorCategory, error?: string): string {
  switch (category) {
    case 'invalid_path':
      return 'Invalid image path';
    case 'unsupported_format':
      return 'Unsupported format';
    case 'clipboard_failed':
      return 'Failed to read clipboard';
    case 'storage_failed':
      return 'Failed to save image';
    case 'missing_tool':
      return 'Clipboard tool not installed';
    case 'no_image':
      return 'No image in clipboard';
    case 'max_limit':
      // Use the original error message which contains the limit number
      return error ?? 'Max images limit reached';
    case 'unknown':
    default:
      return 'Failed to attach image';
  }
}

/**
 * Get platform-specific installation hint for clipboard tools.
 */
function getInstallHint(): string {
  const os = platform();
  switch (os) {
    case 'darwin':
      return 'Install pngpaste: `brew install pngpaste`';
    case 'linux':
      return 'Install xclip: `sudo apt install xclip`';
    case 'win32':
      return 'PowerShell should be available on Windows';
    default:
      return 'Clipboard tool not available for this platform';
  }
}

/**
 * React hook that wraps useImageAttachment with toast feedback.
 *
 * Provides user feedback via toasts when:
 * - Image is successfully attached: "Image attached"
 * - File doesn't exist: "Invalid image path"
 * - Unsupported format: "Unsupported format"
 * - Clipboard tool fails: "Failed to read clipboard"
 * - Storage fails: "Failed to save image"
 * - Missing tool (once per session): Install hint
 * - Max images limit reached: "Maximum of N images allowed"
 *
 * @param toast - Toast hook return value for showing notifications
 * @param options - Configuration options passed to useImageAttachment
 * @returns Extended image attachment hook with feedback
 *
 * @example
 * ```tsx
 * function ChatInput() {
 *   const toast = useToast();
 *   const {
 *     attachedImages,
 *     attachImage,
 *     attachFromClipboard,
 *   } = useImageAttachmentWithFeedback(toast, { maxImagesPerMessage: 5 });
 *
 *   const handlePaste = async (text: string) => {
 *     // Feedback is shown automatically via toasts
 *     await attachImage(text);
 *   };
 *
 *   return <input onPaste={(e) => handlePaste(e.clipboardData.getData('text'))} />;
 * }
 * ```
 */
export function useImageAttachmentWithFeedback(
  toast: UseToastReturn,
  options: UseImageAttachmentOptions = {},
): UseImageAttachmentWithFeedbackReturn {
  const baseHook = useImageAttachment(options);

  // Track whether we've shown the missing tool message this session
  const hasShownMissingToolMessageRef = useRef(false);

  /**
   * Check if clipboard tool is available and show warning if not.
   * Returns true if tool is available, false otherwise.
   */
  const checkAndWarnClipboardTool = useCallback(async (): Promise<boolean> => {
    const toolInfo = await checkClipboardTool();

    if (!toolInfo.available) {
      // Only show the missing tool message once per session
      if (!hasShownMissingToolMessageRef.current) {
        hasShownMissingToolMessageRef.current = true;
        const hint = getInstallHint();
        toast.showInfo(hint, { duration: 5000 });
      }
      return false;
    }

    return true;
  }, [toast]);

  /**
   * Attach an image from clipboard with toast feedback.
   */
  const attachFromClipboard =
    useCallback(async (): Promise<AttachResultWithFeedback> => {
      // Check clipboard tool availability first
      const toolAvailable = await checkAndWarnClipboardTool();

      if (!toolAvailable) {
        return {
          success: false,
          error: 'Clipboard tool not available',
          feedbackShown: true, // Install hint was shown
        };
      }

      const result = await baseHook.attachFromClipboard();

      if (result.success) {
        toast.showSuccess('Image attached');
        return { ...result, feedbackShown: true };
      } else {
        const category = categorizeError(result.error ?? '', false);

        // Don't show feedback for "no image in clipboard" - that's expected
        // when user pastes text that isn't an image
        if (category === 'no_image') {
          return { ...result, feedbackShown: false };
        }

        const message = getErrorMessage(category, result.error);
        toast.showError(message);
        return { ...result, feedbackShown: true };
      }
    }, [baseHook, toast, checkAndWarnClipboardTool]);

  /**
   * Attach an image from various sources with toast feedback.
   */
  const attachImage = useCallback(
    async (input: string): Promise<AttachResultWithFeedback> => {
      const trimmedInput = input.trim();

      // Empty input means try clipboard
      if (!trimmedInput) {
        return attachFromClipboard();
      }

      // Check if input looks like it might be an image path
      const inputLooksLikePath = looksLikeImagePath(trimmedInput);

      const result = await baseHook.attachImage(trimmedInput);

      if (result.success) {
        toast.showSuccess('Image attached');
        return { ...result, feedbackShown: true };
      } else {
        // Only show error feedback if the input looked like it was meant to be an image
        // (file path pattern or base64 data pattern)
        // Don't show errors for regular text that happens to fail image detection

        const category = categorizeError(
          result.error ?? '',
          inputLooksLikePath,
        );

        // If input doesn't look like a path and we got a generic "not recognized" error,
        // don't show feedback - it's probably just regular text
        if (!inputLooksLikePath && category === 'unknown') {
          return { ...result, feedbackShown: false };
        }

        // If it looked like a path but file doesn't exist, show feedback
        if (inputLooksLikePath && category === 'invalid_path') {
          toast.showError('Invalid image path');
          return { ...result, feedbackShown: true };
        }

        // If it looked like a path but format is unsupported, show feedback
        if (inputLooksLikePath && category === 'unsupported_format') {
          toast.showError('Unsupported format');
          return { ...result, feedbackShown: true };
        }

        // For storage failures, always show feedback
        if (category === 'storage_failed') {
          toast.showError('Failed to save image');
          return { ...result, feedbackShown: true };
        }

        // Handle max limit error (show regardless of input type)
        if (category === 'max_limit') {
          const message = getErrorMessage(category, result.error);
          toast.showError(message);
          return { ...result, feedbackShown: true };
        }

        // For other errors on paths that looked like images, show generic message
        if (inputLooksLikePath) {
          const message = getErrorMessage(category, result.error);
          toast.showError(message);
          return { ...result, feedbackShown: true };
        }

        // Input didn't look like an image path, no feedback needed
        return { ...result, feedbackShown: false };
      }
    },
    [baseHook, toast, attachFromClipboard],
  );

  return {
    ...baseHook,
    attachImage,
    attachFromClipboard,
  };
}
