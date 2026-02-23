/**
 * ABOUTME: Tracks cumulative token cost per session.
 * Uses model pricing lookup to estimate costs from token usage.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// Pricing in USD per 1M tokens (update as needed)
const MODEL_PRICING: Record<string, ModelPricing> = {
  'opus': { inputPer1M: 15.0, outputPer1M: 75.0 },
  'claude-opus-4-6': { inputPer1M: 15.0, outputPer1M: 75.0 },
  'sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'haiku': { inputPer1M: 0.80, outputPer1M: 4.0 },
  'claude-haiku-4-5': { inputPer1M: 0.80, outputPer1M: 4.0 },
};

export interface CostSnapshot {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterationCosts: number[];
}

export class CostTracker {
  private snapshot: CostSnapshot = {
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    iterationCosts: [],
  };

  addIteration(inputTokens: number, outputTokens: number, model?: string): number {
    const pricing = this.getPricing(model);
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    const iterationCost = inputCost + outputCost;

    this.snapshot.totalCost += iterationCost;
    this.snapshot.inputCost += inputCost;
    this.snapshot.outputCost += outputCost;
    this.snapshot.totalInputTokens += inputTokens;
    this.snapshot.totalOutputTokens += outputTokens;
    this.snapshot.iterationCosts.push(iterationCost);

    return iterationCost;
  }

  getSnapshot(): CostSnapshot {
    return { ...this.snapshot, iterationCosts: [...this.snapshot.iterationCosts] };
  }

  formatCost(): string {
    return `$${this.snapshot.totalCost.toFixed(4)}`;
  }

  private getPricing(model?: string): ModelPricing {
    if (!model) return MODEL_PRICING['sonnet']; // safe default
    // Try exact match, then prefix match
    const key = Object.keys(MODEL_PRICING).find(
      k => model === k || model.startsWith(k) || model.includes(k)
    );
    return key ? MODEL_PRICING[key] : MODEL_PRICING['sonnet'];
  }
}
