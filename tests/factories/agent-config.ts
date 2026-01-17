/**
 * ABOUTME: Factory functions for creating AgentPluginConfig test objects.
 * Provides type-safe builders with sensible defaults.
 */

import type {
  AgentPluginConfig,
  RateLimitHandlingConfig,
} from '../../src/plugins/agents/types.js';

/**
 * Default values for AgentPluginConfig
 */
export const DEFAULT_AGENT_CONFIG: AgentPluginConfig = {
  name: 'test-agent',
  plugin: 'claude',
  default: true,
  timeout: 300000,
  options: {},
};

/**
 * Create an AgentPluginConfig with optional overrides
 */
export function createAgentConfig(
  overrides: Partial<AgentPluginConfig> = {},
): AgentPluginConfig {
  return {
    ...DEFAULT_AGENT_CONFIG,
    ...overrides,
    options: {
      ...DEFAULT_AGENT_CONFIG.options,
      ...overrides.options,
    },
  };
}

/**
 * Create a Claude agent config
 */
export function createClaudeAgentConfig(
  overrides: Partial<Omit<AgentPluginConfig, 'plugin'>> = {},
): AgentPluginConfig {
  const { options: overrideOptions, ...rest } = overrides;
  return createAgentConfig({
    ...rest,
    name: rest.name ?? 'claude',
    plugin: 'claude',
    options: {
      ...(overrideOptions ?? {}),
      model: 'claude-sonnet-4-20250514',
    },
  });
}

/**
 * Create an agent config with rate limit handling
 */
export function createAgentConfigWithRateLimiting(
  rateLimitHandling: Partial<RateLimitHandlingConfig> = {},
  overrides: Partial<AgentPluginConfig> = {},
): AgentPluginConfig {
  return createAgentConfig({
    ...overrides,
    rateLimitHandling: {
      enabled: true,
      maxRetries: 3,
      baseBackoffMs: 5000,
      recoverPrimaryBetweenIterations: true,
      ...rateLimitHandling,
    },
  });
}

/**
 * Create an agent config with fallback agents
 */
export function createAgentConfigWithFallbacks(
  fallbackAgents: string[],
  overrides: Partial<AgentPluginConfig> = {},
): AgentPluginConfig {
  return createAgentConfig({
    ...overrides,
    fallbackAgents,
    rateLimitHandling: {
      enabled: true,
      maxRetries: 3,
      baseBackoffMs: 5000,
      recoverPrimaryBetweenIterations: true,
    },
  });
}
