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
  installBuiltinTemplates,
  installGlobalTemplates,
  getProjectTemplatePath,
  getGlobalTemplatePath,
} from './engine.js';

export {
  DEFAULT_TEMPLATE,
  BEADS_TEMPLATE,
  BEADS_BV_TEMPLATE,
  BEADS_RUST_BV_TEMPLATE,
  JSON_TEMPLATE,
} from './builtin.js';
