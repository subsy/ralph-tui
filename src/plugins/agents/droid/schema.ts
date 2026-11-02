/**
 * ABOUTME: Zod schema for Factory Droid agent configuration options.
 * Validates model, reasoning effort, and output format settings.
 */

import { z } from 'zod';

export const DroidReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export const DroidOutputFormatSchema = z.enum(['text', 'json', 'stream-json']);

export const DroidAgentConfigSchema = z
  .object({
    model: z.string().optional(),
    reasoningEffort: DroidReasoningEffortSchema.optional(),
    outputFormat: DroidOutputFormatSchema.optional().default('stream-json'),
    skipPermissions: z.boolean().optional().default(true),
    enableTracing: z.boolean().optional().default(true),
  })
  .passthrough();

export type DroidReasoningEffort = z.infer<typeof DroidReasoningEffortSchema>;
export type DroidOutputFormat = z.infer<typeof DroidOutputFormatSchema>;
export type DroidAgentConfig = z.infer<typeof DroidAgentConfigSchema>;
