/**
 * ABOUTME: Tests for shared token usage extraction utilities.
 * Verifies parsing and aggregation across common JSONL usage payload formats.
 */

import { describe, expect, test } from 'bun:test';
import {
  extractModelFromJsonObject,
  extractTokenUsageFromJsonLine,
  normalizePercent,
  summarizeTokenUsageFromOutput,
  withContextWindow,
  TokenUsageAccumulator,
} from '../../../src/plugins/agents/usage.js';

describe('extractTokenUsageFromJsonLine', () => {
  test('extracts usage from codex turn.completed payload', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
      },
    });

    const usage = extractTokenUsageFromJsonLine(line);
    expect(usage).toBeDefined();
    expect(usage?.inputTokens).toBe(1200);
    expect(usage?.outputTokens).toBe(300);
  });

  test('extracts usage from gemini stats payload', () => {
    const line = JSON.stringify({
      type: 'result',
      stats: {
        total_tokens: 500,
        input_tokens: 350,
        output_tokens: 150,
      },
    });

    const usage = extractTokenUsageFromJsonLine(line);
    expect(usage).toBeDefined();
    expect(usage?.totalTokens).toBe(500);
    expect(usage?.inputTokens).toBe(350);
    expect(usage?.outputTokens).toBe(150);
  });

  test('returns undefined for invalid, empty, and non-JSON lines', () => {
    expect(extractTokenUsageFromJsonLine('')).toBeUndefined();
    expect(extractTokenUsageFromJsonLine('not-json')).toBeUndefined();
    expect(extractTokenUsageFromJsonLine('[]')).toBeUndefined();
    expect(extractTokenUsageFromJsonLine('{invalid')).toBeUndefined();
  });

  test('treats small max_tokens as generation limit, not context window', () => {
    const line = JSON.stringify({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        max_tokens: 4096,
      },
    });

    const usage = extractTokenUsageFromJsonLine(line);
    expect(usage).toBeDefined();
    expect(usage?.contextWindowTokens).toBeUndefined();
  });

  test('accepts large max_tokens as context window fallback', () => {
    const line = JSON.stringify({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        max_tokens: 128000,
      },
    });

    const usage = extractTokenUsageFromJsonLine(line);
    expect(usage).toBeDefined();
    expect(usage?.contextWindowTokens).toBe(128000);
  });
});

describe('TokenUsageAccumulator', () => {
  test('aggregates totals and computes context from fallback window', () => {
    const accumulator = new TokenUsageAccumulator();
    accumulator.add({ inputTokens: 600, outputTokens: 200 });
    accumulator.add({ inputTokens: 300, outputTokens: 100 });

    const summary = withContextWindow(accumulator.getSummary(), 5000);
    expect(summary.inputTokens).toBe(900);
    expect(summary.outputTokens).toBe(300);
    expect(summary.totalTokens).toBe(1200);
    expect(summary.contextWindowTokens).toBe(5000);
    expect(summary.remainingContextTokens).toBe(3800);
    expect(summary.remainingContextPercent).toBeCloseTo(76, 1);
  });

  test('reset clears totals and context fields', () => {
    const accumulator = new TokenUsageAccumulator();
    accumulator.add({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      contextWindowTokens: 1000,
      remainingContextTokens: 985,
      remainingContextPercent: 98.5,
    });

    accumulator.reset();
    const summary = accumulator.getSummary();

    expect(summary.inputTokens).toBe(0);
    expect(summary.outputTokens).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.contextWindowTokens).toBeUndefined();
    expect(summary.remainingContextTokens).toBeUndefined();
    expect(summary.remainingContextPercent).toBeUndefined();
    expect(summary.events).toBe(0);
  });
});

describe('summarizeTokenUsageFromOutput', () => {
  test('summarizes mixed JSONL usage lines', () => {
    const output = [
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } }),
      JSON.stringify({ type: 'result', stats: { input_tokens: 200, output_tokens: 80 } }),
    ].join('\n');

    const summary = summarizeTokenUsageFromOutput(output);
    expect(summary).toBeDefined();
    expect(summary?.inputTokens).toBe(300);
    expect(summary?.outputTokens).toBe(130);
    expect(summary?.totalTokens).toBe(430);
  });

  test('summarizes total-only usage lines', () => {
    const output = [
      JSON.stringify({ usage: { total_tokens: 200 } }),
      JSON.stringify({ stats: { total_tokens: 300 } }),
    ].join('\n');

    const summary = summarizeTokenUsageFromOutput(output);
    expect(summary).toBeDefined();
    expect(summary?.inputTokens).toBe(0);
    expect(summary?.outputTokens).toBe(0);
    expect(summary?.totalTokens).toBe(500);
  });
});

describe('extractModelFromJsonObject', () => {
  test('extracts provider/model from nested payload', () => {
    const model = extractModelFromJsonObject({
      type: 'turn.completed',
      result: {
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-20250219',
      },
    });

    expect(model).toBe('anthropic/claude-3-7-sonnet-20250219');
  });

  test('extracts plain model when provider is absent', () => {
    const model = extractModelFromJsonObject({
      event: {
        model_name: 'gpt-5',
      },
    });

    expect(model).toBe('gpt-5');
  });
});

describe('normalizePercent', () => {
  test('converts fractional values to percent', () => {
    expect(normalizePercent(0.76)).toBeCloseTo(76, 5);
  });

  test('keeps already-percent values as-is', () => {
    expect(normalizePercent(76)).toBe(76);
  });
});
