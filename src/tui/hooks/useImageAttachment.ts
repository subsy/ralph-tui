/**
 * ABOUTME: React hook for managing image attachments in text input components.
 * Unifies multiple image detection methods (file paths, clipboard images, base64 data)
 * and provides a clean API for attaching, removing, and formatting images for prompts.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { detectImagePath, detectBase64Image } from '../utils/image-detection.js';
import {
  readClipboardImage,
  hasClipboardImage,
} from '../utils/clipboard-image.js';
import {
  storeImageFromPath,
  storeImageFromBuffer,
  deleteStoredImage,
} from '../utils/image-storage.js';
import { DEFAULT_IMAGE_CONFIG } from '../../config/types.js';

/**
 * Represents a single attached image with metadata.
 */
export interface AttachedImage {
  /** Unique identifier for this attachment */
  id: string;
  /** Original source (file path, "clipboard", or "base64") */
  originalSource: string;
  /** Absolute path where the image is stored */
  storedPath: string;
  /** Human-readable display name for the image */
  displayName: string;
}

/**
 * Result of an attach operation.
 */
export interface AttachResult {
  /** Whether the attach operation succeeded */
  success: boolean;
  /** The attached image info (if successful) */
  image?: AttachedImage;
  /** Error message (if failed) */
  error?: string;
  /**
   * The image number (1-indexed) for use in inline markers like [Image 1].
   * Only present when success is true.
   */
  imageNumber?: number;
  /**
   * The inline marker text to insert at cursor position (e.g., "[Image 1]").
   * Only present when success is true.
   */
  inlineMarker?: string;
}

/**
 * Options for the useImageAttachment hook.
 */
export interface UseImageAttachmentOptions {
  /**
   * Maximum images allowed per message (0 = unlimited).
   * Defaults to DEFAULT_IMAGE_CONFIG.max_images_per_message (10).
   */
  maxImagesPerMessage?: number;
}

/**
 * Return type for the useImageAttachment hook.
 */
export interface UseImageAttachmentReturn {
  /** Currently attached images */
  attachedImages: AttachedImage[];
  /**
   * Attach an image from various sources.
   * Detects if input is a file path, base64 data, or triggers clipboard read.
   * @param input - File path, base64 data, or empty string to read clipboard
   * @returns Promise resolving to the attach result
   */
  attachImage: (input: string) => Promise<AttachResult>;
  /**
   * Attach an image directly from clipboard.
   * @returns Promise resolving to the attach result
   */
  attachFromClipboard: () => Promise<AttachResult>;
  /**
   * Remove an attached image by index.
   * @param index - Index of the image to remove
   */
  removeImage: (index: number) => void;
  /**
   * Remove an attached image by its image number (1-indexed).
   * Used when user deletes an [Image N] marker from the text.
   * @param imageNumber - The 1-indexed image number to remove
   */
  removeImageByNumber: (imageNumber: number) => void;
  /**
   * Remove an attached image by its unique ID.
   * Used when user deletes an [Image N] marker via the new indicator system.
   * @param imageId - The unique ID of the image to remove
   * @returns true if image was found and removed, false otherwise
   */
  removeImageById: (imageId: string) => boolean;
  /**
   * Remove all attached images.
   * @param deleteFiles - Whether to delete the stored image files (default: false)
   */
  clearImages: (deleteFiles?: boolean) => void;
  /**
   * Get formatted string for appending to prompt.
   * @returns Formatted string listing all attached images, or empty string if none
   */
  getPromptSuffix: () => string;
  /**
   * Whether there are any attached images.
   */
  hasImages: boolean;
  /**
   * Maximum images allowed per message (from config).
   */
  maxImages: number;
  /**
   * Whether the max images limit has been reached.
   */
  isAtLimit: boolean;
}

/**
 * Generate a display name for an attached image.
 *
 * @param source - Original source of the image
 * @param storedPath - Path where the image is stored
 * @param index - Index of the image in the attachment list
 * @returns Human-readable display name
 */
function generateDisplayName(
  source: string,
  _storedPath: string,
  index: number,
): string {
  if (source === 'clipboard') {
    return `Clipboard Image ${index + 1}`;
  }
  if (source === 'base64') {
    return `Pasted Image ${index + 1}`;
  }
  // For file paths, use the original filename
  return basename(source);
}

