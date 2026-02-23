/**
 * ABOUTME: Tests for the CostTracker class.
 * Verifies model-aware pricing, accumulation, threshold detection, and formatting.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CostTracker } from '../../src/engine/cost-tracker.js';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it('opus pricing: 1M input tokens = $15.00', () => {
    tracker.addIteration(1_000_000, 0, 'claude-opus-4-6');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(15.0);
  });

  it('sonnet pricing: 1M input tokens = $3.00', () => {
    tracker.addIteration(1_000_000, 0, 'claude-sonnet-4-6');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(3.0);
  });

  it('haiku pricing: 1M input tokens = $0.80', () => {
    tracker.addIteration(1_000_000, 0, 'claude-haiku-4-5');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(0.8);
  });

  it('unknown model falls back to sonnet pricing', () => {
    tracker.addIteration(1_000_000, 0, 'unknown-model-xyz');
    const snapshot = tracker.getSnapshot();
    // Sonnet input: $3.00 per 1M
    expect(snapshot.inputCost).toBeCloseTo(3.0);
  });

  it('undefined model falls back to sonnet pricing', () => {
    tracker.addIteration(1_000_000, 0, undefined);
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(3.0);
  });

  it('multiple iterations accumulate correctly', () => {
    // First iteration: 100k input + 50k output at sonnet pricing
    tracker.addIteration(100_000, 50_000, 'claude-sonnet-4-6');
    // Second iteration: 200k input + 100k output at sonnet pricing
    tracker.addIteration(200_000, 100_000, 'claude-sonnet-4-6');

    const snapshot = tracker.getSnapshot();

    const expectedInputCost = (300_000 / 1_000_000) * 3.0;
    const expectedOutputCost = (150_000 / 1_000_000) * 15.0;
    const expectedTotal = expectedInputCost + expectedOutputCost;

    expect(snapshot.totalInputTokens).toBe(300_000);
    expect(snapshot.totalOutputTokens).toBe(150_000);
    expect(snapshot.totalCost).toBeCloseTo(expectedTotal);
    expect(snapshot.iterationCosts).toHaveLength(2);
  });

  it('formatCost() returns readable dollar string', () => {
    tracker.addIteration(100_000, 50_000, 'claude-sonnet-4-6');
    const formatted = tracker.formatCost();
    expect(formatted).toMatch(/^\$\d+\.\d{4}$/);
  });

  it('returns zero cost for zero tokens', () => {
    const iterationCost = tracker.addIteration(0, 0, 'claude-opus-4-6');
    expect(iterationCost).toBe(0);
    expect(tracker.getSnapshot().totalCost).toBe(0);
  });

  it('matches prefix model identifiers (e.g. "opus" prefix matches opus pricing)', () => {
    tracker.addIteration(1_000_000, 0, 'opus');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(15.0);
  });

  it('snapshot is a copy (mutation does not affect tracker state)', () => {
    tracker.addIteration(100_000, 50_000, 'claude-sonnet-4-6');
    const snapshot = tracker.getSnapshot();
    const originalTotal = snapshot.totalCost;
    snapshot.totalCost = 9999;
    // The tracker's internal state should be unchanged
    expect(tracker.getSnapshot().totalCost).toBeCloseTo(originalTotal);
  });
});
