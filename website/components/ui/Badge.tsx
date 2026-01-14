/**
 * ABOUTME: Badge component for labels, tags, and status indicators.
 * Uses terminal-inspired styling with status color variants.
 */

'use client';

import { forwardRef, type HTMLAttributes } from 'react';

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'outline';
type BadgeSize = 'sm' | 'default';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual style variant */
  variant?: BadgeVariant;
  /** Size preset */
  size?: BadgeSize;
  /** Optional dot indicator for status badges */
  dot?: boolean;
  /** Pulsing animation for active status indicators */
  pulse?: boolean;
}

/**
 * Base badge styles - compact label styling.
 */
const baseStyles = [
  'inline-flex items-center gap-1.5',
  'font-mono font-medium',
  'rounded-sm',
  'transition-colors duration-150',
  'select-none',
  'whitespace-nowrap',
].join(' ');

/**
 * Size-specific styles.
 */
const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px] tracking-wider uppercase',
  default: 'px-2.5 py-1 text-xs tracking-wide',
};

/**
 * Variant-specific styles with terminal-inspired colors.
 */
const variantStyles: Record<BadgeVariant, string> = {
  // Default: Primary accent
  default: 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30',

  // Secondary: Muted appearance
  secondary: 'bg-bg-tertiary text-fg-secondary border border-border',

  // Status variants using theme status colors
  success:
    'bg-status-success/15 text-status-success border border-status-success/30',

  warning:
    'bg-status-warning/15 text-status-warning border border-status-warning/30',

  error: 'bg-status-error/15 text-status-error border border-status-error/30',

  info: 'bg-status-info/15 text-status-info border border-status-info/30',

  // Outline: Minimal border-only style
  outline: 'bg-transparent text-fg-secondary border border-border hover:border-fg-muted',
};

/**
 * Dot indicator styles for status badges.
 */
const dotStyles: Record<BadgeVariant, string> = {
  default: 'bg-accent-primary',
  secondary: 'bg-fg-muted',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  info: 'bg-status-info',
  outline: 'bg-fg-secondary',
};

/**
 * Badge component for labels, tags, and status indicators.
 *
 * @example
 * // Default badge
 * <Badge>New</Badge>
 *
 * @example
 * // Status badge with dot indicator
 * <Badge variant="success" dot>Running</Badge>
 *
 * @example
 * // Pulsing error indicator
 * <Badge variant="error" dot pulse>Critical</Badge>
 *
 * @example
 * // Small uppercase label
 * <Badge variant="secondary" size="sm">Beta</Badge>
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className = '',
      variant = 'default',
      size = 'default',
      dot = false,
      pulse = false,
      children,
      ...props
    },
    ref
  ) => {
    const classes = [
      baseStyles,
      sizeStyles[size],
      variantStyles[variant],
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <span ref={ref} className={classes} {...props}>
        {dot && (
          <span
            className={`
              inline-block rounded-full
              ${size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'}
              ${dotStyles[variant]}
              ${pulse ? 'animate-pulse' : ''}
            `}
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

export type { BadgeProps, BadgeVariant, BadgeSize };
