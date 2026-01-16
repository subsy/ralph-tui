/**
 * ABOUTME: Export barrel for TUI hooks.
 * Re-exports all React hooks used in the TUI components.
 */

export {
  useImageAttachment,
  type AttachedImage,
  type AttachResult,
  type UseImageAttachmentReturn,
} from './useImageAttachment.js';

export {
  useInlineImageIndicators,
  isWithinIndicator,
  MARKERS,
  type ImageIndicatorMap,
  type ProcessedText,
  type UseInlineImageIndicatorsReturn,
} from './useInlineImageIndicators.js';

export {
  usePaste,
  type UsePasteOptions,
} from './usePaste.js';
