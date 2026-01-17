/**
 * ABOUTME: Client for the models.dev API - open-source database of AI model specifications.
 * Provides provider/model validation and logo URL lookup.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** models.dev API endpoint */
const MODELS_DEV_API_URL = 'https://models.dev/api.json';

/** Cache TTL in milliseconds (1 hour) */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Path to cache file */
const CACHE_FILE_PATH = join(tmpdir(), 'ralph-tui-models-dev-cache.json');

/**
 * Provider information from models.dev API
 */
export interface ProviderInfo {
  /** Provider ID (e.g., 'anthropic', 'openai') */
  id: string;
  /** Provider name for display */
  name: string;
  /** Provider logo URL */
  logoUrl: string;
}

/**
 * Model information from models.dev API
 */
export interface ModelInfo {
  /** Model ID (e.g., 'claude-3-5-sonnet-20241022') */
  id: string;
  /** Model name for display */
  name: string;
  /** Provider ID */
  providerId: string;
  /** Context window size */
  contextLimit?: number;
  /** Input cost per 1M tokens */
  inputCost?: number;
  /** Output cost per 1M tokens */
  outputCost?: number;
}

/**
 * Cached data structure
 */
interface CacheData {
  /** Timestamp when cache was written */
  timestamp: number;
  /** List of providers */
  providers: ProviderInfo[];
  /** Map of provider ID to models */
  modelsByProvider: Record<string, ModelInfo[]>;
  /** Set of all valid model IDs */
  validModelIds: Set<string>;
}

/**
 * Get the provider logo URL
 */
export function getProviderLogoUrl(providerId: string): string {
  return `https://models.dev/logos/${providerId}.svg`;
}

/**
 * Load cached data from disk
 */
function loadCache(): CacheData | null {
  try {
    if (!existsSync(CACHE_FILE_PATH)) {
      return null;
    }

    const content = readFileSync(CACHE_FILE_PATH, 'utf-8');
    const cache = JSON.parse(content) as CacheData;

    // Check if cache is expired
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) {
      return null;
    }

    // Restore Set from array
    if (Array.isArray(cache.validModelIds)) {
      cache.validModelIds = new Set(cache.validModelIds);
    }

    return cache;
  } catch {
    return null;
  }
}

/**
 * Save cache data to disk
 */
