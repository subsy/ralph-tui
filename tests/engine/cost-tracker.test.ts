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
  'haiku': { inputPer1M: 1.0, outputPer1M: 5.0 },
  'claude-haiku-4-5': { inputPer1M: 1.0, outputPer1M: 5.0 },
};

describe('CostTracker', () => {
  it('prefers the longest pricing identifier regardless of insertion order', () => {
    for (const pricing of [
      { opus: { inputPer1M: 1, outputPer1M: 2 }, 'claude-opus-4-6': { inputPer1M: 5, outputPer1M: 25 } },
      { 'claude-opus-4-6': { inputPer1M: 5, outputPer1M: 25 }, opus: { inputPer1M: 1, outputPer1M: 2 } },
    ]) {
      const tracker = new CostTracker(pricing);
      expect(tracker.addIteration(1_000_000, 1_000_000, 'anthropic/claude-opus-4-6-20260205')).toBe(30);
      expect(tracker.addIteration(1_000_000, 0, 'opus')).toBe(1);
    }
  });

  it('retains configured tier aliases within provider and model identifiers', () => {
    const tracker = new CostTracker({ opus: { inputPer1M: 5, outputPer1M: 25 } });
    expect(tracker.addIteration(1_000_000, 0, 'anthropic/claude-opus-4-6')).toBe(5);
  });

  it.each(['octopus', 'opuslite', 'myopus-v1', 'opus2', 'λopus', 'opusλ'])(
    'does not price unrelated identifier %s as the opus tier', model => {
      const tracker = new CostTracker({ opus: { inputPer1M: 3, outputPer1M: 3 } });
      expect(tracker.addIteration(1_000_000, 0, model)).toBe(0);
    },
  );

  it.each(['opus', 'anthropic/opus', 'claude-opus-4-6', 'provider:opus', 'provider.opus', 'provider_opus', 'opus@latest'])(
    'preserves delimiter-bounded alias %s', model => {
      const tracker = new CostTracker({ opus: { inputPer1M: 3, outputPer1M: 3 } });
      expect(tracker.addIteration(1_000_000, 0, model)).toBe(3);
    },
  );

  it('treats pricing identifiers as literal strings rather than regex patterns', () => {
    const tracker = new CostTracker({ 'model.1': { inputPer1M: 3, outputPer1M: 3 } });
    expect(tracker.addIteration(1_000_000, 0, 'provider/model.1-v2')).toBe(3);
    expect(tracker.addIteration(1_000_000, 0, 'provider/modelx1-v2')).toBe(0);
  });

  it('does not treat inherited object properties as configured model prices', () => {
    const tracker = new CostTracker({ opus: { inputPer1M: 5, outputPer1M: 25 } });
    expect(tracker.addIteration(1_000_000, 0, 'constructor')).toBe(0);
    expect(tracker.addIteration(1_000_000, 0, 'toString')).toBe(0);
  });

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

  it('haiku pricing: 1M input tokens = $1.00', () => {
    tracker.addIteration(1_000_000, 0, 'claude-haiku-4-5');
    const snapshot = tracker.getSnapshot();
    expect(snapshot.inputCost).toBeCloseTo(1.0);
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

  it('matches a configured tier alias exactly', () => {
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
