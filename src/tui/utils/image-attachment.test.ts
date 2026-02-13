/**
 * ABOUTME: Tests for image attachment utilities.
 * Verifies image detection, storage, and marker generation.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { storeImageFromBuffer, deleteStoredImage } from './image-storage.js';
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
      const pngData =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = detectBase64Image(pngData);
      expect(result.isBase64Image).toBe(true);
      expect(result.extension).toBe('png');
    });

    test('detects JPEG base64 data', () => {
      // JPEG magic bytes: FF D8 FF (must be at least 12 bytes for validation)
      // This is a minimal valid JPEG header encoded as base64
      const jpegBytes = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01,
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
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
        0x08,
        0x06,
        0x00,
        0x00,
        0x00,
        0x1f,
        0x15,
        0xc4,
        0x89,
        0x00,
        0x00,
        0x00,
        0x0a,
        0x49,
        0x44,
        0x41,
        0x54,
        0x78,
        0x9c,
        0x63,
        0x00,
        0x01,
        0x00,
        0x00,
        0x05,
        0x00,
        0x01,
        0x0d,
        0x0a,
        0x2d,
        0xb4,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4e,
        0x44,
        0xae,
        0x42,
        0x60,
        0x82,
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
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);

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

    test('rejects relative path traversal attempts', async () => {
      const deleted = await deleteStoredImage('../../etc/passwd', testDir);
      expect(deleted).toBe(false);
    });

    test('rejects absolute paths outside storage directory', async () => {
      const outsidePath = join(testDir, 'outside.png');
      await writeFile(outsidePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const deleted = await deleteStoredImage(outsidePath);
      expect(deleted).toBe(false);
      expect(await Bun.file(outsidePath).exists()).toBe(true);
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

  test('double digit markers have correct length', () => {
    // Ensure we handle double/triple digit numbers correctly
    expect('[Image 1]'.length).toBe(9); // [Image 1] = 9 chars
    expect('[Image 10]'.length).toBe(10); // [Image 10] = 10 chars
    expect('[Image 99]'.length).toBe(10);
    expect('[Image 100]'.length).toBe(11);
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

describe('Marker Remnant Cleanup Patterns', () => {
  /**
   * Helper to simulate the removeMarkerRemnants logic from ChatView.tsx
   * This tests the regex patterns used to clean up corrupted markers
   */
  const removeMarkerRemnants = (text: string, imageNum: number): string => {
    let result = text;

    const patterns = [
      // Full or partial marker with this number (with opening bracket)
      new RegExp(`\\[Image\\s*${imageNum}\\s*\\]?`, 'g'),
      // Missing opening bracket: "Image N]" or "Image N" - must be at word boundary
      new RegExp(`(?<=^|\\s)Image\\s*${imageNum}\\s*\\]?(?=\\s|$)`, 'g'),
      // Just the number with brackets
      new RegExp(`\\[\\s*${imageNum}\\s*\\]`, 'g'),
      // Just "N]" at word boundary
      new RegExp(`(?<![\\w])${imageNum}\\s*\\]`, 'g'),
      // Orphaned [Image that's not part of a valid marker
      // Must check that it's not followed by space+digit+]
      /\[Image(?!\s+\d+\])/g,
    ];

    for (const pattern of patterns) {
      result = result.replace(pattern, (match) => {
        // Don't remove if it's a complete valid marker for a DIFFERENT image
        const validMarkerMatch = match.match(/^\[Image (\d+)\]$/);
        if (
          validMarkerMatch &&
          parseInt(validMarkerMatch[1], 10) !== imageNum
        ) {
          return match;
        }
        return '';
      });
    }

    result = result.replace(/\s{2,}/g, ' ').trim();
    return result;
  };

  test('removes complete marker', () => {
    expect(removeMarkerRemnants('hello [Image 1] world', 1)).toBe(
      'hello world',
    );
  });

  test('removes marker missing closing bracket', () => {
    expect(removeMarkerRemnants('hello [Image 1 world', 1)).toBe('hello world');
  });

  test('removes marker missing opening bracket', () => {
    expect(removeMarkerRemnants('hello Image 1] world', 1)).toBe('hello world');
  });

  test('removes orphaned [Image after word deletion', () => {
    // After word deletion of "1]" from "[Image 1]"
    expect(removeMarkerRemnants('hello [Image world', 1)).toBe('hello world');
  });

  test('removes just number with bracket', () => {
    expect(removeMarkerRemnants('hello 1] world', 1)).toBe('hello world');
  });

  test('preserves markers for other images', () => {
    // When cleaning up image 1, should keep image 2
    expect(removeMarkerRemnants('hello [Image 1] [Image 2] world', 1)).toBe(
      'hello [Image 2] world',
    );
  });

  test('handles text with extra brackets around marker', () => {
    // [[Image 1] - the [Image 1] part is removed, leaving [
    const result = removeMarkerRemnants('[[Image 1]', 1);
    expect(result).toBe('[');
  });

  test('handles double digit image numbers', () => {
    expect(removeMarkerRemnants('hello [Image 10] world', 10)).toBe(
      'hello world',
    );
    expect(removeMarkerRemnants('hello Image 10] world', 10)).toBe(
      'hello world',
    );
  });

  test('does not affect unrelated text', () => {
    expect(removeMarkerRemnants('hello world', 1)).toBe('hello world');
    // "Image" as part of regular text should not be removed
    expect(removeMarkerRemnants('Image processing is fun', 1)).toBe(
      'Image processing is fun',
    );
  });

  test('cleans up multiple spaces after removal', () => {
    expect(removeMarkerRemnants('hello   [Image 1]   world', 1)).toBe(
      'hello world',
    );
  });
});

