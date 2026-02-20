/**
 * ABOUTME: Shared token usage extraction and accumulation utilities for agent JSONL output.
 * Parses heterogeneous usage/cost payloads emitted by different agent CLIs and provides
 * normalized task-level totals for input/output/total tokens plus optional context metrics.
 */

/**
 * A single usage sample extracted from one JSONL event.
 */
export interface TokenUsageSample {
  /** Input/prompt tokens for this sample */
  inputTokens?: number;
  /** Output/completion tokens for this sample */
  outputTokens?: number;
  /** Total tokens for this sample (if explicitly reported) */
  totalTokens?: number;
  /** Context window size in tokens (if reported) */
  contextWindowTokens?: number;
  /** Remaining context tokens (if reported) */
  remainingContextTokens?: number;
  /** Remaining context percentage (0-100) (if reported) */
  remainingContextPercent?: number;
}

/**
 * Aggregated usage summary for a task/stream.
 */
export interface TokenUsageSummary {
  /** Total input tokens accumulated across events */
  inputTokens: number;
  /** Total output tokens accumulated across events */
  outputTokens: number;
  /** Total tokens accumulated across events */
  totalTokens: number;
  /** Latest reported context window size (if available) */
  contextWindowTokens?: number;
  /** Latest reported remaining context tokens (if available) */
  remainingContextTokens?: number;
  /** Latest/computed remaining context percentage (0-100) (if available) */
  remainingContextPercent?: number;
  /** Number of usage events aggregated */
  events: number;
}

type JsonRecord = Record<string, unknown>;

const TOKEN_INPUT_KEYS = [
  'inputTokens',
  'input_tokens',
  'promptTokens',
  'prompt_tokens',
] as const;

const TOKEN_OUTPUT_KEYS = [
  'outputTokens',
  'output_tokens',
  'completionTokens',
  'completion_tokens',
] as const;

const TOKEN_TOTAL_KEYS = [
  'totalTokens',
  'total_tokens',
  'tokens',
] as const;

const CONTEXT_WINDOW_KEYS = [
  'contextWindowTokens',
  'context_window_tokens',
  'contextWindow',
  'context_window',
  'maxContextTokens',
  'max_context_tokens',
] as const;

const CONTEXT_WINDOW_LIMIT_KEYS = [
  'maxTokens',
  'max_tokens',
] as const;

const CONTEXT_REMAINING_KEYS = [
  'remainingContextTokens',
  'remaining_context_tokens',
  'contextRemainingTokens',
  'context_remaining_tokens',
  'remainingTokens',
  'remaining_tokens',
] as const;

const CONTEXT_REMAINING_PERCENT_KEYS = [
  'remainingContextPercent',
  'remaining_context_percent',
  'contextRemainingPercent',
  'context_remaining_percent',
  'remainingPercent',
  'remaining_percent',
  'contextRemainingPct',
  'context_remaining_pct',
] as const;

const USAGE_NESTED_KEYS = [
  'usage',
  'usage_stats',
  'cost',
  'stats',
  'metrics',
  'message',
  'result',
  'data',
  'turn',
  'raw',
] as const;

const MODEL_VALUE_KEYS = [
  'model',
  'model_slug',
  'modelSlug',
  'model_name',
  'modelName',
  'model_id',
  'modelId',
  'selected_model',
  'selectedModel',
  'current_model',
  'currentModel',
  'assistant_model',
  'assistantModel',
] as const;

