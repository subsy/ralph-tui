/**
 * ABOUTME: Image storage manager for ralph-tui.
 * Stores attached images in a predictable location accessible to agents.
 * Uses content-based hashing for deduplication and provides cleanup utilities.
 */

import { createHash } from 'node:crypto';
import {
  join,
  extname,
  isAbsolute,
  resolve,
  relative,
  sep,
  dirname,
  basename,
} from 'node:path';
import { readdir, unlink, mkdir, rm } from 'node:fs/promises';

/** Supported image extensions for storage */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'] as const;
type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/** Default storage directory relative to cwd */
const STORAGE_DIR_NAME = '.ralph-tui';
const IMAGES_DIR_NAME = 'images';

/**
 * Result of a storage operation.
 */
export interface ImageStorageResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Absolute path to the stored image */
  path?: string;
  /** Whether the image was a duplicate (already existed) */
  deduplicated?: boolean;
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Information about a stored image.
 */
export interface StoredImageInfo {
  /** Absolute path to the stored image */
  path: string;
  /** Filename (e.g., img-abc123def456.png) */
  filename: string;
  /** File extension (e.g., .png) */
  extension: string;
  /** SHA256 prefix used in the filename */
  hashPrefix: string;
}

/**
 * Get the storage directory path.
 *
 * @param baseDir - Base directory (defaults to cwd)
 * @returns Absolute path to the images storage directory
 */
export function getStorageDir(baseDir?: string): string {
  const base = baseDir ?? process.cwd();
  return join(base, STORAGE_DIR_NAME, IMAGES_DIR_NAME);
}

/**
 * Ensure the storage directory exists.
 *
 * @param baseDir - Base directory (defaults to cwd)
 * @returns The storage directory path
 */
export async function ensureStorageDir(baseDir?: string): Promise<string> {
  const storageDir = getStorageDir(baseDir);
  await mkdir(storageDir, { recursive: true });
  return storageDir;
}

/**
 * Generate a SHA256 hash of image data.
 *
 * @param data - Image data as Buffer
 * @returns Full SHA256 hash as hex string
 */
function hashImageData(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a storage filename from image data and extension.
 *
 * @param data - Image data as Buffer
 * @param extension - File extension (with leading dot)
 * @returns Filename in format: img-{sha256-prefix-12chars}.{ext}
 */
function generateFilename(data: Buffer, extension: string): string {
  const hash = hashImageData(data);
  const hashPrefix = hash.slice(0, 12);
  // Normalize extension to lowercase and ensure it starts with a dot
  const normalizedExt = extension.toLowerCase().startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;
  return `img-${hashPrefix}${normalizedExt}`;
}

/**
 * Normalize a file extension to a supported image extension.
 *
 * @param ext - File extension (with or without leading dot)
 * @returns Normalized extension with leading dot, or null if unsupported
 */
function normalizeExtension(ext: string): ImageExtension | null {
  const normalized = ext.toLowerCase().startsWith('.')
    ? ext.toLowerCase()
    : `.${ext.toLowerCase()}`;

  // Handle .jpg -> .jpeg normalization for consistency
  if (normalized === '.jpg') {
    return '.jpeg';
  }

  return IMAGE_EXTENSIONS.includes(normalized as ImageExtension)
    ? (normalized as ImageExtension)
    : null;
}

/**
 * Store an image from a file path.
 * Copies the file to the storage location with a content-based filename.
 *
 * @param filePath - Absolute path to the source image file
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns Result with the stored image path
 *
 * @example
 * ```typescript
 * const result = await storeImageFromPath('/path/to/photo.png');
 * if (result.success) {
 *   console.log(`Stored at: ${result.path}`);
 *   if (result.deduplicated) {
 *     console.log('Image was already stored (duplicate)');
 *   }
 * }
 * ```
 */
export async function storeImageFromPath(
  filePath: string,
  baseDir?: string,
): Promise<ImageStorageResult> {
  try {
    // Read the source file
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return {
        success: false,
        error: `Source file not found: ${filePath}`,
      };
    }

    // Get and validate extension
    const ext = extname(filePath);
    const normalizedExt = normalizeExtension(ext);

    if (!normalizedExt) {
      return {
        success: false,
        error: `Unsupported image format: ${ext}`,
      };
    }

    // Read file data
    const arrayBuffer = await file.arrayBuffer();
    const data = Buffer.from(arrayBuffer);

    // Generate filename and storage path
    const filename = generateFilename(data, normalizedExt);
    const storageDir = await ensureStorageDir(baseDir);
    const storagePath = join(storageDir, filename);

    // Check if file already exists (deduplicated)
    const destFile = Bun.file(storagePath);
    const alreadyExists = await destFile.exists();

    if (alreadyExists) {
      return {
        success: true,
        path: storagePath,
        deduplicated: true,
      };
    }

    // Write to storage location
    await Bun.write(storagePath, data);

    return {
      success: true,
      path: storagePath,
      deduplicated: false,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to store image from path',
    };
  }
}

