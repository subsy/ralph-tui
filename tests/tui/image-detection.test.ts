/**
 * ABOUTME: Tests for image detection utility.
 * Tests image path pattern matching, file existence validation, OSC 52 detection,
 * data URI detection, raw base64 detection, and edge cases.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import {
  detectImagePath,
  isImageExtension,
  looksLikeImagePath,
  getImageMimeType,
  readImageFile,
  detectOsc52Image,
  detectDataUriImage,
  detectRawBase64Image,
  detectBase64Image,
} from '../../src/tui/utils/image-detection.js';

describe('image-detection utility', () => {
  // Test directory for file existence tests
  let testDir: string;
  let testImagePath: string;
  let testImageWithSpaces: string;

  beforeAll(async () => {
    // Create a temporary test directory with dummy image files
    testDir = join(tmpdir(), `image-detection-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create dummy test files (just need them to exist, not be valid images)
    testImagePath = join(testDir, 'test-image.png');
    testImageWithSpaces = join(testDir, 'test image with spaces.jpg');

    // Write minimal content to simulate files
    await Bun.write(testImagePath, 'fake png data');
    await Bun.write(testImageWithSpaces, 'fake jpg data');
  });

  afterAll(async () => {
    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('isImageExtension', () => {
    test('returns true for supported extensions', () => {
      expect(isImageExtension('jpg')).toBe(true);
      expect(isImageExtension('jpeg')).toBe(true);
      expect(isImageExtension('png')).toBe(true);
      expect(isImageExtension('gif')).toBe(true);
      expect(isImageExtension('webp')).toBe(true);
    });

    test('handles case-insensitive matching', () => {
      expect(isImageExtension('JPG')).toBe(true);
      expect(isImageExtension('PNG')).toBe(true);
      expect(isImageExtension('GIF')).toBe(true);
      expect(isImageExtension('WebP')).toBe(true);
    });

    test('handles leading dot', () => {
      expect(isImageExtension('.jpg')).toBe(true);
      expect(isImageExtension('.png')).toBe(true);
    });

    test('returns false for unsupported extensions', () => {
      expect(isImageExtension('txt')).toBe(false);
      expect(isImageExtension('pdf')).toBe(false);
      expect(isImageExtension('bmp')).toBe(false);
      expect(isImageExtension('svg')).toBe(false);
      expect(isImageExtension('tiff')).toBe(false);
    });
  });

  describe('looksLikeImagePath', () => {
    test('matches absolute paths', () => {
      expect(looksLikeImagePath('/path/to/image.png')).toBe(true);
      expect(looksLikeImagePath('/Users/test/photo.jpg')).toBe(true);
      expect(looksLikeImagePath('/home/user/images/pic.gif')).toBe(true);
    });

    test('matches relative paths', () => {
      expect(looksLikeImagePath('./image.png')).toBe(true);
      expect(looksLikeImagePath('../images/photo.jpeg')).toBe(true);
      expect(looksLikeImagePath('assets/image.webp')).toBe(true);
    });

    test('matches quoted paths', () => {
      expect(looksLikeImagePath('"/path/to/image.png"')).toBe(true);
      expect(looksLikeImagePath("'/path/to/image.png'")).toBe(true);
      expect(looksLikeImagePath('"/path with spaces/image.jpg"')).toBe(true);
    });

    test('handles case-insensitive extensions', () => {
      expect(looksLikeImagePath('/path/to/image.PNG')).toBe(true);
      expect(looksLikeImagePath('/path/to/image.JPG')).toBe(true);
      expect(looksLikeImagePath('/path/to/image.Jpeg')).toBe(true);
    });

    test('rejects non-image paths', () => {
      expect(looksLikeImagePath('/path/to/file.txt')).toBe(false);
      expect(looksLikeImagePath('/path/to/document.pdf')).toBe(false);
      expect(looksLikeImagePath('just some text')).toBe(false);
      expect(looksLikeImagePath('')).toBe(false);
    });

    test('rejects paths without proper extension', () => {
      expect(looksLikeImagePath('/path/to/image')).toBe(false);
      expect(looksLikeImagePath('image')).toBe(false);
    });

    test('accepts hidden files with image extensions', () => {
      // .png is a valid hidden file in Unix with a png extension
      expect(looksLikeImagePath('/path/to/.png')).toBe(true);
      expect(looksLikeImagePath('.screenshot.png')).toBe(true);
    });
  });

  describe('detectImagePath', () => {
    test('returns isImagePath=true for existing image file', async () => {
      const result = await detectImagePath(testImagePath);
      expect(result.isImagePath).toBe(true);
      expect(result.filePath).toBe(testImagePath);
      expect(result.extension).toBe('png');
    });

    test('handles quoted paths with spaces', async () => {
      const quotedPath = `"${testImageWithSpaces}"`;
      const result = await detectImagePath(quotedPath);
      expect(result.isImagePath).toBe(true);
      expect(result.filePath).toBe(testImageWithSpaces);
      expect(result.extension).toBe('jpg');
    });

    test('handles single-quoted paths with spaces', async () => {
      const quotedPath = `'${testImageWithSpaces}'`;
      const result = await detectImagePath(quotedPath);
      expect(result.isImagePath).toBe(true);
      expect(result.filePath).toBe(testImageWithSpaces);
    });

    test('returns isImagePath=false for non-existent file', async () => {
      const result = await detectImagePath('/nonexistent/path/image.png');
      expect(result.isImagePath).toBe(false);
      expect(result.error).toContain('File not found');
    });

    test('returns isImagePath=false for non-image text', async () => {
      const result = await detectImagePath('hello world');
      expect(result.isImagePath).toBe(false);
      expect(result.error).toBeUndefined();
    });

    test('returns isImagePath=false for non-image file paths', async () => {
      const result = await detectImagePath('/path/to/file.txt');
      expect(result.isImagePath).toBe(false);
    });

    test('resolves relative paths from working directory', async () => {
      const relativePath = 'test-image.png';
      const result = await detectImagePath(relativePath, testDir);
      expect(result.isImagePath).toBe(true);
      expect(result.filePath).toBe(testImagePath);
    });

    test('handles whitespace around input', async () => {
      const result = await detectImagePath(`  ${testImagePath}  `);
      expect(result.isImagePath).toBe(true);
      expect(result.filePath).toBe(testImagePath);
    });

    test('normalizes extension to lowercase', async () => {
      // Create a file with uppercase extension
      const upperPath = join(testDir, 'upper.PNG');
      await Bun.write(upperPath, 'fake data');

      const result = await detectImagePath(upperPath);
      expect(result.isImagePath).toBe(true);
      expect(result.extension).toBe('png');
    });

    test('handles jpeg shorthand', async () => {
      const jpegPath = join(testDir, 'test.jpeg');
      await Bun.write(jpegPath, 'fake jpeg data');

      const result = await detectImagePath(jpegPath);
      expect(result.isImagePath).toBe(true);
      expect(result.extension).toBe('jpeg');
    });
  });

  describe('readImageFile', () => {
    test('reads file content as buffer', async () => {
      const buffer = await readImageFile(testImagePath);
      expect(buffer).not.toBeNull();
      expect(buffer?.toString()).toBe('fake png data');
    });

    test('returns null for non-existent file', async () => {
      const buffer = await readImageFile('/nonexistent/image.png');
      expect(buffer).toBeNull();
    });
  });

  describe('getImageMimeType', () => {
    test('returns correct MIME types', () => {
      expect(getImageMimeType('jpg')).toBe('image/jpeg');
      expect(getImageMimeType('jpeg')).toBe('image/jpeg');
      expect(getImageMimeType('png')).toBe('image/png');
      expect(getImageMimeType('gif')).toBe('image/gif');
      expect(getImageMimeType('webp')).toBe('image/webp');
    });
  });

  // ==========================================================================
  // OSC 52 and Base64 Image Detection Tests
  // ==========================================================================

  // Minimal valid 1x1 PNG image as base64 (68 bytes decoded)
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const VALID_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Minimal JPEG image as base64 (starts with /9j/)
  // JPEG magic bytes: FF D8 FF
  const VALID_JPEG_BASE64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

  // Minimal GIF image as base64 (starts with R0lGOD)
  // GIF magic bytes: 47 49 46 38 39 61 (GIF89a)
  const VALID_GIF_BASE64 =
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  // Minimal WebP image as base64 (starts with UklGR)
  // WebP magic bytes: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
  const VALID_WEBP_BASE64 =
    'UklGRlYAAABXRUJQVlA4IEoAAADwAQCdASoBAAEAAUAmJYgCdAEO/hOMAAD+8v7+/v7+/v7+/v7+/v4A';

  describe('detectOsc52Image', () => {
    test('detects OSC 52 with PNG image', () => {
      const osc52 = `\x1b]52;c;${VALID_PNG_BASE64}\x07`;
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
      expect(result.imageData).toBeDefined();
      expect(result.base64Data).toBe(VALID_PNG_BASE64);
    });

    test('detects OSC 52 with JPEG image', () => {
      const osc52 = `\x1b]52;c;${VALID_JPEG_BASE64}\x07`;
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('jpeg');
    });

    test('detects OSC 52 with GIF image', () => {
      const osc52 = `\x1b]52;c;${VALID_GIF_BASE64}\x07`;
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('gif');
    });

    test('detects OSC 52 with WebP image', () => {
      const osc52 = `\x1b]52;c;${VALID_WEBP_BASE64}\x07`;
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('webp');
    });

    test('detects OSC 52 with ST terminator', () => {
      const osc52 = `\x1b]52;c;${VALID_PNG_BASE64}\x1b\\`;
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
    });

    test('detects OSC 52 with primary selection (p)', () => {
      const osc52 = `\x1b]52;p;${VALID_PNG_BASE64}\x07`;
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(true);
    });

    test('returns false for non-OSC 52 text', () => {
      const result = detectOsc52Image('just regular text');
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for OSC 52 with invalid base64', () => {
      const osc52 = '\x1b]52;c;notvalidbase64!!!\x07';
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for OSC 52 with non-image data', () => {
      // Valid base64 but not image data
      const textBase64 = Buffer.from('Hello World').toString('base64');
      const osc52 = `\x1b]52;c;${textBase64}\x07`;
      const result = detectOsc52Image(osc52);
      expect(result.isBase64Image).toBe(false);
      expect(result.error).toBe('Not a recognized image format');
    });
  });

  describe('detectDataUriImage', () => {
    test('detects data URI with PNG', () => {
      const dataUri = `data:image/png;base64,${VALID_PNG_BASE64}`;
      const result = detectDataUriImage(dataUri);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
      expect(result.imageData).toBeDefined();
    });

    test('detects data URI with JPEG', () => {
      const dataUri = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`;
      const result = detectDataUriImage(dataUri);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('jpeg');
    });

    test('detects data URI with jpg (normalized to jpeg)', () => {
      const dataUri = `data:image/jpg;base64,${VALID_JPEG_BASE64}`;
      const result = detectDataUriImage(dataUri);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('jpeg');
    });

    test('detects data URI with GIF', () => {
      const dataUri = `data:image/gif;base64,${VALID_GIF_BASE64}`;
      const result = detectDataUriImage(dataUri);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('gif');
    });

    test('detects data URI with WebP', () => {
      const dataUri = `data:image/webp;base64,${VALID_WEBP_BASE64}`;
      const result = detectDataUriImage(dataUri);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('webp');
    });

    test('handles whitespace around data URI', () => {
      const dataUri = `  data:image/png;base64,${VALID_PNG_BASE64}  `;
      const result = detectDataUriImage(dataUri);
      expect(result.isBase64Image).toBe(true);
    });

    test('is case-insensitive for MIME type', () => {
      const dataUri = `data:IMAGE/PNG;base64,${VALID_PNG_BASE64}`;
      const result = detectDataUriImage(dataUri);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
    });

    test('returns false for non-data URI', () => {
      const result = detectDataUriImage('just regular text');
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for non-image data URI', () => {
      const result = detectDataUriImage('data:text/plain;base64,SGVsbG8=');
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for data URI with invalid base64', () => {
      const result = detectDataUriImage('data:image/png;base64,!!!invalid!!!');
      expect(result.isBase64Image).toBe(false);
    });
  });

  describe('detectRawBase64Image', () => {
    test('detects raw PNG base64', () => {
      const result = detectRawBase64Image(VALID_PNG_BASE64);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
    });

    test('detects raw JPEG base64', () => {
      const result = detectRawBase64Image(VALID_JPEG_BASE64);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('jpeg');
    });

    test('detects raw GIF base64', () => {
      const result = detectRawBase64Image(VALID_GIF_BASE64);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('gif');
    });

    test('detects raw WebP base64', () => {
      const result = detectRawBase64Image(VALID_WEBP_BASE64);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('webp');
    });

    test('returns false for short base64', () => {
      const result = detectRawBase64Image('abc123');
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for invalid base64 characters', () => {
      const result = detectRawBase64Image('!!!invalid base64 with special chars!!!');
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for valid base64 without image magic', () => {
      // Valid base64 of "Hello World, this is a test message"
      const textBase64 = 'SGVsbG8gV29ybGQsIHRoaXMgaXMgYSB0ZXN0IG1lc3NhZ2U=';
      const result = detectRawBase64Image(textBase64);
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for regular text', () => {
      const result = detectRawBase64Image('just some regular text');
      expect(result.isBase64Image).toBe(false);
    });
  });

  describe('detectBase64Image (unified)', () => {
    test('detects OSC 52 format', () => {
      const osc52 = `\x1b]52;c;${VALID_PNG_BASE64}\x07`;
      const result = detectBase64Image(osc52);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
    });

    test('detects data URI format', () => {
      const dataUri = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`;
      const result = detectBase64Image(dataUri);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('jpeg');
    });

    test('detects raw base64 format', () => {
      const result = detectBase64Image(VALID_GIF_BASE64);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('gif');
    });

    test('returns false for regular text (fallback)', () => {
      const result = detectBase64Image('This is just regular text to paste');
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for file paths (not base64)', () => {
      const result = detectBase64Image('/path/to/image.png');
      expect(result.isBase64Image).toBe(false);
    });

    test('returns false for empty string', () => {
      const result = detectBase64Image('');
      expect(result.isBase64Image).toBe(false);
    });
  });
});
