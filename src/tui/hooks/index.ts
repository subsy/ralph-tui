/**
 * ABOUTME: Export barrel for TUI hooks.
 * Re-exports all React hooks used in the TUI components.
 */

export {
  useImageAttachment,
  type AttachedImage,
  type AttachResult,
  type UseImageAttachmentReturn,
  type UseImageAttachmentOptions,
} from './useImageAttachment.js';

export {
  useInlineImageIndicators,
  isWithinIndicator,
  MARKERS,
  type ImageIndicatorMap,
  type ProcessedText,
  type UseInlineImageIndicatorsReturn,
} from './useInlineImageIndicators.js';

export { usePaste, type UsePasteOptions } from './usePaste.js';

export {
  useToast,
  type Toast as ToastData,
  type ToastVariant,
  type ShowToastOptions,
  type UseToastReturn,
} from './useToast.js';

export {
  useImageAttachmentWithFeedback,
  type AttachResultWithFeedback,
  type UseImageAttachmentWithFeedbackReturn,
} from './useImageAttachmentWithFeedback.js';

export {
  usePasteHint,
  type UsePasteHintOptions,
  type UsePasteHintReturn,
} from './usePasteHint.js';
