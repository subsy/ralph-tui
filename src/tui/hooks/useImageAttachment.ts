/**
 * ABOUTME: React hook for managing image attachments in text input components.
 * Unifies multiple image detection methods (file paths, clipboard images, base64 data)
 * and provides a clean API for attaching, removing, and formatting images for prompts.
 */

import { useState, useCallback, useMemo } from 'react';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { detectImagePath } from '../utils/image-detection.js';
import {
  readClipboardImage,
  hasClipboardImage,
} from '../utils/clipboard-image.js';
import {
  storeImageFromPath,
  storeImageFromBase64,
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
 * Pattern to detect base64 image data.
 * Matches data URIs (data:image/png;base64,...) or raw base64 that looks like image data.
 */
const BASE64_DATA_URI_PATTERN = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;

/**
 * Pattern to detect raw base64 data (without data URI prefix).
 * Checks for valid base64 characters and reasonable length for an image.
 */
const RAW_BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;

/**
 * Minimum length for base64 data to be considered potentially an image.
 * A 1x1 PNG is about 68 bytes base64-encoded.
 */
const MIN_BASE64_LENGTH = 50;

/**
 * Check if a string looks like base64 image data.
 *
 * @param input - String to check
 * @returns Object with isBase64 flag and detected extension
 */
function detectBase64Image(input: string): {
  isBase64: boolean;
  extension?: string;
} {
  const trimmed = input.trim();

  // Check for data URI format
  const dataUriMatch = trimmed.match(BASE64_DATA_URI_PATTERN);
  if (dataUriMatch) {
    const ext = dataUriMatch[1].toLowerCase();
    return { isBase64: true, extension: ext === 'jpg' ? 'jpeg' : ext };
  }

  // Check for raw base64 (must be reasonably long and valid)
  if (trimmed.length >= MIN_BASE64_LENGTH && RAW_BASE64_PATTERN.test(trimmed)) {
    // Try to detect image type from magic bytes after decoding first few bytes
    try {
      const partial = Buffer.from(trimmed.slice(0, 16), 'base64');
      // PNG magic: 89 50 4E 47
      if (
        partial[0] === 0x89 &&
        partial[1] === 0x50 &&
        partial[2] === 0x4e &&
        partial[3] === 0x47
      ) {
        return { isBase64: true, extension: 'png' };
      }
      // JPEG magic: FF D8 FF
      if (partial[0] === 0xff && partial[1] === 0xd8 && partial[2] === 0xff) {
        return { isBase64: true, extension: 'jpeg' };
      }
      // GIF magic: 47 49 46 38
      if (
        partial[0] === 0x47 &&
        partial[1] === 0x49 &&
        partial[2] === 0x46 &&
        partial[3] === 0x38
      ) {
        return { isBase64: true, extension: 'gif' };
      }
      // WebP magic: 52 49 46 46 ... 57 45 42 50
      if (
        partial[0] === 0x52 &&
        partial[1] === 0x49 &&
        partial[2] === 0x46 &&
        partial[3] === 0x46
      ) {
        return { isBase64: true, extension: 'webp' };
      }
    } catch {
      // Invalid base64, not an image
    }
  }

  return { isBase64: false };
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

  /**
   * Attach an image from the system clipboard.
   */
  const attachFromClipboard = useCallback(async (): Promise<AttachResult> => {
    // Check if we've reached the max limit (0 = unlimited)
    if (maxImages > 0 && attachedImages.length >= maxImages) {
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
    const imageNumber = attachedImages.length + 1;
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

    setAttachedImages((prev) => [...prev, image]);

    return { success: true, image, imageNumber, inlineMarker };
  }, [maxImages, attachedImages.length]);

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
      if (maxImages > 0 && attachedImages.length >= maxImages) {
        return {
          success: false,
          error: `Maximum of ${maxImages} images allowed per message`,
        };
      }

      // Check if input is base64 image data
      const base64Check = detectBase64Image(trimmedInput);
      if (base64Check.isBase64 && base64Check.extension) {
        const storageResult = await storeImageFromBase64(
          trimmedInput,
          base64Check.extension,
        );
        if (!storageResult.success || !storageResult.path) {
          return {
            success: false,
            error: storageResult.error ?? 'Failed to store base64 image',
          };
        }

        // Calculate image number before state update
        const imageNumber = attachedImages.length + 1;
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

        setAttachedImages((prev) => [...prev, image]);

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
        const imageNumber = attachedImages.length + 1;
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

        setAttachedImages((prev) => [...prev, image]);

        return { success: true, image, imageNumber, inlineMarker };
      }

      // Input didn't match any known image format
      // Not necessarily an error - could just be regular text
      return {
        success: false,
        error: pathResult.error ?? 'Input is not a recognized image format',
      };
    },
    [attachFromClipboard, maxImages, attachedImages.length],
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
      return prev.filter((_, i) => i !== index);
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
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  /**
   * Remove an attached image by its unique ID.
   * Used when user deletes an indicator via backspace/delete.
   */
  const removeImageById = useCallback((imageId: string): boolean => {
    let found = false;
    setAttachedImages((prev) => {
      const index = prev.findIndex((img) => img.id === imageId);
      if (index === -1) {
        return prev;
      }

      found = true;
      const imageToRemove = prev[index];

      // Delete the stored file since the user explicitly removed the marker
      deleteStoredImage(imageToRemove.storedPath).catch(() => {
        // Ignore deletion errors
      });

      // Remove from array
      return prev.filter((_, i) => i !== index);
    });
    return found;
  }, []);

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