const MODEL_PROVIDER_KEYS = [
  'provider',
  'provider_name',
  'providerName',
  'provider_id',
  'providerId',
  'vendor',
] as const;

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value === 'object' && value !== null) {
    return value as JsonRecord;
  }
  return null;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readFirstNumber(record: JsonRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readFirstString(record: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeModelString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    return undefined;
  }
  // Keep model values conservative to avoid picking tool names or random prose.
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * normalizePercent() accepts either percent values (0-100) or fractions (0-1).
 * Heuristic: values in (0, 1] are treated as fractions and multiplied by 100.
 * Limitation: an input like 0.5 intended as 0.5% is interpreted as 50%.
 * Callers should pass the intended unit consistently (0-100 or 0-1), or normalize beforehand.
 */
export function normalizePercent(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const asPercent = value > 0 && value <= 1 ? value * 100 : value;
  if (!Number.isFinite(asPercent)) {
    return undefined;
  }
  return Math.min(100, Math.max(0, asPercent));
}

function readContextWindowTokens(record: JsonRecord): number | undefined {
  const directContextWindow = readFirstNumber(record, CONTEXT_WINDOW_KEYS);
  if (directContextWindow !== undefined) {
    return directContextWindow;
  }

  // Some payloads use maxTokens/max_tokens for generation limits instead of model context windows.
  // Treat these keys as context windows only when the value is large enough to plausibly represent
  // a model context size rather than a per-response output cap.
  const contextLikeMaxTokens = readFirstNumber(record, CONTEXT_WINDOW_LIMIT_KEYS);
  if (contextLikeMaxTokens !== undefined && contextLikeMaxTokens > 10_000) {
    return contextLikeMaxTokens;
  }

  return undefined;
}

function hasUsageSignal(record: JsonRecord): boolean {
  const keys = new Set(Object.keys(record));
  const signalGroups = [
    TOKEN_INPUT_KEYS,
    TOKEN_OUTPUT_KEYS,
    TOKEN_TOTAL_KEYS,
    CONTEXT_WINDOW_KEYS,
    CONTEXT_WINDOW_LIMIT_KEYS,
    CONTEXT_REMAINING_KEYS,
    CONTEXT_REMAINING_PERCENT_KEYS,
  ] as const;
  for (const group of signalGroups) {
    for (const key of group) {
      if (keys.has(key)) {
        return true;
      }
    }
  }
  return false;
}

function collectUsageRecords(value: unknown, out: JsonRecord[], depth: number): void {
  if (depth > 4) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUsageRecords(item, out, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  if (hasUsageSignal(record)) {
    out.push(record);
  }

  for (const key of USAGE_NESTED_KEYS) {
    const nested = record[key];
    if (nested !== undefined) {
      collectUsageRecords(nested, out, depth + 1);
    }
  }

  // Some agent formats embed payload arrays under "content" or "parts".
  if (record.content !== undefined) {
    collectUsageRecords(record.content, out, depth + 1);
  }
  if (record.parts !== undefined) {
    collectUsageRecords(record.parts, out, depth + 1);
  }
}

function scoreDetectedModel(model: string): number {
  let score = model.includes('/') ? 5 : 0;
  if (model.includes('claude') || model.includes('gpt') || model.includes('gemini')) {
    score += 3;
  }
  if (model.length >= 8) {
    score += 1;
  }
  return score;
}

/**
 * Extract model identifier from a parsed JSON object.
 * Best-effort scan over nested payload fields commonly emitted by agent CLIs.
 */
export function extractModelFromJsonObject(payload: JsonRecord): string | undefined {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  let bestMatch: string | undefined;
  let bestScore = -1;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }

    const { value, depth } = next;
    if (depth > 4) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        queue.push({ value: item, depth: depth + 1 });
      }
      continue;
    }

    const record = asRecord(value);
    if (!record) {
      continue;
    }

    const modelValue = readFirstString(record, MODEL_VALUE_KEYS);
    if (modelValue) {
      const normalizedModel = normalizeModelString(modelValue);
      if (normalizedModel) {
        const provider = readFirstString(record, MODEL_PROVIDER_KEYS);
        const normalizedProvider = provider ? normalizeModelString(provider) : undefined;
        const candidate =
          normalizedProvider && !normalizedModel.includes('/')
            ? `${normalizedProvider}/${normalizedModel}`
            : normalizedModel;
        const score = scoreDetectedModel(candidate);
        if (score > bestScore) {
          bestMatch = candidate;
          bestScore = score;
        }
      }
    }

    for (const nestedValue of Object.values(record)) {
      if (nestedValue && typeof nestedValue === 'object') {
        queue.push({ value: nestedValue, depth: depth + 1 });
      }
    }
  }

  return bestMatch;
}

function parseUsageRecord(record: JsonRecord): TokenUsageSample | undefined {
  const inputTokens = readFirstNumber(record, TOKEN_INPUT_KEYS);
  const outputTokens = readFirstNumber(record, TOKEN_OUTPUT_KEYS);
  const totalTokens = readFirstNumber(record, TOKEN_TOTAL_KEYS);
  const contextWindowTokens = readContextWindowTokens(record);
  const remainingContextTokens = readFirstNumber(record, CONTEXT_REMAINING_KEYS);
  const remainingContextPercent = normalizePercent(
    readFirstNumber(record, CONTEXT_REMAINING_PERCENT_KEYS)
  );

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    contextWindowTokens === undefined &&
    remainingContextTokens === undefined &&
    remainingContextPercent === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    contextWindowTokens,
    remainingContextTokens,
    remainingContextPercent,
  };
}

function scoreUsageSample(sample: TokenUsageSample): number {
  let score = 0;
  if (sample.totalTokens !== undefined) score += 4;
  if (sample.inputTokens !== undefined) score += 3;
  if (sample.outputTokens !== undefined) score += 3;
  if (sample.contextWindowTokens !== undefined) score += 2;
  if (sample.remainingContextTokens !== undefined) score += 2;
  if (sample.remainingContextPercent !== undefined) score += 1;
  return score;
}

