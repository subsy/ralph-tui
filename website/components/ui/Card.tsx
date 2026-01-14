/**
 * ABOUTME: Card component with terminal-inspired styling and hover effects.
 * Provides a container with subtle border glow and layered background effects.
 */

'use client';

import { forwardRef, type HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Whether the card has interactive hover effects */
  interactive?: boolean;
  /** Whether to show a subtle gradient border on hover */
  glowOnHover?: boolean;
  /** Visual variant */
  variant?: 'default' | 'elevated' | 'bordered';
}

type CardHeaderProps = HTMLAttributes<HTMLDivElement>;
type CardContentProps = HTMLAttributes<HTMLDivElement>;
type CardFooterProps = HTMLAttributes<HTMLDivElement>;

/**
 * Base card styles - terminal window aesthetic with layered backgrounds.
 */
const baseStyles = [
  'rounded-sm',
  'border border-border',
  'bg-bg-secondary',
  'text-fg-primary',
  'transition-all duration-200 ease-out',
].join(' ');

/**
 * Variant-specific styles for different card appearances.
 */
const variantStyles = {
  default: '',
  elevated: 'shadow-lg shadow-bg-primary/50',
  bordered: 'border-2',
};

/**
 * Interactive hover styles - terminal glow effect.
 */
const interactiveStyles = [
  'cursor-pointer',
  'hover:border-accent-primary/50',
  'hover:bg-bg-tertiary',
  'hover:shadow-[0_0_30px_rgba(122,162,247,0.1)]',
  'active:bg-bg-highlight',
  'active:border-accent-primary/70',
].join(' ');

/**
 * Gradient border glow effect on hover.
 */
const glowStyles = [
  'relative',
  'before:absolute before:inset-[-1px] before:rounded-sm',
  'before:bg-gradient-to-r before:from-accent-primary/0 before:via-accent-primary/30 before:to-accent-secondary/0',
  'before:opacity-0 before:transition-opacity before:duration-300',
  'hover:before:opacity-100',
  'before:-z-10 before:blur-sm',
].join(' ');

/**
 * Card component that serves as a container with terminal-inspired styling.
 *
 * @example
 * // Basic card
 * <Card>
 *   <CardHeader>Title</CardHeader>
 *   <CardContent>Content goes here</CardContent>
 * </Card>
 *
 * @example
 * // Interactive card with glow effect
 * <Card interactive glowOnHover>
 *   <CardContent>Click me</CardContent>
 * </Card>
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className = '',
      interactive = false,
      glowOnHover = false,
      variant = 'default',
      ...props
    },
    ref
  ) => {
    const classes = [
      baseStyles,
      variantStyles[variant],
      interactive ? interactiveStyles : '',
      glowOnHover ? glowStyles : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return <div ref={ref} className={classes} {...props} />;
  }
);

Card.displayName = 'Card';

/**
 * Card header section with bottom border separator.
 */
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className = '', ...props }, ref) => {
    const classes = [
      'px-5 py-4',
      'border-b border-border-muted',
      'font-mono text-sm font-medium tracking-wide',
      'text-fg-primary',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return <div ref={ref} className={classes} {...props} />;
  }
);

CardHeader.displayName = 'CardHeader';

/**
 * Card content section with standard padding.
 */
export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className = '', ...props }, ref) => {
    const classes = ['px-5 py-4', 'text-fg-secondary', className]
      .filter(Boolean)
      .join(' ');

    return <div ref={ref} className={classes} {...props} />;
  }
);

CardContent.displayName = 'CardContent';

/**
 * Card footer section with top border separator.
 */
export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className = '', ...props }, ref) => {
    const classes = [
      'px-5 py-4',
      'border-t border-border-muted',
      'flex items-center gap-3',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return <div ref={ref} className={classes} {...props} />;
  }
);

CardFooter.displayName = 'CardFooter';

export type { CardProps, CardHeaderProps, CardContentProps, CardFooterProps };
