/**
 * ABOUTME: Regression tests for RightPanel component text rendering.
 * Ensures headers use span elements correctly (no nested text components).
 *
 * OpenTUI text rendering rules:
 * ✅ CORRECT: <text><span fg="color1">Part 1</span><span fg="color2">Part 2</span></text>
 * ❌ WRONG:   <text fg="color1">Part 1 <text fg="color2">Part 2</text></text>
 *
 * The wrong pattern throws: "TextNodeRenderable only accepts strings,
 * TextNodeRenderable instances, or StyledText instances"
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

describe('RightPanel text rendering', () => {
  test('prevents regression: span elements must be used for multi-colored headers', () => {
    // NOTE: This test intentionally reads source code to prevent a specific bug pattern.
    // While fragile to formatting changes, it's a deliberate tradeoff to catch the
    // nested <text> bug that causes runtime errors in OpenTUI.

    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const source = readFileSync(join(currentDir, 'RightPanel.tsx'), 'utf-8');

    // Verify we use span elements for multi-colored text in headers
    expect(source).toContain('<span fg={colors.fg.secondary}>Worker: </span>');
    expect(source).toContain('<span fg={colors.fg.primary}>{agentName');
    expect(source).toContain('<span fg={colors.fg.secondary}>Reviewer: </span>');
    expect(source).toContain('<span fg={colors.fg.primary}>{reviewerAgent');

    // Verify worker/reviewer headers DON'T have invalid nested text pattern
    const invalidWorkerPattern = /<text[^>]*>\s*Worker:.*<text/;
    const invalidReviewerPattern = /<text[^>]*>\s*Reviewer:.*<text/;

    expect(invalidWorkerPattern.test(source)).toBe(false);
    expect(invalidReviewerPattern.test(source)).toBe(false);
  });
});
