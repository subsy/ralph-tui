/**
 * ABOUTME: Tests for the CostTracker class.
 * Verifies user-supplied pricing, accumulation, threshold detection, and formatting.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CostTracker, type ModelPricing } from '../../src/engine/cost-tracker.js';

// Example pricing — mirrors what a user would configure in ralph.config.toml
const TEST_PRICING: Record<string, ModelPricing> = {
  'opus': { inputPer1M: 5.0, outputPer1M: 25.0 },
  'claude-opus-4-6': { inputPer1M: 5.0, outputPer1M: 25.0 },
  'sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'haiku': { inputPer1M: 0.80, outputPer1M: 4.0 },
  'claude-haiku-4-5': { inputPer1M: 0.80, outputPer1M: 4.0 },
};

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker(TEST_PRICING);
  });

  it('opus pricing: 1M input tokens = $5.00', () => {
    tracker.addIteration(1_000_000, 0, 'claude-opus-4-6');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(5.0);
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

  it('unknown model returns zero cost when no matching pricing entry', () => {
    tracker.addIteration(1_000_000, 0, 'unknown-model-xyz');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBe(0);
    expect(snapshot.totalCost).toBe(0);
  });

  it('undefined model returns zero cost', () => {
    tracker.addIteration(1_000_000, 0, undefined);
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBe(0);
    expect(snapshot.totalCost).toBe(0);
  });

  it('no pricing configured: all costs are zero, tokens still tracked', () => {
    const unpricedTracker = new CostTracker();
    unpricedTracker.addIteration(100_000, 50_000, 'claude-opus-4-6');
    const snapshot = unpricedTracker.getSnapshot();
    expect(snapshot.totalCost).toBe(0);
    expect(snapshot.totalInputTokens).toBe(100_000);
    expect(snapshot.totalOutputTokens).toBe(50_000);
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

  it('matches substring model identifiers (e.g. "opus" in model name)', () => {
    tracker.addIteration(1_000_000, 0, 'opus');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(5.0);
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
