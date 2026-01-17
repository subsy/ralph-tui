/**
 * ABOUTME: Template system exports for prompt rendering.
 * Provides Handlebars-based template engine with built-in and custom template support.
 */

export type {
  TemplateVariables,
  TemplateContext,
  TemplateLoadResult,
  TemplateRenderResult,
  BuiltinTemplateType,
  TemplateConfig,
} from './types.js';

export {
  renderPrompt,
  loadTemplate,
  buildTemplateVariables,
  buildTemplateContext,
  getBuiltinTemplate,
  getTemplateTypeFromPlugin,
  copyBuiltinTemplate,
  getCustomTemplatePath,
  clearTemplateCache,
  getUserConfigDir,
  getDefaultPromptFilename,
  getUserPromptPath,
  getBundledPrompt,
  initializeUserPrompts,
} from './engine.js';

export {
  DEFAULT_TEMPLATE,
  BEADS_TEMPLATE,
  BEADS_BV_TEMPLATE,
  JSON_TEMPLATE,
} from './builtin.js';

export { PROMPT_JSON, PROMPT_BEADS } from './prompts.js';
