/**
 * ABOUTME: Zod schemas for Ralph TUI configuration validation.
 * Provides runtime validation with helpful error messages for config files.
 */

import { z } from 'zod';

/**
 * Subagent tracing detail level schema
 */
export const SubagentDetailLevelSchema = z.enum(['off', 'minimal', 'moderate', 'full']);

/**
 * Error handling strategy schema
 */
export const ErrorHandlingStrategySchema = z.enum(['retry', 'skip', 'abort']);

/**
 * Error handling configuration schema
 */
export const ErrorHandlingConfigSchema = z.object({
  strategy: ErrorHandlingStrategySchema.optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(300000).optional(),
  continueOnNonZeroExit: z.boolean().optional(),
});

/**
 * Agent plugin options schema (flexible for plugin-specific settings)
 */
export const AgentOptionsSchema = z.record(z.string(), z.unknown());

/**
 * Rate limit handling configuration schema
 */
export const RateLimitHandlingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  baseBackoffMs: z.number().int().min(0).max(300000).optional(),
  recoverPrimaryBetweenIterations: z.boolean().optional(),
});

/**
 * Notification sound mode schema
 */
export const NotificationSoundModeSchema = z.enum(['off', 'system', 'ralph']);

/**
 * Notifications configuration schema
 */
export const NotificationsConfigSchema = z.object({
  /** Whether desktop notifications are enabled (default: true) */
  enabled: z.boolean().optional(),
  /** Sound mode for notifications (default: 'off') */
  sound: NotificationSoundModeSchema.optional(),
});

/**
 * Image cleanup policy schema
 */
export const ImageCleanupPolicySchema = z.enum(['on_exit', 'manual', 'never']);

/**
 * Image configuration schema
 */
export const ImageConfigSchema = z.object({
  /** Whether image attachments are enabled (default: true) */
  enabled: z.boolean().optional(),
  /** Cleanup policy for attached images (default: 'on_exit') */
  cleanup_policy: ImageCleanupPolicySchema.optional(),
  /** Skip confirmation prompt when cleaning up images (default: false) */
  skip_cleanup_confirmation: z.boolean().optional(),
  /** Maximum images allowed per message (default: 10, 0 = unlimited) */
  max_images_per_message: z.number().int().min(0).max(100).optional(),
  /** Show hint about image paste on first text paste of session (default: true) */
  show_paste_hints: z.boolean().optional(),
});

/**
 * Agent plugin configuration schema
 */
export const AgentPluginConfigSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  plugin: z.string().min(1, 'Agent plugin type is required'),
  default: z.boolean().optional(),
  command: z.string().optional(),
  defaultFlags: z.array(z.string()).optional(),
  timeout: z.number().int().min(0).optional(),
  options: AgentOptionsSchema.optional().default({}),
  fallbackAgents: z.array(z.string().min(1)).optional(),
  rateLimitHandling: RateLimitHandlingConfigSchema.optional(),
});

/**
 * Tracker plugin options schema (flexible for plugin-specific settings)
 */
export const TrackerOptionsSchema = z.record(z.string(), z.unknown());

/**
 * Tracker plugin configuration schema
 */
export const TrackerPluginConfigSchema = z.object({
  name: z.string().min(1, 'Tracker name is required'),
  plugin: z.string().min(1, 'Tracker plugin type is required'),
  default: z.boolean().optional(),
  options: TrackerOptionsSchema.optional().default({}),
});

/**
 * Stored configuration schema (global or project config file)
 * Both global (~/.config/ralph-tui/config.toml) and project (.ralph-tui/config.toml)
 * use this schema.
 */
export const StoredConfigSchema = z
  .object({
    // Default selections
    defaultAgent: z.string().optional(),
    defaultTracker: z.string().optional(),

    // Core settings
    maxIterations: z.number().int().min(0).max(1000).optional(),
    iterationDelay: z.number().int().min(0).max(300000).optional(),
    outputDir: z.string().optional(),
    autoCommit: z.boolean().optional(),

    // Plugin configurations
    agents: z.array(AgentPluginConfigSchema).optional(),
    trackers: z.array(TrackerPluginConfigSchema).optional(),

    // Agent-specific options (shorthand for common settings)
    agent: z.string().optional(),
    agentCommand: z.string().optional(),
    agentOptions: AgentOptionsSchema.optional(),

    // Tracker-specific options (shorthand for common settings)
    tracker: z.string().optional(),
    trackerOptions: TrackerOptionsSchema.optional(),

    // Error handling
    errorHandling: ErrorHandlingConfigSchema.optional(),

    // Fallback agents (shorthand for default agent)
    fallbackAgents: z.array(z.string().min(1)).optional(),

    // Rate limit handling (shorthand for default agent)
    rateLimitHandling: RateLimitHandlingConfigSchema.optional(),

    // Custom prompt template path
    prompt_template: z.string().optional(),

    skills_dir: z.string().optional(),

    // Subagent tracing detail level
    subagentTracingDetail: SubagentDetailLevelSchema.optional(),

    // Notifications configuration
    notifications: NotificationsConfigSchema.optional(),

    // Image attachment configuration
    images: ImageConfigSchema.optional(),
  })
  .strict();

/**
 * Type inferred from StoredConfigSchema
 */
export type StoredConfigValidated = z.infer<typeof StoredConfigSchema>;

/**
 * Validation result with formatted error messages
 */
export interface ConfigValidationError {
  /** The path to the invalid field (e.g., "agents.0.name") */
  path: string;
  /** Human-readable error message */
  message: string;
}

/**
 * Result of validating a configuration
 */
export interface ConfigParseResult {
  /** Whether validation succeeded */
  success: boolean;
  /** The validated data (if success is true) */
  data?: StoredConfigValidated;
  /** Array of validation errors (if success is false) */
  errors?: ConfigValidationError[];
}

/**
 * Validate a configuration object against the schema.
 * @param config The raw configuration object to validate
 * @returns Parse result with validated data or error messages
 */
export function validateStoredConfig(config: unknown): ConfigParseResult {
  const result = StoredConfigSchema.safeParse(config);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  // Format Zod errors into friendly messages
  const errors: ConfigValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

  return {
    success: false,
    errors,
  };
}

/**
 * Format validation errors into a user-friendly string.
 * @param errors Array of validation errors
 * @param configPath Path to the config file for context
 * @returns Formatted error message
 */
export function formatConfigErrors(
  errors: ConfigValidationError[],
  configPath: string
): string {
  const lines = [`Configuration error in ${configPath}:`];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  return lines.join('\n');
}