/**
 * React hook for managing image attachments.
 *
 * Provides a unified interface for attaching images from:
 * - File paths (e.g., /path/to/image.png)
 * - Clipboard image data (Ctrl+V with image copied)
 * - Base64/data URI encoded images
 *
 * @param options - Configuration options for the hook
 * @returns Object with attachment state and methods
 *
 * @example
 * ```tsx
 * function ImageInput() {
 *   const {
 *     attachedImages,
 *     attachImage,
 *     removeImage,
 *     clearImages,
 *     getPromptSuffix,
 *   } = useImageAttachment({ maxImagesPerMessage: 5 });
 *
 *   const handlePaste = async (text: string) => {
 *     const result = await attachImage(text);
 *     if (result.success) {
 *       console.log(`Attached: ${result.image.displayName}`);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <input onPaste={(e) => handlePaste(e.clipboardData.getData('text'))} />
 *       {attachedImages.map((img, i) => (
 *         <span key={img.id}>
 *           {img.displayName}
 *           <button onClick={() => removeImage(i)}>X</button>
 *         </span>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useImageAttachment(
  options: UseImageAttachmentOptions = {},
): UseImageAttachmentReturn {
  const maxImages =
    options.maxImagesPerMessage ?? DEFAULT_IMAGE_CONFIG.max_images_per_message;
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const imageCountRef = useRef(0);

  /**
   * Attach an image from the system clipboard.
   */
  const attachFromClipboard = useCallback(async (): Promise<AttachResult> => {
    // Check if we've reached the max limit (0 = unlimited)
    if (maxImages > 0 && imageCountRef.current >= maxImages) {
      return {
        success: false,
        error: `Maximum of ${maxImages} images allowed per message`,
      };
    }

    // Check if clipboard has an image
    const hasImage = await hasClipboardImage();
    if (!hasImage) {
      return {
        success: false,
        error: 'No image found in clipboard',
      };
    }

    // Read the clipboard image
    const clipboardResult = await readClipboardImage();
    if (!clipboardResult.data) {
      return {
        success: false,
        error: clipboardResult.error ?? 'Failed to read clipboard image',
      };
    }

    // Store the image
    const storageResult = await storeImageFromBuffer(
      clipboardResult.data,
      'png',
    );
    if (!storageResult.success || !storageResult.path) {
      return {
        success: false,
        error: storageResult.error ?? 'Failed to store clipboard image',
      };
    }

    // Calculate the image number (1-indexed) before updating state
    // This ensures consistency between the returned number and the actual position
    const imageNumber = imageCountRef.current + 1;
    const inlineMarker = `[Image ${imageNumber}]`;

    // Create the attachment
    const image: AttachedImage = {
      id: randomUUID(),
      originalSource: 'clipboard',
      storedPath: storageResult.path,
      displayName: generateDisplayName(
        'clipboard',
        storageResult.path!,
        imageNumber - 1,
      ),
    };

    setAttachedImages((prev) => {
      const next = [...prev, image];
      imageCountRef.current = next.length;
      return next;
    });

    return { success: true, image, imageNumber, inlineMarker };
  }, [maxImages]);

  /**
   * Attach an image from various input sources.
   */
  const attachImage = useCallback(
    async (input: string): Promise<AttachResult> => {
      const trimmedInput = input.trim();

      // Empty input means try clipboard
      if (!trimmedInput) {
        return attachFromClipboard();
      }

      // Check if we've reached the max limit (0 = unlimited)
      if (maxImages > 0 && imageCountRef.current >= maxImages) {
        return {
          success: false,
          error: `Maximum of ${maxImages} images allowed per message`,
        };
      }

      // Check if input is base64 image data
      const base64Check = detectBase64Image(trimmedInput);
      if (base64Check.isBase64Image) {
        if (!base64Check.imageData || !base64Check.extension) {
          return {
            success: false,
            error: base64Check.error ?? 'Failed to parse base64 image data',
          };
        }

        const storageResult = await storeImageFromBuffer(
          base64Check.imageData,
          base64Check.extension,
        );
        if (!storageResult.success || !storageResult.path) {
          return {
            success: false,
            error: storageResult.error ?? 'Failed to store base64 image',
          };
        }

        // Calculate image number before state update
        const imageNumber = imageCountRef.current + 1;
        const inlineMarker = `[Image ${imageNumber}]`;

        const image: AttachedImage = {
          id: randomUUID(),
          originalSource: 'base64',
          storedPath: storageResult.path,
          displayName: generateDisplayName(
            'base64',
            storageResult.path!,
            imageNumber - 1,
          ),
        };

        setAttachedImages((prev) => {
          const next = [...prev, image];
          imageCountRef.current = next.length;
          return next;
        });

        return { success: true, image, imageNumber, inlineMarker };
      }

      // Check if input is a file path
      const pathResult = await detectImagePath(trimmedInput);
      if (pathResult.isImagePath && pathResult.filePath) {
        const storageResult = await storeImageFromPath(pathResult.filePath);
        if (!storageResult.success || !storageResult.path) {
          return {
            success: false,
            error: storageResult.error ?? 'Failed to store image from path',
          };
        }

        // Calculate image number before state update
        const imageNumber = imageCountRef.current + 1;
        const inlineMarker = `[Image ${imageNumber}]`;

        const image: AttachedImage = {
          id: randomUUID(),
          originalSource: pathResult.filePath,
          storedPath: storageResult.path,
          displayName: generateDisplayName(
            pathResult.filePath!,
            storageResult.path!,
            imageNumber - 1,
          ),
        };

        setAttachedImages((prev) => {
          const next = [...prev, image];
          imageCountRef.current = next.length;
          return next;
        });

        return { success: true, image, imageNumber, inlineMarker };
      }

      // Input didn't match any known image format
      // Not necessarily an error - could just be regular text
      return {
        success: false,
        error: pathResult.error ?? 'Input is not a recognized image format',
      };
    },
    [attachFromClipboard, maxImages],
  );

  /**
   * Remove an attached image by index.
   */
  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      if (index < 0 || index >= prev.length) {
        return prev;
      }

      const imageToRemove = prev[index];

      // Delete the stored file (fire and forget - don't block on this)
      deleteStoredImage(imageToRemove.storedPath).catch(() => {
        // Ignore deletion errors - the file might already be gone
      });

      // Remove from array
      const next = prev.filter((_, i) => i !== index);
      imageCountRef.current = next.length;
      return next;
    });
  }, []);

  /**
   * Remove an attached image by its image number (1-indexed).
   * Used when user deletes an [Image N] marker from the text.
   */
  const removeImageByNumber = useCallback((imageNumber: number) => {
    // Convert 1-indexed image number to 0-indexed array index
    const index = imageNumber - 1;
    setAttachedImages((prev) => {
      if (index < 0 || index >= prev.length) {
        return prev;
      }

      const imageToRemove = prev[index];

      // Delete the stored file since the user explicitly removed the marker
      deleteStoredImage(imageToRemove.storedPath).catch(() => {
        // Ignore deletion errors
      });

      // Remove from array
      const next = prev.filter((_, i) => i !== index);
      imageCountRef.current = next.length;
      return next;
    });
  }, []);

  /**
   * Remove an attached image by its unique ID.
   * Used when user deletes an indicator via backspace/delete.
   */
  const removeImageById = useCallback((imageId: string): boolean => {
    const imageToRemove = attachedImages.find((img) => img.id === imageId);
    if (!imageToRemove) {
      return false;
    }

    // Delete the stored file since the user explicitly removed the marker
    deleteStoredImage(imageToRemove.storedPath).catch(() => {
      // Ignore deletion errors
    });

    setAttachedImages((prev) => {
      const next = prev.filter((img) => img.id !== imageId);
      imageCountRef.current = next.length;
      return next;
    });
    return true;
  }, [attachedImages]);

  /**
   * Remove all attached images.
   *
   * @param deleteFiles - Whether to delete the stored image files (default: false).
   *                      Set to true only for explicit user cancellation.
   *                      When sending a message, files should be kept so agents can read them.
   */
  const clearImages = useCallback((deleteFiles: boolean = false) => {
    setAttachedImages((prev) => {
      // Only delete files if explicitly requested (e.g., user cancelled)
      // When sending a message, we keep the files so the agent can access them
      if (deleteFiles) {
        for (const image of prev) {
          deleteStoredImage(image.storedPath).catch(() => {
            // Ignore deletion errors
          });
        }
      }
      imageCountRef.current = 0;
      return [];
    });
  }, []);

  /**
   * Generate the formatted prompt suffix for attached images.
   *
   * This creates a mapping section that matches inline markers like [Image 1]
   * to their actual file paths. The format is designed to be easily parsed
   * by agents and provides clear context for image references.
   *
   * Example output:
   * ```
   * [Image References]
   * [Image 1]: /path/to/.ralph-tui/images/img-abc123.png
   * [Image 2]: /path/to/.ralph-tui/images/img-def456.png
   * ```
   */
  const getPromptSuffix = useCallback((): string => {
    if (attachedImages.length === 0) {
      return '';
    }

    const lines = ['', '[Image References]'];
    attachedImages.forEach((image, index) => {
      lines.push(`[Image ${index + 1}]: ${image.storedPath}`);
    });

    return lines.join('\n');
  }, [attachedImages]);

  /**
   * Whether there are any attached images.
   */
  const hasImages = useMemo(() => attachedImages.length > 0, [attachedImages]);

  /**
   * Whether the max images limit has been reached.
   */
  const isAtLimit = useMemo(
    () => maxImages > 0 && attachedImages.length >= maxImages,
    [maxImages, attachedImages.length],
  );

  return {
    attachedImages,
    attachImage,
    attachFromClipboard,
    removeImage,
    removeImageByNumber,
    removeImageById,
    clearImages,
    getPromptSuffix,
    hasImages,
    maxImages,
    isAtLimit,
  };
}
