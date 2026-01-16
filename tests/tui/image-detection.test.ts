/**
 * ABOUTME: Tests for image file path detection utility.
 * Tests image path pattern matching, file existence validation, and edge cases.
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
});