describe('Marker Validation', () => {
  /**
   * Helper to simulate isValidMarker logic from ChatView.tsx
   */
  const isValidMarker = (
    text: string,
    startIndex: number,
    endIndex: number,
    imageNum: number,
  ): boolean => {
    if (text[startIndex] !== '[' || text[endIndex] !== ']') {
      return false;
    }

    const content = text.slice(startIndex, endIndex + 1);
    if (content !== `[Image ${imageNum}]`) {
      return false;
    }

    return true;
  };

  test('validates correct marker', () => {
    // 'hello [Image 1] world'
    //  01234567890123456789
    //        ^      ^
    //        6      14 (endIndex is position of ], which is 6+8=14)
    const text = 'hello [Image 1] world';
    expect(isValidMarker(text, 6, 14, 1)).toBe(true);
  });

  test('rejects marker with wrong number', () => {
    const text = 'hello [Image 2] world';
    expect(isValidMarker(text, 6, 14, 1)).toBe(false);
  });

  test('rejects marker missing opening bracket', () => {
    const text = 'hello Image 1] world';
    expect(isValidMarker(text, 6, 13, 1)).toBe(false);
  });

  test('rejects marker missing closing bracket', () => {
    const text = 'hello [Image 1 world';
    expect(isValidMarker(text, 6, 13, 1)).toBe(false);
  });

  test('allows extra brackets before marker', () => {
    // '[[Image 1]'
    //  0123456789
    //   ^       ^
    //   1       9
    const text = '[[Image 1]';
    expect(isValidMarker(text, 1, 9, 1)).toBe(true);
  });

  test('allows extra brackets after marker', () => {
    // '[Image 1]]'
    //  0123456789
    //  ^       ^
    //  0       8
    const text = '[Image 1]]';
    expect(isValidMarker(text, 0, 8, 1)).toBe(true);
  });

  test('validates double digit markers', () => {
    // 'hello [Image 10] world'
    //  0123456789012345678901
    //        ^        ^
    //        6        15
    const text = 'hello [Image 10] world';
    expect(isValidMarker(text, 6, 15, 10)).toBe(true);
  });
});
