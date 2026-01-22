/**
 * ABOUTME: Image detection utility for ralph-tui.
 * Detects images from multiple sources:
 * - File paths (validates existence on disk)
 * - OSC 52 escape sequences (iTerm2, Kitty, WezTerm terminals)
 * - Data URIs (data:image/png;base64,...)
 * - Raw base64-encoded image data
 * Supports common image formats: jpg, jpeg, png, gif, webp.
 */

import { resolve, isAbsolute } from 'node:path';

/** Supported image file extensions (case-insensitive) */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'] as const;
type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/**
 * Regex pattern to match image file paths.
 * Supports:
 * - Absolute paths (/path/to/image.png)
 * - Relative paths (./image.png, ../images/photo.jpg)
 * - Paths with spaces in quotes ("path with spaces/image.png")
 * - Paths with spaces using escape sequences (path\ with\ spaces/image.png)
 * - Windows paths (C:\Users\image.png)
 * - Case-insensitive extension matching
 */
const IMAGE_PATH_PATTERN = /^["']?(.+\.(jpe?g|png|gif|webp))["']?$/i;

/**
 * Result of an image path detection operation.
 */
export interface ImagePathResult {
  /** Whether the input is a valid image path that exists on disk */
  isImagePath: boolean;
  /** The normalized file path (with quotes removed, if any) */
  filePath?: string;
  /** The detected image extension (lowercase) */
  extension?: ImageExtension;
  /** Error message if detection failed but input matched pattern */
  error?: string;
}

/**
 * Extract the file path from a potentially quoted string.
 * Handles:
 * - Double quotes: "path/to/file.png"
 * - Single quotes: 'path/to/file.png'
 * - Escaped spaces: path\ with\ spaces/file.png
 *
 * @param input - The raw input string
 * @returns The extracted file path without surrounding quotes
 */
function extractPathFromQuotes(input: string): string {
  const trimmed = input.trim();

  // Handle double quotes
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  // Handle single quotes
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  // Handle escaped spaces (convert to regular spaces)
  return trimmed.replace(/\\ /g, ' ');
}

/**
 * Check if the given extension is a supported image extension.
 *
 * @param ext - The file extension to check (with or without leading dot)
 * @returns True if the extension is a supported image type
 */
export function isImageExtension(ext: string): ext is ImageExtension {
  const normalizedExt = ext.toLowerCase().replace(/^\./, '');
  return IMAGE_EXTENSIONS.includes(normalizedExt as ImageExtension);
}

/**
 * Check if a string looks like an image file path based on extension.
 * This performs a quick pattern check without filesystem validation.
 *
 * @param input - The string to check
 * @returns True if the string matches an image path pattern
 */
export function looksLikeImagePath(input: string): boolean {
  return IMAGE_PATH_PATTERN.test(input.trim());
}

/**
 * Detect if the input is a valid image file path and verify it exists on disk.
 *
 * This function:
 * 1. Checks if the input matches an image file path pattern
 * 2. Extracts the path (removing quotes if present)
 * 3. Resolves relative paths to absolute paths
 * 4. Validates the file exists using Bun.file().exists()
 *
 * @param input - The pasted text to analyze
 * @param workingDir - Working directory for resolving relative paths (defaults to cwd)
 * @returns Result indicating if input is a valid image path
 *
 * @example
 * ```typescript
 * const result = await detectImagePath('/path/to/photo.png');
 * if (result.isImagePath) {
 *   console.log(`Found image: ${result.filePath}`);
 * } else {
 *   console.log('Not an image path, treating as raw text');
 * }
 * ```
 */
export async function detectImagePath(
  input: string,
  workingDir?: string,
): Promise<ImagePathResult> {
  const trimmedInput = input.trim();

  // Quick check: does it look like an image path?
  const match = trimmedInput.match(IMAGE_PATH_PATTERN);
  if (!match) {
    return { isImagePath: false };
  }

  // Extract the actual path (group 1 contains the full path with extension)
  const rawPath = extractPathFromQuotes(match[1]);
  const extensionMatch = match[2]; // group 2 contains the extension

  // Normalize the extension
  const extension = extensionMatch.toLowerCase() as ImageExtension;

  // Resolve to absolute path
  let absolutePath: string;
  if (isAbsolute(rawPath)) {
    absolutePath = rawPath;
  } else {
    const baseDir = workingDir ?? process.cwd();
    absolutePath = resolve(baseDir, rawPath);
  }

  // Validate file exists using Bun's file API
  try {
    const exists = await Bun.file(absolutePath).exists();
    if (exists) {
      return {
        isImagePath: true,
        filePath: absolutePath,
        extension,
      };
    } else {
      // File doesn't exist - return graceful fallback
      return {
        isImagePath: false,
        error: `File not found: ${absolutePath}`,
      };
    }
  } catch (error) {
    // Filesystem error - return graceful fallback
    return {
      isImagePath: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to check file existence',
    };
  }
}

/**
 * Read image data from a file path.
 * Returns the raw image buffer for use as an attachment.
 *
 * @param filePath - The absolute path to the image file
 * @returns Buffer containing the image data, or null if read failed
 */
export async function readImageFile(filePath: string): Promise<Buffer | null> {
  try {
    const file = Bun.file(filePath);
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Get the MIME type for a given image extension.
 *
 * @param ext - The image extension (without leading dot)
 * @returns The corresponding MIME type
 */
export function getImageMimeType(ext: ImageExtension): string {
  const mimeTypes: Record<ImageExtension, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return mimeTypes[ext];
}

// =============================================================================
// OSC 52 and Base64 Image Detection
// =============================================================================

/**
 * Result of OSC 52 / base64 image detection.
 */
export interface Base64ImageResult {
  /** Whether the input contains valid base64 image data */
  isBase64Image: boolean;
  /** Extracted base64 payload (without prefix/wrapper) */
  base64Data?: string;
  /** Decoded image data as Buffer */
  imageData?: Buffer;
  /** Detected image format extension */
  extension?: ImageExtension;
  /** Error message if detection failed */
  error?: string;
}

/**
 * OSC 52 escape sequence pattern.
 * Format: ESC ] 52 ; c ; <base64-data> BEL (or ST)
 * ESC = \x1b, BEL = \x07, ST = \x1b\\
 *
 * The 'c' parameter indicates clipboard selection (could also be 'p' for primary, 's' for secondary).
 */
const OSC52_PATTERN = /\x1b\]52;[cps];([A-Za-z0-9+/=]+)(?:\x07|\x1b\\)/;

/**
 * Data URI pattern for images.
 * Format: data:image/<type>;base64,<data>
 */
const DATA_URI_PATTERN =
  /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i;

/**
 * Pattern to detect raw base64 data (without prefix).
 * Must contain only valid base64 characters.
 */
const RAW_BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;

/**
 * Minimum length for raw base64 to be considered potentially an image.
 * A minimal 1x1 PNG is about 68 bytes when base64-encoded (~91 chars).
 */
const MIN_RAW_BASE64_LENGTH = 50;

/**
 * Base64 magic byte prefixes for common image formats.
 * These are the base64-encoded versions of the binary magic bytes:
 * - PNG: \x89PNG\r\n\x1a\n -> iVBOR (first 5 chars of base64)
 * - JPEG: \xFF\xD8\xFF -> /9j/ (first 4 chars of base64)
 * - GIF: GIF89a or GIF87a -> R0lGO (first 5 chars of base64)
 * - WebP: RIFF....WEBP -> UklGR (first 5 chars of base64)
 */
const BASE64_MAGIC_BYTES: ReadonlyArray<{
  prefix: string;
  extension: ImageExtension;
}> = [
  { prefix: 'iVBOR', extension: 'png' },
  { prefix: '/9j/', extension: 'jpeg' },
  { prefix: 'R0lGOD', extension: 'gif' },
  { prefix: 'UklGR', extension: 'webp' },
] as const;

/**
 * Detect if the input is an OSC 52 escape sequence containing image data.
 *
 * OSC 52 is used by terminal emulators (iTerm2, Kitty, WezTerm) to transfer
 * clipboard data via escape sequences.
 *
 * @param input - The pasted text to analyze
 * @returns Result with extracted image data if valid OSC 52 image sequence
 *
 * @example
 * ```typescript
 * const result = detectOsc52Image('\x1b]52;c;iVBORw0KGgoAAAANSUhEUgA...\x07');
 * if (result.isBase64Image) {
 *   // Use result.imageData as Buffer
 * }
 * ```
 */
export function detectOsc52Image(input: string): Base64ImageResult {
  const match = input.match(OSC52_PATTERN);
  if (!match) {
    return { isBase64Image: false };
  }

  const base64Data = match[1];
  return decodeAndValidateBase64Image(base64Data);
}

/**
 * Detect if the input is a data URI containing image data.
 *
 * Data URIs are a standard way to embed images directly in text:
 * `data:image/png;base64,iVBORw0KGgo...`
 *
 * @param input - The pasted text to analyze
 * @returns Result with extracted image data if valid data URI image
 *
 * @example
 * ```typescript
 * const result = detectDataUriImage('data:image/png;base64,iVBORw0KGgo...');
 * if (result.isBase64Image) {
 *   console.log(`Detected ${result.extension} image`);
 * }
 * ```
 */
export function detectDataUriImage(input: string): Base64ImageResult {
  const trimmed = input.trim();
  const match = trimmed.match(DATA_URI_PATTERN);
  if (!match) {
    return { isBase64Image: false };
  }

  const declaredType = match[1].toLowerCase();
  const base64Data = match[2];

  // Decode and validate
  const result = decodeAndValidateBase64Image(base64Data);

  // If decoding succeeded but we couldn't detect the type from magic bytes,
  // trust the declared MIME type
  if (result.isBase64Image && !result.extension) {
    // Normalize 'jpg' to 'jpeg' for consistency
    result.extension = (
      declaredType === 'jpg' ? 'jpeg' : declaredType
    ) as ImageExtension;
  }

  return result;
}

/**
 * Detect if the input is raw base64-encoded image data.
 *
 * This attempts to identify images that are pasted as pure base64 without
 * any wrapper (no OSC 52, no data URI). Detection relies on:
 * 1. Valid base64 character set
 * 2. Reasonable minimum length for an image
 * 3. Magic byte detection to confirm it's actually an image
 *
 * @param input - The pasted text to analyze
 * @returns Result with extracted image data if valid raw base64 image
 *
 * @example
 * ```typescript
 * const result = detectRawBase64Image('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...');
 * if (result.isBase64Image) {
 *   console.log(`Raw base64 ${result.extension} image detected`);
 * }
 * ```
 */
export function detectRawBase64Image(input: string): Base64ImageResult {
  const trimmed = input.trim();

  // Must be long enough to potentially be an image
  if (trimmed.length < MIN_RAW_BASE64_LENGTH) {
    return { isBase64Image: false };
  }

  // Must match valid base64 character set
  if (!RAW_BASE64_PATTERN.test(trimmed)) {
    return { isBase64Image: false };
  }

  // Quick check: does it start with a known image magic byte prefix?
  const hasImageMagic = BASE64_MAGIC_BYTES.some((magic) =>
    trimmed.startsWith(magic.prefix),
  );
  if (!hasImageMagic) {
    // Not obviously an image - could be any base64 data
    return { isBase64Image: false };
  }

  return decodeAndValidateBase64Image(trimmed);
}

/**
 * Unified detection for OSC 52, data URI, and raw base64 image data.
 *
 * Checks in order:
 * 1. OSC 52 escape sequence
 * 2. Data URI format
 * 3. Raw base64 with image magic bytes
 *
 * Falls back gracefully - returns isBase64Image: false if not valid image data.
 *
 * @param input - The pasted text to analyze
 * @returns Result with extracted image data if any format matches
 *
 * @example
 * ```typescript
 * const result = detectBase64Image(pastedText);
 * if (result.isBase64Image) {
 *   await storeImageFromBuffer(result.imageData!, result.extension!);
 * } else {
 *   // Treat as regular text paste
 *   insertText(pastedText);
 * }
 * ```
 */
export function detectBase64Image(input: string): Base64ImageResult {
  // Try OSC 52 first (most specific pattern)
  const osc52Result = detectOsc52Image(input);
  if (osc52Result.isBase64Image) {
    return osc52Result;
  }

  // Try data URI next
  const dataUriResult = detectDataUriImage(input);
  if (dataUriResult.isBase64Image) {
    return dataUriResult;
  }

  // Finally try raw base64
  return detectRawBase64Image(input);
}

/**
 * Decode base64 data and validate it contains image data.
 *
 * @param base64Data - The base64 string to decode
 * @returns Result with decoded buffer and detected extension if valid
 */
function decodeAndValidateBase64Image(base64Data: string): Base64ImageResult {
  try {
    // Decode from base64
    const buffer = Buffer.from(base64Data, 'base64');

    // Check we got actual data
    if (buffer.length === 0) {
      return {
        isBase64Image: false,
        error: 'Decoded to empty buffer',
      };
    }

    // Detect image format from magic bytes
    const extension = detectImageFormatFromBuffer(buffer);
    if (!extension) {
      return {
        isBase64Image: false,
        error: 'Not a recognized image format',
      };
    }

    return {
      isBase64Image: true,
      base64Data,
      imageData: buffer,
      extension,
    };
  } catch (error) {
    return {
      isBase64Image: false,
      error: error instanceof Error ? error.message : 'Failed to decode base64',
    };
  }
}

/**
 * Detect image format from the binary magic bytes in a buffer.
 *
 * Magic bytes (file signatures):
 * - PNG: 89 50 4E 47 0D 0A 1A 0A
 * - JPEG: FF D8 FF
 * - GIF: 47 49 46 38 (GIF8)
 * - WebP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
 *
 * @param buffer - The decoded image data
 * @returns The detected extension, or undefined if not recognized
 */
function detectImageFormatFromBuffer(
  buffer: Buffer,
): ImageExtension | undefined {
  if (buffer.length < 12) {
    return undefined;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // GIF: 47 49 46 38 (GIF8) followed by 39 (GIF89a) or 37 (GIF87a)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x39 || buffer[4] === 0x37) &&
    buffer[5] === 0x61
  ) {
    return 'gif';
  }

  // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return undefined;
}
