/**
 * ABOUTME: Component to display the count of attached images above text input.
 * Shows a styled indicator like "📎 2 images attached" when images are present.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';

/**
 * Props for the ImageAttachmentCount component.
 */
export interface ImageAttachmentCountProps {
  /** Number of attached images */
  count: number;
  /** Whether to show even when count is 0 (defaults to false) */
  showWhenEmpty?: boolean;
}

/**
 * Displays the count of attached images.
 * Only renders when there are images attached (unless showWhenEmpty is true).
 *
 * @example
 * ```tsx
 * <ImageAttachmentCount count={attachedImages.length} />
 * // Renders: 📎 2 images attached
 * ```
 */
export function ImageAttachmentCount({
  count,
  showWhenEmpty = false,
}: ImageAttachmentCountProps): ReactNode {
  // Don't render if no images and not showing empty state
  if (count === 0 && !showWhenEmpty) {
    return null;
  }

  // Format the count text
  const text =
    count === 0
      ? 'No images attached'
      : count === 1
        ? '📎 1 image attached'
        : `📎 ${count} images attached`;

  // Use dimmed color for indicator
  const textColor = count === 0 ? colors.fg.dim : colors.fg.muted;

  return (
    <box
      style={{
        height: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 1,
      }}
    >
      <text fg={textColor}>{text}</text>
    </box>
  );
}