function computeDerivedContext(summary: TokenUsageSummary): TokenUsageSummary {
  const next: TokenUsageSummary = { ...summary };

  if (
    next.remainingContextTokens === undefined &&
    next.contextWindowTokens !== undefined &&
    next.contextWindowTokens > 0
  ) {
    next.remainingContextTokens = Math.max(0, next.contextWindowTokens - next.totalTokens);
  }

  if (
    next.remainingContextPercent === undefined &&
    next.remainingContextTokens !== undefined &&
    next.contextWindowTokens !== undefined &&
    next.contextWindowTokens > 0
  ) {
    next.remainingContextPercent =
      (next.remainingContextTokens / next.contextWindowTokens) * 100;
  }

  return next;
}

/**
 * Extract a normalized usage sample from a parsed JSON object.
 * Chooses the strongest usage-like payload if multiple candidates exist.
 */
export function extractTokenUsageFromJsonObject(payload: JsonRecord): TokenUsageSample | undefined {
  const usageRecords: JsonRecord[] = [];
  collectUsageRecords(payload, usageRecords, 0);

  let best: TokenUsageSample | undefined;
  let bestScore = -1;

  for (const record of usageRecords) {
    const sample = parseUsageRecord(record);
    if (!sample) continue;
    const score = scoreUsageSample(sample);
    if (score > bestScore) {
      best = sample;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Extract a normalized usage sample from a raw JSONL line.
 */
export function extractTokenUsageFromJsonLine(line: string): TokenUsageSample | undefined {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonRecord;
    return extractTokenUsageFromJsonObject(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Accumulates token usage over a stream of JSONL events.
 */
export class TokenUsageAccumulator {
  private summary: TokenUsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    events: 0,
  };

  add(sample?: TokenUsageSample): void {
    if (!sample) {
      return;
    }

    let hadSignal = false;

    if (sample.inputTokens !== undefined) {
      this.summary.inputTokens += sample.inputTokens;
      hadSignal = true;
    }

    if (sample.outputTokens !== undefined) {
      this.summary.outputTokens += sample.outputTokens;
      hadSignal = true;
    }

    if (sample.totalTokens !== undefined) {
      this.summary.totalTokens += sample.totalTokens;
      hadSignal = true;
    } else if (sample.inputTokens !== undefined || sample.outputTokens !== undefined) {
      this.summary.totalTokens += (sample.inputTokens ?? 0) + (sample.outputTokens ?? 0);
      hadSignal = true;
    }

    if (sample.contextWindowTokens !== undefined) {
      this.summary.contextWindowTokens = sample.contextWindowTokens;
      hadSignal = true;
    }

    if (sample.remainingContextTokens !== undefined) {
      this.summary.remainingContextTokens = sample.remainingContextTokens;
      hadSignal = true;
    }

    if (sample.remainingContextPercent !== undefined) {
      this.summary.remainingContextPercent = sample.remainingContextPercent;
      hadSignal = true;
    }

    if (hadSignal) {
      this.summary.events += 1;
    }
  }

  hasData(): boolean {
    return (
      this.summary.events > 0 ||
      this.summary.inputTokens > 0 ||
      this.summary.outputTokens > 0 ||
      this.summary.totalTokens > 0
    );
  }

  getSummary(): TokenUsageSummary {
    return computeDerivedContext(this.summary);
  }

  reset(): void {
    this.summary = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      events: 0,
    };
  }
}

/**
 * Parse and aggregate token usage from raw agent output.
 */
export function summarizeTokenUsageFromOutput(output: string): TokenUsageSummary | undefined {
  if (!output || !output.trim()) {
    return undefined;
  }

  const accumulator = new TokenUsageAccumulator();
  for (const line of output.split('\n')) {
    accumulator.add(extractTokenUsageFromJsonLine(line));
  }

  return accumulator.hasData() ? accumulator.getSummary() : undefined;
}

/**
 * Merge context window information into an existing usage summary.
 * Existing context fields on usage take priority over the fallback.
 */
export function withContextWindow(
  usage: TokenUsageSummary,
  fallbackContextWindowTokens?: number
): TokenUsageSummary {
  if (
    usage.contextWindowTokens !== undefined ||
    fallbackContextWindowTokens === undefined ||
    fallbackContextWindowTokens <= 0
  ) {
    return computeDerivedContext(usage);
  }

  return computeDerivedContext({
    ...usage,
    contextWindowTokens: fallbackContextWindowTokens,
  });
}
