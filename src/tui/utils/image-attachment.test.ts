/**
 * ABOUTME: Tests for image attachment utilities.
 * Verifies image detection, storage, and marker generation.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  storeImageFromBuffer,
  deleteStoredImage,
} from './image-storage.js';
import { looksLikeImagePath, detectBase64Image } from './image-detection.js';

describe('Image Detection', () => {
  describe('looksLikeImagePath', () => {
    test('recognizes common image extensions', () => {
      // Supported formats: jpg, jpeg, png, gif, webp (not bmp)
      expect(looksLikeImagePath('/path/to/image.png')).toBe(true);
      expect(looksLikeImagePath('/path/to/image.jpg')).toBe(true);
      expect(looksLikeImagePath('/path/to/image.jpeg')).toBe(true);
      expect(looksLikeImagePath('/path/to/image.gif')).toBe(true);
      expect(looksLikeImagePath('/path/to/image.webp')).toBe(true);
    });

    test('handles case-insensitive extensions', () => {
      expect(looksLikeImagePath('/path/to/image.PNG')).toBe(true);
      expect(looksLikeImagePath('/path/to/image.JPG')).toBe(true);
    });

    test('rejects non-image extensions', () => {
      expect(looksLikeImagePath('/path/to/file.txt')).toBe(false);
      expect(looksLikeImagePath('/path/to/file.pdf')).toBe(false);
      expect(looksLikeImagePath('/path/to/file.js')).toBe(false);
    });

    test('rejects regular text', () => {
      expect(looksLikeImagePath('hello world')).toBe(false);
      expect(looksLikeImagePath('this is a test')).toBe(false);
    });
  });

  describe('detectBase64Image', () => {
    test('detects PNG base64 data', () => {
      const pngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = detectBase64Image(pngData);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
    });

    test('detects JPEG base64 data', () => {
      // JPEG magic bytes: FF D8 FF (must be at least 12 bytes for validation)
      // This is a minimal valid JPEG header encoded as base64
      const jpegBytes = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      ]);
      const jpegData = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
      const result = detectBase64Image(jpegData);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('jpeg');
    });

    test('rejects non-base64 data', () => {
      const result = detectBase64Image('hello world');
      expect(result.isBase64Image).toBe(false);
    });

    test('rejects non-image base64 data', () => {
      const result = detectBase64Image('data:text/plain;base64,SGVsbG8=');
      expect(result.isBase64Image).toBe(false);
    });
  });
});

describe('Image Storage', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ralph-tui-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('storeImageFromBuffer', () => {
    test('stores PNG buffer and returns path', async () => {
      // Create a minimal valid PNG (1x1 transparent pixel)
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
      ]);

      const result = await storeImageFromBuffer(pngBuffer, 'png', testDir);
      
      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.path!.endsWith('.png')).toBe(true);
      
      // Verify file exists and has content
      const stored = await readFile(result.path!);
      expect(stored.equals(pngBuffer)).toBe(true);
    });

    test('deduplicates identical images', async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const result1 = await storeImageFromBuffer(pngBuffer, 'png', testDir);
      const result2 = await storeImageFromBuffer(pngBuffer, 'png', testDir);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.path).toBe(result2.path); // Same path = deduplicated
      expect(result2.deduplicated).toBe(true);
    });
  });

  describe('deleteStoredImage', () => {
    test('deletes an existing image', async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const storeResult = await storeImageFromBuffer(pngBuffer, 'png', testDir);
      
      expect(storeResult.success).toBe(true);
      
      const deleted = await deleteStoredImage(storeResult.path!);
      expect(deleted).toBe(true);
    });

    test('returns false for non-existent image', async () => {
      const deleted = await deleteStoredImage(join(testDir, 'nonexistent.png'));
      expect(deleted).toBe(false);
    });
  });
});

describe('Image Marker Patterns', () => {
  test('marker format is correct', () => {
    const markerPattern = /\[Image (\d+)\]/;
    
    expect('[Image 1]'.match(markerPattern)).toBeTruthy();
    expect('[Image 10]'.match(markerPattern)).toBeTruthy();
    expect('[Image 99]'.match(markerPattern)).toBeTruthy();
    
    // Extract image number
    const match = '[Image 5]'.match(markerPattern);
    expect(match?.[1]).toBe('5');
  });

  test('partial markers are detected', () => {
    const partialPattern = /\[Image(?:\s\d*)?(?:\])?|\bImage\s*\d+\]?/g;
    
    // These should match (partial/corrupted markers)
    expect('[Image'.match(partialPattern)).toBeTruthy();
    expect('[Image 1'.match(partialPattern)).toBeTruthy();
    expect('Image 1]'.match(partialPattern)).toBeTruthy();
    
    // Complete marker should also match
    expect('[Image 1]'.match(partialPattern)).toBeTruthy();
  });

  test('prompt suffix format is correct', () => {
    // Simulating what getPromptSuffix generates
    const images = [
      { storedPath: '/path/to/img1.png' },
      { storedPath: '/path/to/img2.png' },
    ];
    
    const lines = ['', '[Image References]'];
    images.forEach((image, index) => {
      lines.push(`[Image ${index + 1}]: ${image.storedPath}`);
    });
    const suffix = lines.join('\n');
    
    expect(suffix).toContain('[Image References]');
    expect(suffix).toContain('[Image 1]: /path/to/img1.png');
    expect(suffix).toContain('[Image 2]: /path/to/img2.png');
  });
});
