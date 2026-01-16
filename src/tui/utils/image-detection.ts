/**
 * ABOUTME: Image file path detection utility for ralph-tui.
 * Detects when pasted text is a valid image file path and validates it exists on disk.
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
  workingDir?: string
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
      error: error instanceof Error ? error.message : 'Failed to check file existence',
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