/**
 * Store an image from base64-encoded data.
 * Decodes and writes the image to the storage location.
 *
 * @param base64Data - Base64-encoded image data (with or without data URI prefix)
 * @param extension - Image extension (e.g., 'png', '.png')
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns Result with the stored image path
 *
 * @example
 * ```typescript
 * const result = await storeImageFromBase64(
 *   'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
 *   'png'
 * );
 * if (result.success) {
 *   console.log(`Stored at: ${result.path}`);
 * }
 * ```
 */
export async function storeImageFromBase64(
  base64Data: string,
  extension: string,
  baseDir?: string,
): Promise<ImageStorageResult> {
  try {
    // Validate extension
    const normalizedExt = normalizeExtension(extension);

    if (!normalizedExt) {
      return {
        success: false,
        error: `Unsupported image format: ${extension}`,
      };
    }

    // Remove data URI prefix if present (e.g., "data:image/png;base64,")
    let cleanBase64 = base64Data;
    const dataUriMatch = base64Data.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (dataUriMatch) {
      cleanBase64 = dataUriMatch[1];
    }

    // Decode base64 to Buffer
    const data = Buffer.from(cleanBase64, 'base64');

    if (data.length === 0) {
      return {
        success: false,
        error: 'Invalid base64 data: decoded to empty buffer',
      };
    }

    // Generate filename and storage path
    const filename = generateFilename(data, normalizedExt);
    const storageDir = await ensureStorageDir(baseDir);
    const storagePath = join(storageDir, filename);

    // Check if file already exists (deduplicated)
    const destFile = Bun.file(storagePath);
    const alreadyExists = await destFile.exists();

    if (alreadyExists) {
      return {
        success: true,
        path: storagePath,
        deduplicated: true,
      };
    }

    // Write to storage location
    await Bun.write(storagePath, data);

    return {
      success: true,
      path: storagePath,
      deduplicated: false,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to store image from base64',
    };
  }
}

/**
 * Store an image from raw Buffer data.
 * Typically used for clipboard images.
 *
 * @param data - Image data as Buffer
 * @param extension - Image extension (e.g., 'png', '.png')
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns Result with the stored image path
 *
 * @example
 * ```typescript
 * const clipboardResult = await readClipboardImage();
 * if (clipboardResult.data) {
 *   const result = await storeImageFromBuffer(clipboardResult.data, 'png');
 *   if (result.success) {
 *     console.log(`Stored clipboard image at: ${result.path}`);
 *   }
 * }
 * ```
 */
export async function storeImageFromBuffer(
  data: Buffer,
  extension: string,
  baseDir?: string,
): Promise<ImageStorageResult> {
  try {
    // Validate extension
    const normalizedExt = normalizeExtension(extension);

    if (!normalizedExt) {
      return {
        success: false,
        error: `Unsupported image format: ${extension}`,
      };
    }

    if (data.length === 0) {
      return {
        success: false,
        error: 'Cannot store empty image data',
      };
    }

    // Generate filename and storage path
    const filename = generateFilename(data, normalizedExt);
    const storageDir = await ensureStorageDir(baseDir);
    const storagePath = join(storageDir, filename);

    // Check if file already exists (deduplicated)
    const destFile = Bun.file(storagePath);
    const alreadyExists = await destFile.exists();

    if (alreadyExists) {
      return {
        success: true,
        path: storagePath,
        deduplicated: true,
      };
    }

    // Write to storage location
    await Bun.write(storagePath, data);

    return {
      success: true,
      path: storagePath,
      deduplicated: false,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to store image from buffer',
    };
  }
}

/**
 * List all stored images.
 *
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns Array of stored image information
 *
 * @example
 * ```typescript
 * const images = await listStoredImages();
 * for (const img of images) {
 *   console.log(`${img.filename}: ${img.path}`);
 * }
 * ```
 */
