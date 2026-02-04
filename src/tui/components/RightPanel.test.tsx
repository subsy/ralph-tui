/**
 * ABOUTME: Tests for RightPanel component text rendering.
 * Ensures headers use span elements correctly (no nested text components).
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

describe('RightPanel text rendering', () => {
  test('ensures span elements are used for multi-colored headers (not nested text)', () => {
    // This is a documentation test that verifies the code pattern
    // OpenTUI requires: <text><span fg="...">Label: </span><span fg="...">Value</span></text>
    // NOT: <text fg="...">Label: <text fg="...">Value</text></text>

    // Read RightPanel source to verify correct pattern
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const source = readFileSync(join(currentDir, 'RightPanel.tsx'), 'utf-8');

    // Verify we use span elements for multi-colored text in headers
    expect(source).toContain('<span fg={colors.fg.secondary}>Worker: </span>');
    expect(source).toContain('<span fg={colors.fg.primary}>{agentName');
    expect(source).toContain('<span fg={colors.fg.secondary}>Reviewer: </span>');
    expect(source).toContain('<span fg={colors.fg.primary}>{reviewerAgent');

    // Verify worker/reviewer headers DON'T have invalid nested pattern:
    // <text fg="...">Worker: <text fg="...">...</text></text>
    const invalidWorkerPattern = /<text[^>]*>\s*Worker:.*<text/;
    const invalidReviewerPattern = /<text[^>]*>\s*Reviewer:.*<text/;

    expect(invalidWorkerPattern.test(source)).toBe(false);
    expect(invalidReviewerPattern.test(source)).toBe(false);
  });

  test('documents the OpenTUI text rendering rules', () => {
    // OpenTUI rules for multi-colored text:
    // ✅ CORRECT: <text><span fg="color1">Part 1</span><span fg="color2">Part 2</span></text>
    // ❌ WRONG:   <text fg="color1">Part 1 <text fg="color2">Part 2</text></text>
    //
    // The wrong pattern throws: "TextNodeRenderable only accepts strings,
    // TextNodeRenderable instances, or StyledText instances"

    expect(true).toBe(true); // Documentation test
  });
});
