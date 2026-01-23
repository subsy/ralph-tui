/**
 * ABOUTME: Tests for buildBeadsLabelsInstruction helper.
 * Verifies case-insensitive dedup and label instruction formatting.
 */

import { describe, expect, test } from 'bun:test';
import { buildBeadsLabelsInstruction } from './PrdChatApp.js';

describe('buildBeadsLabelsInstruction', () => {
  test('returns empty string when trackerLabels is undefined', () => {
    expect(buildBeadsLabelsInstruction(undefined)).toBe('');
  });

  test('returns empty string when trackerLabels is empty array', () => {
    expect(buildBeadsLabelsInstruction([])).toBe('');
  });

  test('always includes ralph as first label', () => {
    const result = buildBeadsLabelsInstruction(['frontend']);
    expect(result).toContain('--labels "ralph,frontend"');
  });

  test('deduplicates ralph case-insensitively', () => {
    const result = buildBeadsLabelsInstruction(['Ralph', 'frontend']);
    expect(result).toContain('--labels "ralph,frontend"');
    expect(result).not.toContain('Ralph');
  });

  test('deduplicates RALPH uppercase variant', () => {
    const result = buildBeadsLabelsInstruction(['RALPH', 'backend']);
    expect(result).toContain('--labels "ralph,backend"');
    expect(result).not.toContain('RALPH');
  });

  test('deduplicates among user labels case-insensitively', () => {
    const result = buildBeadsLabelsInstruction(['Frontend', 'frontend', 'FRONTEND']);
    expect(result).toContain('--labels "ralph,Frontend"');
    // Only the first occurrence is kept
    expect(result.match(/frontend/gi)?.length).toBe(1);
  });

  test('preserves original casing of first occurrence', () => {
    const result = buildBeadsLabelsInstruction(['MyLabel', 'mylabel']);
    expect(result).toContain('ralph,MyLabel');
  });

  test('includes instruction text for bd/br create', () => {
    const result = buildBeadsLabelsInstruction(['test']);
    expect(result).toContain('IMPORTANT: Apply these labels to EVERY issue created');
    expect(result).toContain('Add the --labels flag to every bd create / br create command.');
  });

  test('handles multiple unique labels', () => {
    const result = buildBeadsLabelsInstruction(['frontend', 'backend', 'sprint-1']);
    expect(result).toContain('--labels "ralph,frontend,backend,sprint-1"');
  });

  test('handles label that is exactly ralph (lowercase)', () => {
    const result = buildBeadsLabelsInstruction(['ralph', 'other']);
    expect(result).toContain('--labels "ralph,other"');
    // ralph should appear exactly once in the labels string
    const match = result.match(/--labels "([^"]+)"/);
    expect(match).not.toBeNull();
    const labels = match![1].split(',');
    expect(labels.filter((l) => l.toLowerCase() === 'ralph')).toHaveLength(1);
  });
});