export async function listStoredImages(
  baseDir?: string,
): Promise<StoredImageInfo[]> {
  const storageDir = getStorageDir(baseDir);

  try {
    const entries = await readdir(storageDir, { withFileTypes: true });
    const images: StoredImageInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      // Check if it matches our naming pattern: img-{12-char-hash}.{ext}
      const match = entry.name.match(/^img-([a-f0-9]{12})(\.[a-z]+)$/i);
      if (!match) continue;

      const [, hashPrefix, extension] = match;
      images.push({
        path: join(storageDir, entry.name),
        filename: entry.name,
        extension,
        hashPrefix,
      });
    }

    return images;
  } catch {
    // Directory doesn't exist or isn't accessible
    return [];
  }
}

/**
 * Delete a specific stored image by path or filename.
 *
 * @param pathOrFilename - Absolute path or just the filename
 * @param baseDir - Base directory for storage (defaults to cwd, used if filename provided)
 * @returns True if the image was deleted, false otherwise
 *
 * @example
 * ```typescript
 * // Delete by full path
 * await deleteStoredImage('/path/to/.ralph-tui/images/img-abc123def456.png');
 *
 * // Delete by filename only
 * await deleteStoredImage('img-abc123def456.png');
 * ```
 */
export async function deleteStoredImage(
  pathOrFilename: string,
  baseDir?: string,
): Promise<boolean> {
  try {
    const absoluteInput = isAbsolute(pathOrFilename);
    let storageDir: string;
    let fullPath: string;

    if (absoluteInput && !baseDir) {
      fullPath = resolve(pathOrFilename);
      // For absolute paths without baseDir, only allow files directly inside
      // a recognized ".ralph-tui/images" storage directory.
      storageDir = dirname(fullPath);
      const ralphDir = dirname(storageDir);
      if (
        basename(storageDir) !== IMAGES_DIR_NAME ||
        basename(ralphDir) !== STORAGE_DIR_NAME
      ) {
        return false;
      }
    } else {
      storageDir = resolve(getStorageDir(baseDir));
      fullPath = absoluteInput
        ? resolve(pathOrFilename)
        : resolve(storageDir, pathOrFilename);
    }

    // Ensure target stays inside the storage directory.
    const relativePath = relative(storageDir, fullPath);
    if (
      relativePath === '' ||
      relativePath.startsWith('..') ||
      relativePath.includes(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      return false;
    }

    // Check if file exists
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      return false;
    }

    // Delete the file
    await unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete all stored images.
 *
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns Number of images deleted
 *
 * @example
 * ```typescript
 * const count = await deleteAllStoredImages();
 * console.log(`Deleted ${count} stored images`);
 * ```
 */
export async function deleteAllStoredImages(baseDir?: string): Promise<number> {
  const images = await listStoredImages(baseDir);
  let deletedCount = 0;

  for (const img of images) {
    const deleted = await deleteStoredImage(img.path);
    if (deleted) {
      deletedCount++;
    }
  }

  return deletedCount;
}

/**
 * Purge the entire images storage directory.
 * More aggressive than deleteAllStoredImages - removes the directory itself.
 *
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns True if the directory was removed, false otherwise
 */
export async function purgeStorageDir(baseDir?: string): Promise<boolean> {
  const storageDir = getStorageDir(baseDir);

  try {
    await rm(storageDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the storage path that would be used for given image data.
 * Useful for checking if an image would be deduplicated before storing.
 *
 * @param data - Image data as Buffer
 * @param extension - Image extension (e.g., 'png', '.png')
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns The path that would be used, or null if extension is unsupported
 */
export function getExpectedStoragePath(
  data: Buffer,
  extension: string,
  baseDir?: string,
): string | null {
  const normalizedExt = normalizeExtension(extension);
  if (!normalizedExt) {
    return null;
  }

  const filename = generateFilename(data, normalizedExt);
  return join(getStorageDir(baseDir), filename);
}

/**
 * Check if an image with the given data already exists in storage.
 *
 * @param data - Image data as Buffer
 * @param extension - Image extension (e.g., 'png', '.png')
 * @param baseDir - Base directory for storage (defaults to cwd)
 * @returns True if the image already exists
 */
export async function imageExists(
  data: Buffer,
  extension: string,
  baseDir?: string,
): Promise<boolean> {
  const expectedPath = getExpectedStoragePath(data, extension, baseDir);
  if (!expectedPath) {
    return false;
  }

  const file = Bun.file(expectedPath);
  return file.exists();
}