function saveCache(cache: CacheData): void {
  try {
    // Convert Set to array for JSON serialization
    const toSave = {
      ...cache,
      validModelIds: Array.from(cache.validModelIds),
    };
    writeFileSync(CACHE_FILE_PATH, JSON.stringify(toSave, null, 2));
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Fetch models.dev API and populate cache
 */
async function fetchAndCache(): Promise<CacheData> {
  const response = await fetch(MODELS_DEV_API_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch models.dev API: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    providers?: Array<{ id: string; name: string }>;
    models?: Array<{
      'Provider ID': string;
      'Model ID': string;
      Model: string;
      'Context Limit'?: number;
      'Input Cost'?: number;
      'Output Cost'?: number;
    }>;
  };

  const providers: ProviderInfo[] = [];
  const modelsByProvider: Record<string, ModelInfo[]> = {};
  const validModelIds = new Set<string>();

  // Process providers
  if (data.providers) {
    for (const p of data.providers) {
      providers.push({
        id: p.id,
        name: p.name,
        logoUrl: getProviderLogoUrl(p.id),
      });
    }
  }

  // Process models
  if (data.models) {
    for (const m of data.models) {
      const modelInfo: ModelInfo = {
        id: m['Model ID'],
        name: m.Model,
        providerId: m['Provider ID'],
        contextLimit: m['Context Limit'],
        inputCost: m['Input Cost'],
        outputCost: m['Output Cost'],
      };

      if (!modelsByProvider[m['Provider ID']]) {
        modelsByProvider[m['Provider ID']] = [];
      }
      modelsByProvider[m['Provider ID']].push(modelInfo);
      validModelIds.add(m['Model ID']);
    }
  }

  const cache: CacheData = {
    timestamp: Date.now(),
    providers,
    modelsByProvider,
    validModelIds,
  };

  saveCache(cache);
  return cache;
}

/** Cached data (lazy loaded) */
let cacheData: CacheData | null = null;

/**
 * Get or fetch the models.dev data
 */
async function getModelsDevData(): Promise<CacheData> {
  if (cacheData) {
    return cacheData;
  }

  const cached = loadCache();
  if (cached) {
    cacheData = cached;
    return cached;
  }

  try {
    cacheData = await fetchAndCache();
    return cacheData;
  } catch {
    // If fetch fails and no cache, return empty cache
    cacheData = {
      timestamp: Date.now(),
      providers: [],
      modelsByProvider: {},
      validModelIds: new Set(),
    };
    return cacheData;
  }
}

/**
 * Get list of all providers
 */
export async function getProviders(): Promise<ProviderInfo[]> {
  const data = await getModelsDevData();
  return data.providers;
}

/**
 * Get provider info by ID
 */
export async function getProvider(
  providerId: string,
): Promise<ProviderInfo | null> {
  const data = await getModelsDevData();
  return data.providers.find((p) => p.id === providerId) || null;
}

/**
 * Get models for a provider
 */
export async function getModelsForProvider(
  providerId: string,
): Promise<ModelInfo[]> {
  const data = await getModelsDevData();
  return data.modelsByProvider[providerId] || [];
}

/**
 * Check if a provider is valid
 */
export async function isValidProvider(providerId: string): Promise<boolean> {
  const data = await getModelsDevData();
  return data.providers.some((p) => p.id === providerId);
}

/**
 * Check if a model ID is valid (AI SDK format)
 */
export async function isValidModelId(modelId: string): Promise<boolean> {
  const data = await getModelsDevData();
  return data.validModelIds.has(modelId);
}

/**
 * Validate a model string in provider/model format
 * Returns null if valid, or an error message if invalid
 */
export async function validateModelString(
  modelString: string,
): Promise<string | null> {
  if (!modelString || modelString.trim() === '') {
    return null; // Empty is valid (uses default)
  }

  // Check if it's in provider/model format
  if (modelString.includes('/')) {
    const [providerId, modelId] = modelString.split('/');

    if (!providerId || !modelId) {
      return `Invalid model format "${modelString}". Expected: provider/model (e.g., anthropic/claude-3-5-sonnet)`;
    }

    // Validate provider
    const providerValid = await isValidProvider(providerId);
    if (!providerValid) {
      const providers = await getProviders();
      const providerNames = providers.map((p) => p.id).join(', ');
      return `Unknown provider "${providerId}". Valid providers: ${providerNames || '(none loaded - check network connection)'}`;
    }

    // Validate model ID
    const modelValid = await isValidModelId(modelId);
    if (!modelValid) {
      const providerModels = await getModelsForProvider(providerId);
      if (providerModels.length === 0) {
        return `No models found for provider "${providerId}"`;
      }
      return `Unknown model "${modelId}" for provider "${providerId}". Check https://models.dev for available models.`;
    }
  }

  // If no slash format, accept as-is (user may use non-standard format)
  // The agent CLI will validate if needed
  return null;
}

/**
 * Get model info for display
 */
export async function getModelDisplayInfo(modelString: string): Promise<{
  providerId: string;
  modelId: string;
  providerLogoUrl: string;
} | null> {
  if (!modelString || modelString.trim() === '') {
    return null;
  }

  const [providerId, modelId] = modelString.includes('/')
    ? modelString.split('/')
    : ['', modelString];

  if (!providerId || !modelId) {
    return null;
  }

  return {
    providerId,
    modelId,
    providerLogoUrl: getProviderLogoUrl(providerId),
  };
}

/**
 * Force refresh the cache (useful for testing or manual refresh)
 */
export async function refreshCache(): Promise<void> {
  cacheData = await fetchAndCache();
}

/**
 * Clear the cache
 */
export function clearCache(): void {
  cacheData = null;
}
