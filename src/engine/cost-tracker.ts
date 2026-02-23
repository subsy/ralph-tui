/**
 * ABOUTME: Tracks cumulative token cost per session.
 * Accepts user-supplied model pricing to estimate costs from token usage.
 * No built-in pricing table — configure via CostConfig.pricing to avoid stale data.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export interface CostSnapshot {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterationCosts: number[];
}

export class CostTracker {
  private pricing: Record<string, ModelPricing>;
  private snapshot: CostSnapshot = {
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    iterationCosts: [],
  };

  /**
   * @param pricing Optional model pricing map. When omitted, token counts are
   *   tracked but dollar costs remain 0. Configure via `cost.pricing` in your
   *   ralph.config.toml to enable cost estimation.
   */
  constructor(pricing: Record<string, ModelPricing> = {}) {
    this.pricing = pricing;
  }

  addIteration(inputTokens: number, outputTokens: number, model?: string): number {
    const pricing = this.getPricing(model);
    const inputCost = pricing ? (inputTokens / 1_000_000) * pricing.inputPer1M : 0;
    const outputCost = pricing ? (outputTokens / 1_000_000) * pricing.outputPer1M : 0;
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

  private getPricing(model?: string): ModelPricing | null {
    if (!model || Object.keys(this.pricing).length === 0) return null;
    // Exact match first
    if (this.pricing[model]) return this.pricing[model];
    // Substring match: find a key whose name appears in the model string
    const key = Object.keys(this.pricing).find(k => model.includes(k));
    return key ? this.pricing[key] : null;
  }
}
